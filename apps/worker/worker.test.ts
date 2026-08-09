import { expect, test, spyOn } from "bun:test";
import worker from "./worker.js";

test("POST /api/analyze-video with invalid body returns 400 error", async () => {
  const request = new Request("https://rasalytics.pages.dev/api/analyze-video", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ videoId: "" }), // invalid, empty
  });

  const env = { YOUTUBE_API_KEY: "dummy" };
  const ctx = {};

  const response = await worker.fetch(request, env, ctx);
  expect(response.status).toBe(400);

  const data = (await response.json()) as any;
  expect(data.error).toContain("Missing videoId");
});

test("POST /api/analyze-video handles video details fetch error gracefully", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (url: any) => {
    const urlStr = String(url);
    if (urlStr.includes("youtube/v3/videos")) {
      throw new Error("Simulated network error fetching video details");
    }
    if (urlStr.includes("youtube/v3/commentThreads")) {
      return new Response(
        JSON.stringify({
          items: [
            {
              snippet: {
                topLevelComment: {
                  id: "comment_id_1",
                  snippet: {
                    authorDisplayName: "Mock User",
                    textOriginal: "This is a mock comment.",
                    likeCount: 10,
                    publishedAt: "2026-07-06T00:00:00Z",
                  },
                },
                totalReplyCount: 0,
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as any);

  const request = new Request("https://rasalytics.pages.dev/api/analyze-video", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ videoId: "test_video_id_error", maxPages: 1 }),
  });

  const env = { YOUTUBE_API_KEY: "dummy" };
  const ctx = {};

  try {
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.videoDetails.title).toBe("Unknown");
    expect(data.videoDetails.channel).toBe("Unknown");
    expect(data.videoDetails.views).toBe(0);
    expect(data.videoDetails.likes).toBe(0);
    expect(data.videoDetails.commentCount).toBe(0);
    expect(data.total).toBe(1);
  } finally {
    fetchSpy.mockRestore();
  }
});

test("POST /api/analyze-video with maxPages exactly the boundary (10) passes validation", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (url: any) => {
    const urlStr = String(url);
    if (urlStr.includes("youtube/v3/videos")) {
      return new Response(
        JSON.stringify({
          items: [
            {
              snippet: { title: "Mock Video", channelTitle: "Mock Channel" },
              statistics: { viewCount: "100", likeCount: "50", commentCount: "5" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (urlStr.includes("youtube/v3/commentThreads")) {
      return new Response(
        JSON.stringify({
          items: [
            {
              snippet: {
                topLevelComment: {
                  id: "comment_id_1",
                  snippet: {
                    authorDisplayName: "Mock User",
                    textOriginal: "This is a mock comment.",
                    likeCount: 10,
                    publishedAt: "2026-07-06T00:00:00Z",
                  },
                },
                totalReplyCount: 0,
              },
              id: "thread_id_1",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as any);

  const request = new Request("https://rasalytics.pages.dev/api/analyze-video", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ videoId: "test_video_id", maxPages: 10 }),
  });

  const env = { YOUTUBE_API_KEY: "dummy" };
  const ctx = {};

  try {
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.videoDetails.title).toBe("Mock Video");
    expect(data.total).toBe(1);
  } finally {
    fetchSpy.mockRestore();
  }
});

test("POST /api/analyze-video with maxPages one below the boundary (9) passes validation", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (url: any) => {
    const urlStr = String(url);
    if (urlStr.includes("youtube/v3/videos")) {
      return new Response(
        JSON.stringify({
          items: [
            {
              snippet: { title: "Mock Video 2", channelTitle: "Mock Channel 2" },
              statistics: { viewCount: "100", likeCount: "50", commentCount: "5" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (urlStr.includes("youtube/v3/commentThreads")) {
      return new Response(
        JSON.stringify({
          items: [
            {
              snippet: {
                topLevelComment: {
                  id: "comment_id_2",
                  snippet: {
                    authorDisplayName: "Mock User 2",
                    textOriginal: "This is another mock comment.",
                    likeCount: 5,
                    publishedAt: "2026-07-06T00:00:00Z",
                  },
                },
                totalReplyCount: 0,
              },
              id: "thread_id_2",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as any);

  const request = new Request("https://rasalytics.pages.dev/api/analyze-video", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ videoId: "test_video_id", maxPages: 9 }),
  });

  const env = { YOUTUBE_API_KEY: "dummy" };
  const ctx = {};

  try {
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.videoDetails.title).toBe("Mock Video 2");
    expect(data.total).toBe(1);
  } finally {
    fetchSpy.mockRestore();
  }
});

test("POST /api/analyze-video with maxPages one above the boundary (11) fails validation with structured error", async () => {
  const request = new Request("https://rasalytics.pages.dev/api/analyze-video", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ videoId: "test_video_id", maxPages: 11 }),
  });

  const env = { YOUTUBE_API_KEY: "dummy" };
  const ctx = {};

  const response = await worker.fetch(request, env, ctx);
  expect(response.status).toBe(400);

  const data = (await response.json()) as any;
  expect(data.error).toContain("maxPages must be 10 or fewer");
  expect(data.details).toBeArray();
  expect(data.details).toHaveLength(1);
  expect(data.details[0].path).toBe("maxPages");
  expect(data.details[0].message).toBe("maxPages must be 10 or fewer");
});

test("POST /api/analyze-video validation failure does not allow log forging via receivedValue (CWE-117)", async () => {
  const errorSpy = spyOn(console, "error").mockImplementation(() => {});

  // Attacker payload: maxPages is given a string that fails the number check,
  // and the value embeds a newline + fake log line. If console.error were
  // called with template-string interpolation of receivedValue, the fake
  // line would appear as a separate log entry.
  const forgedSuffix = "\n2026-01-01T00:00:00Z [FAKE] admin login succeeded";
  const request = new Request("https://rasalytics.pages.dev/api/analyze-video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoId: "valid_id", maxPages: forgedSuffix }),
  });

  const env = { YOUTUBE_API_KEY: "dummy" };
  const ctx = {};

  try {
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(400);

    // Filter to only the structured validation_failed entries this test produced.
    // (console.error is shared; other test paths may emit non-JSON logs.)
    const validationLogs = errorSpy.mock.calls
      .map((c) => c[0])
      .filter((v): v is string => typeof v === "string")
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter((p) => p && p.event === "validation_failed");

    expect(validationLogs.length).toBeGreaterThan(0);

    // Every structured log entry must be a single line (no raw \n / \r) and
    // must have the forged newline encoded as an escape sequence.
    for (const entry of validationLogs) {
      const raw = JSON.stringify(entry);
      expect(raw.includes("\n")).toBe(false);
      expect(raw.includes("\r")).toBe(false);
      if (entry.path === "maxPages") {
        expect(entry.receivedValue).toContain("\\n");
      }
    }

    // Guard: no captured log string may contain a raw (unescaped) newline,
    // because raw newlines are what allow log aggregators to be fooled into
    // treating attacker input as a separate log entry.
    for (const call of errorSpy.mock.calls) {
      const logged = String(call[0]);
      expect(logged.includes("\n")).toBe(false);
      expect(logged.includes("\r")).toBe(false);
    }
  } finally {
    errorSpy.mockRestore();
  }
});

test("POST /api/analyze-video outer catch logs structured JSON and returns 500", async () => {
  const jsonSpy = spyOn(Request.prototype, "json").mockImplementation(async () => {
    throw new Error("Simulated body parse failure");
  });
  const errorSpy = spyOn(console, "error").mockImplementation(() => {});

  const request = new Request("https://rasalytics.pages.dev/api/analyze-video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoId: "test_video_id" }),
  });

  const env = { YOUTUBE_API_KEY: "dummy" };
  const ctx = {};

  try {
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(500);
    const data = (await response.json()) as any;
    expect(data).toEqual({ error: "Internal error" });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = errorSpy.mock.calls[0][0] as string;
    expect(typeof logged).toBe("string");
    const parsed = JSON.parse(logged);
    expect(parsed.route).toBe("/api/analyze-video");
    expect(parsed.errorMessage).toBe("Simulated body parse failure");
    expect(parsed.errorName).toBe("Error");
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(typeof parsed.stack).toBe("string");
  } finally {
    jsonSpy.mockRestore();
    errorSpy.mockRestore();
  }
});

test("POST /api/analyze-video handles fetch replies exception gracefully", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (url: any) => {
    const urlStr = String(url);
    if (urlStr.includes("youtube/v3/videos")) {
      return new Response(
        JSON.stringify({
          items: [
            {
              snippet: { title: "Mock Video", channelTitle: "Mock Channel" },
              statistics: { viewCount: "100", likeCount: "50", commentCount: "5" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (urlStr.includes("youtube/v3/commentThreads")) {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "parent_comment_1",
              snippet: {
                topLevelComment: {
                  id: "comment_id_1",
                  snippet: {
                    authorDisplayName: "Mock User",
                    textOriginal: "This is a mock comment.",
                    likeCount: 10,
                    publishedAt: "2026-07-06T00:00:00Z",
                  },
                },
                totalReplyCount: 1, // Triggers fetch to /youtube/v3/comments
              },
              replies: {
                comments: [], // No inline replies, forcing the fetch
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (urlStr.includes("youtube/v3/comments")) {
      throw new Error("Simulated network error fetching replies");
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as any);

  const request = new Request("https://rasalytics.pages.dev/api/analyze-video", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ videoId: "test_video_id", maxPages: 1 }),
  });

  const env = { YOUTUBE_API_KEY: "dummy" };
  const ctx = {};

  try {
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.videoDetails.title).toBe("Mock Video");
    // Ensure the main comment is still processed despite the error fetching replies
    expect(data.total).toBe(1);
    expect(data.allComments).toHaveLength(1);
    expect(data.allComments[0].id).toBe("comment_id_1");
  } finally {
    fetchSpy.mockRestore();
  }
});

test("perf: pagination 5 pages x 20 items x 10 inline replies stays under 500ms", async () => {
  const PAGES = 5;
  const ITEMS_PER_PAGE = 20;
  const INLINE_REPLIES_PER_ITEM = 10;

  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (url: any) => {
    const u = new URL(String(url));

    if (u.pathname.endsWith("/videos")) {
      return new Response(
        JSON.stringify({
          items: [
            {
              snippet: { title: "T", channelTitle: "C" },
              statistics: { viewCount: "1", likeCount: "1", commentCount: "100" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (u.pathname.endsWith("/commentThreads")) {
      const pageToken = u.searchParams.get("pageToken") || "0";
      const pageIdx = parseInt(pageToken, 10) || 0;
      const nextToken = pageIdx + 1 < PAGES ? String(pageIdx + 1) : "";
      const items = Array.from({ length: ITEMS_PER_PAGE }, (_, i) => ({
        id: `t_${pageIdx}_${i}`,
        snippet: {
          totalReplyCount: INLINE_REPLIES_PER_ITEM,
          topLevelComment: {
            id: `c_${pageIdx}_${i}`,
            snippet: {
              authorDisplayName: `User ${i}`,
              textOriginal: `Comment ${i}`,
              likeCount: 0,
              publishedAt: "2026-01-01T00:00:00Z",
            },
          },
        },
        replies: {
          comments: Array.from({ length: INLINE_REPLIES_PER_ITEM }, (_, r) => ({
            id: `r_${pageIdx}_${i}_${r}`,
            snippet: {
              authorDisplayName: `Replier ${r}`,
              textOriginal: `Reply ${r}`,
              likeCount: 0,
              publishedAt: "2026-01-01T00:00:00Z",
            },
          })),
        },
      }));
      return new Response(JSON.stringify({ items, nextPageToken: nextToken }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // replies endpoint — not triggered here (inline >= totalReplyCount)
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  }) as any);

  const env = { YOUTUBE_API_KEY: "dummy" };
  const ctx = {};

  const makeRequest = (videoId: string, maxPages: number) =>
    new Request("https://rasalytics.pages.dev/api/analyze-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId, maxPages }),
    });

  try {
    // JIT warmup pass — separate videoId, maxPages=1
    await worker.fetch(makeRequest("warmup", 1), env, ctx);

    const start = performance.now();
    const response = await worker.fetch(makeRequest("perf_test", PAGES), env, ctx);
    const elapsed = performance.now() - start;

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    // 1 top-level + INLINE_REPLIES_PER_ITEM per item, per page
    expect(data.total).toBe(PAGES * ITEMS_PER_PAGE * (1 + INLINE_REPLIES_PER_ITEM));

    // Loose threshold to avoid CI flake. Tighten as baseline stabilizes.
    console.log(`perf: pagination elapsed=${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(500);
  } finally {
    fetchSpy.mockRestore();
  }
});

test("perf: replies fan-out across threads with reply pages", async () => {
  const PAGES = 1;
  const ITEMS_PER_PAGE = 10;
  const INLINE_REPLIES_PER_ITEM = 2;
  const REPLIES_PAGES = 3; // hits REPLIES_MAX_PAGES cap (3)
  const REPLIES_PER_PAGE = 5;

  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (url: any) => {
    const u = new URL(String(url));

    if (u.pathname.endsWith("/videos")) {
      return new Response(
        JSON.stringify({
          items: [
            {
              snippet: { title: "T", channelTitle: "C" },
              statistics: { viewCount: "1", likeCount: "1", commentCount: "100" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (u.pathname.endsWith("/commentThreads")) {
      const items = Array.from({ length: ITEMS_PER_PAGE }, (_, i) => ({
        id: `t_${i}`,
        snippet: {
          // Force replies path: totalReplyCount > inlineLen
          totalReplyCount: INLINE_REPLIES_PER_ITEM + REPLIES_PAGES * REPLIES_PER_PAGE,
          topLevelComment: {
            id: `c_${i}`,
            snippet: {
              authorDisplayName: `User ${i}`,
              textOriginal: `Comment ${i}`,
              likeCount: 0,
              publishedAt: "2026-01-01T00:00:00Z",
            },
          },
        },
        replies: {
          comments: Array.from({ length: INLINE_REPLIES_PER_ITEM }, (_, r) => ({
            id: `inline_${i}_${r}`,
            snippet: {
              authorDisplayName: `InlineReplier ${r}`,
              textOriginal: `Inline reply ${r}`,
              likeCount: 0,
              publishedAt: "2026-01-01T00:00:00Z",
            },
          })),
        },
      }));
      return new Response(JSON.stringify({ items, nextPageToken: "" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // /comments endpoint — pagination via pageToken
    if (u.pathname.endsWith("/comments")) {
      const parentId = u.searchParams.get("parentId");
      const pageToken = u.searchParams.get("pageToken") || "0";
      const pageIdx = parseInt(pageToken, 10) || 0;
      const nextToken = pageIdx + 1 < REPLIES_PAGES ? String(pageIdx + 1) : "";
      const items = Array.from({ length: REPLIES_PER_PAGE }, (_, r) => ({
        id: `reply_${parentId}_${pageIdx}_${r}`,
        snippet: {
          authorDisplayName: `Replier ${r}`,
          textOriginal: `Reply ${r}`,
          likeCount: 0,
          publishedAt: "2026-01-01T00:00:00Z",
        },
      }));
      return new Response(JSON.stringify({ items, nextPageToken: nextToken }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  }) as any);

  const env = { YOUTUBE_API_KEY: "dummy" };
  const ctx = {};

  const makeRequest = (videoId: string, maxPages: number) =>
    new Request("https://rasalytics.pages.dev/api/analyze-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId, maxPages }),
    });

  try {
    // JIT warmup
    await worker.fetch(makeRequest("warmup_replies", 1), env, ctx);

    const start = performance.now();
    const response = await worker.fetch(makeRequest("perf_replies", PAGES), env, ctx);
    const elapsed = performance.now() - start;

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    // Expected: top-level (1) + inline (INLINE) + fetched (PAGES*PER_PAGE) per item
    const expectedPerItem = 1 + INLINE_REPLIES_PER_ITEM + REPLIES_PAGES * REPLIES_PER_PAGE;
    expect(data.total).toBe(PAGES * ITEMS_PER_PAGE * expectedPerItem);

    console.log(`perf: replies fan-out elapsed=${elapsed.toFixed(2)}ms`);
    // Generous threshold; the win is relative to baseline, not absolute.
    expect(elapsed).toBeLessThan(1000);
  } finally {
    fetchSpy.mockRestore();
  }
});
