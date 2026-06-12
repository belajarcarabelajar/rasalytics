import { analyzeEdgeSafe, preprocess } from "./shared-sentiment.js";

function getShingles(text: string, k = 2): Set<string> {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const shingles = new Set<string>();
  if (words.length < k) {
    if (words.length > 0) shingles.add(words.join(" "));
    return shingles;
  }
  for (let i = 0; i <= words.length - k; i++) {
    shingles.add(words.slice(i, i + k).join(" "));
  }
  return shingles;
}

function jaccard(setA: Set<string>, setB: Set<string>) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const elem of setB) {
    if (setA.has(elem)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

interface Env {
  YOUTUBE_API_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    const url = new URL(request.url);
    
    const origin = request.headers.get("Origin") || "";
    const allowedOrigins = ["http://localhost:8787", "http://127.0.0.1:8787", "http://localhost:3000", "http://127.0.0.1:3000"];
    const allowOrigin = allowedOrigins.includes(origin) ? origin : "https://rasalytics-kurniawaniwan7906.pages.dev";
    
    const corsHeaders = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "X-Content-Type-Options": "nosniff",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      "X-Frame-Options": "DENY"
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
        const body = await request.json() as { videoId?: string; maxPages?: number };
        if (!body.videoId) {
          return new Response(JSON.stringify({ error: "Missing videoId" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
        }
        if (!env.YOUTUBE_API_KEY) {
          return new Response(JSON.stringify({ error: "YOUTUBE_API_KEY not configured on server" }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
        }

        const maxPages = body.maxPages || 1;
        const apiKey = env.YOUTUBE_API_KEY;
        const videoId = body.videoId;

        let subrequestCount = 0;
        const MAX_SUBREQUESTS = 45;

        // 1. Fetch Video Details
        let videoDetails = { title: "Unknown", channel: "Unknown", views: 0, likes: 0, commentCount: 0 };
        try {
          if (subrequestCount >= MAX_SUBREQUESTS) throw new Error("Limit");
          const vUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
          vUrl.searchParams.append("part", "snippet,statistics");
          vUrl.searchParams.append("id", videoId);
          vUrl.searchParams.append("key", apiKey);
          const vRes = await fetch(vUrl.toString());
          subrequestCount++;
          if (vRes.ok) {
            const vData = await vRes.json() as any;
            if (vData.items && vData.items.length > 0) {
              const vInfo = vData.items[0];
              videoDetails = {
                title: vInfo.snippet.title,
                channel: vInfo.snippet.channelTitle,
                views: parseInt(vInfo.statistics.viewCount || "0"),
                likes: parseInt(vInfo.statistics.likeCount || "0"),
                commentCount: parseInt(vInfo.statistics.commentCount || "0")
              };
            }
          }
        } catch (e) {}

        // 2. Fetch Comments (Pagination & Replies)
        let allComments: any[] = [];
        let pageToken = "";
        let pageCount = 0;

        while (pageCount < maxPages) {
          const ytUrl = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
          ytUrl.searchParams.append("part", "snippet,replies");
          ytUrl.searchParams.append("videoId", videoId);
          ytUrl.searchParams.append("key", apiKey);
          ytUrl.searchParams.append("maxResults", "100");
          ytUrl.searchParams.append("textFormat", "plainText");
          if (pageToken) ytUrl.searchParams.append("pageToken", pageToken);

          if (subrequestCount >= MAX_SUBREQUESTS) {
             break; // Circuit breaker: stop fetching pages to avoid 500 error
          }
          const response = await fetch(ytUrl.toString());
          subrequestCount++;
          if (!response.ok) {
            if (pageCount === 0) {
              const errText = await response.text();
              return new Response(JSON.stringify({ error: "YouTube API Error: " + errText }), { status: response.status, headers: { "Content-Type": "application/json", ...corsHeaders } });
            }
            break; // Stop paginating on error
          }
          
          const data = await response.json() as any;
          const items = data.items || [];
          if (items.length === 0) break;

          for (const item of items) {
             const snippet = item.snippet.topLevelComment.snippet;
             allComments.push({
                id: item.snippet.topLevelComment.id,
                author: snippet.authorDisplayName,
                text: snippet.textOriginal || snippet.textDisplay || "",
                likes: snippet.likeCount || 0,
                publishedAt: snippet.publishedAt
             });

             // Gather inline replies
             if (item.replies && item.replies.comments) {
               for (const reply of item.replies.comments) {
                 allComments.push({
                    id: reply.id,
                    author: reply.snippet.authorDisplayName,
                    text: reply.snippet.textOriginal || reply.snippet.textDisplay || "",
                    likes: reply.snippet.likeCount || 0,
                    publishedAt: reply.snippet.publishedAt
                 });
               }
             }

             // If there are more replies than returned inline, fetch them (up to 5 pages)
             if (item.snippet.totalReplyCount > (item.replies?.comments?.length || 0)) {
                let rPageToken = "";
                let rPageCount = 0;
                while (rPageCount < maxPages) {
                  try {
                    const rUrl = new URL("https://www.googleapis.com/youtube/v3/comments");
                    rUrl.searchParams.append("part", "snippet");
                    rUrl.searchParams.append("parentId", item.id);
                    rUrl.searchParams.append("key", apiKey);
                    rUrl.searchParams.append("maxResults", "100");
                    rUrl.searchParams.append("textFormat", "plainText");
                    if (rPageToken) rUrl.searchParams.append("pageToken", rPageToken);

                    if (subrequestCount >= MAX_SUBREQUESTS) {
                       break; // Circuit breaker for replies
                    }
                    const rRes = await fetch(rUrl.toString());
                    subrequestCount++;
                    if (rRes.ok) {
                      const rData = await rRes.json() as any;
                      for (const reply of (rData.items || [])) {
                         // avoid duplicates by checking if we already have it
                         const exists = item.replies?.comments?.some((c: any) => c.id === reply.id);
                         if (!exists) {
                           allComments.push({
                              id: reply.id,
                              author: reply.snippet.authorDisplayName,
                              text: reply.snippet.textOriginal || reply.snippet.textDisplay || "",
                              likes: reply.snippet.likeCount || 0,
                              publishedAt: reply.snippet.publishedAt
                           });
                         }
                      }
                      rPageToken = rData.nextPageToken;
                      if (!rPageToken) break;
                    } else {
                      break;
                    }
                  } catch(e) {
                    break;
                  }
                  rPageCount++;
                }
             }
          }

          pageToken = data.nextPageToken;
          if (!pageToken) break;
          pageCount++;
        }

        if (allComments.length === 0) {
           return new Response(JSON.stringify({ error: "No comments found or comments disabled" }), { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } });
        }

        // 3. Process Sentiments
        let positive = 0; let negative = 0; let neutral = 0; let mixed = 0;
        let spam = 0; let toxic = 0; let buzzer = 0;
        const processedComments = [];
        const recentShingles: {id: string, shingles: Set<string>, groupId: string}[] = [];
        const buzzerRingsMap = new Map<string, {count: number, text: string}>();
        const timeSeriesMap = new Map<string, {pos: number, neg: number}>();

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
             const existing = buzzerRingsMap.get(matchedGroup) || {count: 0, text: c.text};
             existing.count++;
             buzzerRingsMap.set(matchedGroup, existing);
           }

           if (cShingles.size > 0 && !res.isSpam) {
             recentShingles.push({id: c.id || Math.random().toString(), shingles: cShingles, groupId: matchedGroup});
             if (recentShingles.length > 1000) recentShingles.shift();
           }

           // Time series
           if (c.publishedAt) {
             const dateStr = c.publishedAt.substring(0, 10);
             const ts = timeSeriesMap.get(dateStr) || {pos: 0, neg: 0};
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
             buzzerGroup: matchedGroup
           });
        }
        
        const topPositive = processedComments.filter(c => c.sentiment === "POSITIVE" && !c.isSpam && !c.isToxic && !c.isBuzzer).sort((a,b) => b.likes - a.likes).slice(0, 5);
        const topNegative = processedComments.filter(c => c.sentiment === "NEGATIVE" && !c.isSpam && !c.isToxic && !c.isBuzzer).sort((a,b) => b.likes - a.likes).slice(0, 5);

        const buzzerRings = Array.from(buzzerRingsMap.entries())
            .map(([id, data]) => ({ id, count: data.count, text: data.text }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        const timeSeries = Array.from(timeSeriesMap.entries())
            .map(([date, data]) => ({ date, pos: data.pos, neg: data.neg }))
            .sort((a, b) => a.date.localeCompare(b.date));

        const total = positive + negative + neutral + mixed;
        
        return new Response(JSON.stringify({
           videoDetails,
           total, positive, negative, neutral, mixed, spam, toxic, buzzer,
           topPositive,
           topNegative,
           buzzerRings,
           timeSeries,
           allComments: processedComments // returned for export capabilities
        }), {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });

      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message || "Internal Server Error" }), {
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
