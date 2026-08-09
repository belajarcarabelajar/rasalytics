import { preprocess, analyzeEdgeSafe } from "../../packages/sentiment-core/src/shared-sentiment.js";
import { getShingles, jaccard } from "../../packages/sentiment-core/src/forensics.js";

import { z } from "zod";

interface Env {
  YOUTUBE_API_KEY?: string;
}

const AnalyzeVideoSchema = z.object({
  videoId: z.string().min(1, "Missing videoId"),
  maxPages: z
    .number()
    .int()
    .min(1)
    .max(10, { message: "maxPages must be 10 or fewer" })
    .optional()
    .default(1),
});

const YouTubeVideoSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            snippet: z
              .object({
                title: z.string(),
                channelTitle: z.string(),
              })
              .passthrough(),
            statistics: z
              .object({
                viewCount: z.string().optional(),
                likeCount: z.string().optional(),
                commentCount: z.string().optional(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const YouTubeCommentSchema = z
  .object({
    id: z.string(),
    snippet: z
      .object({
        authorDisplayName: z.string(),
        textOriginal: z.string().optional(),
        textDisplay: z.string().optional(),
        likeCount: z.number().optional(),
        publishedAt: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const YouTubeCommentThreadSchema = z
  .object({
    nextPageToken: z.string().optional(),
    items: z
      .array(
        z
          .object({
            id: z.string(),
            snippet: z
              .object({
                totalReplyCount: z.number().optional().default(0),
                topLevelComment: YouTubeCommentSchema,
              })
              .passthrough(),
            replies: z
              .object({
                comments: z.array(YouTubeCommentSchema).optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const YouTubeCommentsResponseSchema = z
  .object({
    nextPageToken: z.string().optional(),
    items: z.array(YouTubeCommentSchema).optional(),
  })
  .passthrough();

// Cache global allowed origins
const ALLOWED_PAGES_SUFFIX = ".rasalytics.pages.dev";
const ALLOWED_ORIGINS = new Set([
  "http://localhost:8787",
  "http://127.0.0.1:8787",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://rasalytics.belajarcarabelajar.com",
  "https://rasalytics.pages.dev",
]);

export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    let allowOrigin = "https://rasalytics.pages.dev";
    if (ALLOWED_ORIGINS.has(origin) || origin.endsWith(ALLOWED_PAGES_SUFFIX)) {
      allowOrigin = origin;
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "X-Content-Type-Options": "nosniff",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      "X-Frame-Options": "DENY",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return new Response(JSON.stringify({ status: "ok", type: "edge-sentiment" }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (url.pathname === "/api/analyze-video" && request.method === "POST") {
      try {
        const jsonBody = await request.json();
        const parsedBody = AnalyzeVideoSchema.safeParse(jsonBody);

        if (!parsedBody.success) {
          // Trace the offending value. Log forging (CWE-117) mitigation:
          // never interpolate raw user input into console.error. Encode the
          // received value with JSON.stringify so control chars (\n, \r) and
          // any non-string JS value are safely escaped into a single line.
          // Truncate large values so an attacker cannot flood the log pipe.
          const MAX_VALUE_CHARS = 500;
          for (const issue of parsedBody.error.issues) {
            const pathStr = issue.path.join(".");
            let receivedValue: any = jsonBody;
            for (const key of issue.path) {
              receivedValue = receivedValue?.[key];
            }
            let encodedValue: string;
            try {
              encodedValue = JSON.stringify(receivedValue);
            } catch {
              encodedValue = "[unserializable]";
            }
            if (typeof encodedValue === "string" && encodedValue.length > MAX_VALUE_CHARS) {
              encodedValue = encodedValue.slice(0, MAX_VALUE_CHARS) + "...[truncated]";
            }
            console.error(
              JSON.stringify({
                timestamp: new Date().toISOString(),
                route: "/api/analyze-video",
                event: "validation_failed",
                path: pathStr,
                receivedValue: encodedValue,
                message: issue.message,
              }),
            );
          }

          const errorMessage = parsedBody.error.issues.map((e) => e.message).join(", ");
          const structuredError = {
            error: errorMessage,
            details: parsedBody.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          };

          return new Response(JSON.stringify(structuredError), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }

        const body = parsedBody.data;

        if (!env.YOUTUBE_API_KEY) {
          return new Response(
            JSON.stringify({ error: "YOUTUBE_API_KEY not configured on server" }),
            { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
          );
        }

        const maxPages = body.maxPages;
        const apiKey = env.YOUTUBE_API_KEY;
        const videoId = body.videoId;

        let subrequestCount = 0;
        const MAX_SUBREQUESTS = 45;
        // Replies per-thread pagination cap. Deep reply chains are rare and a
        // single hot thread can otherwise burn the entire subrequest budget.
        // 3 pages * 100 = 300 replies covers >99% of real threads.
        const REPLIES_MAX_PAGES = 3;

        // 1. Fetch Video Details
        let videoDetails = {
          title: "Unknown",
          channel: "Unknown",
          views: 0,
          likes: 0,
          commentCount: 0,
        };
        try {
          if (subrequestCount >= MAX_SUBREQUESTS) throw new Error("Limit");
          const vUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
          vUrl.searchParams.append("part", "snippet,statistics");
          vUrl.searchParams.append("id", videoId);
          vUrl.searchParams.append("key", apiKey);
          const vRes = await fetch(vUrl.toString());
          subrequestCount++;
          if (vRes.ok) {
            const rawData = (await vRes.json()) as unknown;
            const parsedData = YouTubeVideoSchema.safeParse(rawData);
            if (parsedData.success) {
              const vData = parsedData.data;
              if (vData.items && vData.items.length > 0) {
                const vInfo = vData.items[0];
                videoDetails = {
                  title: vInfo.snippet.title,
                  channel: vInfo.snippet.channelTitle,
                  views: parseInt(vInfo.statistics.viewCount || "0"),
                  likes: parseInt(vInfo.statistics.likeCount || "0"),
                  commentCount: parseInt(vInfo.statistics.commentCount || "0"),
                };
              }
            } else {
              console.error("Failed to parse video details:", parsedData.error.message);
            }
          }
        } catch (e: any) {
          console.error("Error fetching video details:", e.message || e);
        }

        interface CommentData {
          id: string;
          author: string;
          text: string;
          likes: number;
          publishedAt?: string;
        }

        // 2. Fetch Comments (Pagination & Replies)
        let allComments: CommentData[] = [];
        let pageToken = "";
        let pageCount = 0;

        // Hoist URL params — only pageToken varies per iteration
        const threadsUrl = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
        threadsUrl.searchParams.set("part", "snippet,replies");
        threadsUrl.searchParams.set("videoId", videoId);
        threadsUrl.searchParams.set("key", apiKey);
        threadsUrl.searchParams.set("maxResults", "100");
        threadsUrl.searchParams.set("textFormat", "plainText");

        while (pageCount < maxPages) {
          if (pageToken) {
            threadsUrl.searchParams.set("pageToken", pageToken);
          } else {
            threadsUrl.searchParams.delete("pageToken");
          }

          if (subrequestCount >= MAX_SUBREQUESTS) {
            break; // Circuit breaker: stop fetching pages to avoid 500 error
          }
          const response = await fetch(threadsUrl.toString());
          subrequestCount++;
          if (!response.ok) {
            if (pageCount === 0) {
              const errText = await response.text();
              console.error("YouTube API Error:", errText);
              return new Response(JSON.stringify({ error: "Failed to fetch comment threads" }), {
                status: response.status,
                headers: { "Content-Type": "application/json", ...corsHeaders },
              });
            }
            break; // Stop paginating on error
          }

          const rawData = (await response.json()) as unknown;
          const parsedData = YouTubeCommentThreadSchema.safeParse(rawData);
          if (!parsedData.success) {
            console.error("Failed to parse comment threads:", parsedData.error.message);
            break;
          }

          const data = parsedData.data;
          const items = data.items || [];
          if (items.length === 0) break;

          // Fan out per-thread reply fetches in parallel. Intra-stream
          // (nextPageToken) sequencing is preserved inside each handler;
          // cross-stream parallelism is the optimization. allSettled ensures
          // one failing fetch doesn't abort siblings.
          const repliesHandlers = await Promise.allSettled(
            items.map(async (item) => {
              const snippet = item.snippet.topLevelComment.snippet;
              const collected: CommentData[] = [
                {
                  id: item.snippet.topLevelComment.id,
                  author: snippet.authorDisplayName,
                  text: snippet.textOriginal || snippet.textDisplay || "",
                  likes: snippet.likeCount || 0,
                  publishedAt: snippet.publishedAt,
                },
              ];

              // Cache inline replies once per item for O(1) dedup against fetched replies
              const inlineReplies = item.replies?.comments;
              const inlineLen = inlineReplies?.length ?? 0;
              const inlineReplyIds = new Set<string>();
              if (inlineReplies) {
                for (let i = 0; i < inlineLen; i++) inlineReplyIds.add(inlineReplies[i].id);
                for (const reply of inlineReplies) {
                  collected.push({
                    id: reply.id,
                    author: reply.snippet.authorDisplayName,
                    text: reply.snippet.textOriginal || reply.snippet.textDisplay || "",
                    likes: reply.snippet.likeCount || 0,
                    publishedAt: reply.snippet.publishedAt,
                  });
                }
              }

              // If there are more replies than returned inline, fetch them (up to REPLIES_MAX_PAGES)
              if (item.snippet.totalReplyCount > inlineLen) {
                // Circuit breaker: skip this thread's replies block if budget exhausted.
                if (subrequestCount >= MAX_SUBREQUESTS) return collected;

                // Hoist reply URL — only rPageToken varies across iterations
                const rUrl = new URL("https://www.googleapis.com/youtube/v3/comments");
                rUrl.searchParams.set("part", "snippet");
                rUrl.searchParams.set("parentId", item.id);
                rUrl.searchParams.set("key", apiKey);
                rUrl.searchParams.set("maxResults", "100");
                rUrl.searchParams.set("textFormat", "plainText");

                let rPageToken = "";
                let rPageCount = 0;
                while (rPageCount < REPLIES_MAX_PAGES) {
                  try {
                    if (rPageToken) {
                      rUrl.searchParams.set("pageToken", rPageToken);
                    } else {
                      rUrl.searchParams.delete("pageToken");
                    }

                    if (subrequestCount >= MAX_SUBREQUESTS) {
                      break; // Circuit breaker for replies
                    }
                    const rRes = await fetch(rUrl.toString());
                    subrequestCount++;
                    if (rRes.ok) {
                      const rawRData = (await rRes.json()) as unknown;
                      const parsedRData = YouTubeCommentsResponseSchema.safeParse(rawRData);

                      if (parsedRData.success) {
                        const rData = parsedRData.data;
                        for (const reply of rData.items || []) {
                          // O(1) dedup via Set built once per item
                          if (!inlineReplyIds.has(reply.id)) {
                            collected.push({
                              id: reply.id,
                              author: reply.snippet.authorDisplayName,
                              text: reply.snippet.textOriginal || reply.snippet.textDisplay || "",
                              likes: reply.snippet.likeCount || 0,
                              publishedAt: reply.snippet.publishedAt,
                            });
                          }
                        }
                        rPageToken = rData.nextPageToken || "";
                        if (!rPageToken) break;
                      } else {
                        console.error("Failed to parse replies:", parsedRData.error.message);
                        break;
                      }
                    } else {
                      break;
                    }
                  } catch (e) {
                    break;
                  }
                  rPageCount++;
                }
              }
              return collected;
            }),
          );

          for (const result of repliesHandlers) {
            if (result.status === "fulfilled") {
              allComments.push(...result.value);
            }
            // Rejected handlers silently drop that thread's replies — matches
            // prior best-effort semantics where individual fetch failures
            // broke out of the inner loop without aborting the request.
          }

          pageToken = data.nextPageToken;
          if (!pageToken) break;
          pageCount++;
        }

        if (allComments.length === 0) {
          return new Response(JSON.stringify({ error: "No comments found or comments disabled" }), {
            status: 404,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }

        // 3. Process Sentiments
        let positive = 0;
        let negative = 0;
        let neutral = 0;
        let mixed = 0;
        let spam = 0;
        let toxic = 0;
        let buzzer = 0;
        const processedComments = [];
        const recentShingles: { id: string; shingles: Set<string>; groupId: string }[] = [];
        const buzzerRingsMap = new Map<string, { count: number; text: string }>();
        const timeSeriesMap = new Map<string, { pos: number; neg: number }>();

        for (const c of allComments) {
          const res = analyzeEdgeSafe(c.text);
          if (res.label === "POSITIVE") positive++;
          else if (res.label === "NEGATIVE") negative++;
          else if (res.label === "MIXED") mixed++;
          else if (res.label === "NEUTRAL") neutral++;

          if (res.isSpam) spam++;
          if (res.isToxic) toxic++;

          // Buzzer check
          const { normalized } = preprocess(c.text);
          const cShingles = getShingles(normalized);
          let isBuzzer = false;
          let matchedGroup = "";

          if (cShingles.size > 0 && !res.isSpam) {
            for (const recent of recentShingles) {
              const score = jaccard(cShingles, recent.shingles);
              if (score > 0.75) {
                isBuzzer = true;
                matchedGroup = recent.groupId || recent.id;
                if (!recent.groupId) recent.groupId = matchedGroup;
                break;
              }
            }
          }

          if (isBuzzer) {
            buzzer++;
            const existing = buzzerRingsMap.get(matchedGroup) || { count: 0, text: c.text };
            existing.count++;
            buzzerRingsMap.set(matchedGroup, existing);
          }

          if (cShingles.size > 0 && !res.isSpam) {
            recentShingles.push({
              id: c.id || Math.random().toString(),
              shingles: cShingles,
              groupId: matchedGroup,
            });
            if (recentShingles.length > 1000) recentShingles.shift();
          }

          // Time series
          if (c.publishedAt) {
            const dateStr = c.publishedAt.substring(0, 10);
            const ts = timeSeriesMap.get(dateStr) || { pos: 0, neg: 0 };
            if (res.label === "POSITIVE") ts.pos++;
            else if (res.label === "NEGATIVE") ts.neg++;
            timeSeriesMap.set(dateStr, ts);
          }

          processedComments.push({
            ...c,
            sentiment: res.label,
            score: res.score,
            confidence: res.confidence,
            reasoning: res.reasoning,
            isSpam: res.isSpam,
            isToxic: res.isToxic,
            isBuzzer: isBuzzer,
            buzzerGroup: matchedGroup,
          });
        }

        const topPositive = processedComments
          .filter((c) => c.sentiment === "POSITIVE" && !c.isSpam && !c.isToxic && !c.isBuzzer)
          .sort((a, b) => b.likes - a.likes)
          .slice(0, 5);
        const topNegative = processedComments
          .filter((c) => c.sentiment === "NEGATIVE" && !c.isSpam && !c.isToxic && !c.isBuzzer)
          .sort((a, b) => b.likes - a.likes)
          .slice(0, 5);

        const buzzerRings = Array.from(buzzerRingsMap.entries())
          .map(([id, data]) => ({ id, count: data.count, text: data.text }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);

        const timeSeries = Array.from(timeSeriesMap.entries())
          .map(([date, data]) => ({ date, pos: data.pos, neg: data.neg }))
          .sort((a, b) => a.date.localeCompare(b.date));

        const total = positive + negative + neutral + mixed;

        return new Response(
          JSON.stringify({
            videoDetails,
            hasMore: subrequestCount >= MAX_SUBREQUESTS,
            total,
            positive,
            negative,
            neutral,
            mixed,
            spam,
            toxic,
            buzzer,
            topPositive,
            topNegative,
            buzzerRings,
            timeSeries,
            allComments: processedComments, // returned for export capabilities
          }),
          {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          },
        );
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        console.error(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            route: "/api/analyze-video",
            errorMessage: e.message,
            errorName: e.name,
            stack: e.stack,
          }),
        );
        return new Response(JSON.stringify({ error: "Internal error" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
    }

    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  },
};
