import { expect, test, spyOn } from "bun:test";
import worker from "./worker.js";
import { getShingles, jaccard } from "../../packages/sentiment-core/src/forensics.js";
import { preprocess } from "../../packages/sentiment-core/src/shared-sentiment.js";

const BASE = "https://rasalytics.pages.dev";
const ENV = { YOUTUBE_API_KEY: "dummy" };
const VID = "dQw4w9WgXcQ";

type Route = (url: URL) => Response | Promise<Response>;

// Replaces global fetch with a router and records every requested URL
function mockFetch(route: Route) {
  const calls: URL[] = [];
  const spy = spyOn(globalThis, "fetch").mockImplementation((async (input: any) => {
    const url = new URL(String(input));
    calls.push(url);
    return route(url);
  }) as any);
  const callsTo = (pathname: string) => calls.filter((u) => u.pathname === pathname);
  return { spy, calls, callsTo };
}

function silenceConsoleError() {
  return spyOn(console, "error").mockImplementation(() => {});
}

function loggedWith(spy: ReturnType<typeof silenceConsoleError>, prefix: string): boolean {
  return spy.mock.calls.some((args: any[]) => String(args[0]).startsWith(prefix));
}

function videoOk(): Response {
  return Response.json({
    items: [
      {
        snippet: { title: "Mock Video", channelTitle: "Mock Channel" },
        statistics: { viewCount: "100", likeCount: "50", commentCount: "5" },
      },
    ],
  });
}

function ytComment(id: string, text: string, likes = 1, publishedAt = "2026-07-06T10:00:00Z") {
  return {
    id,
    snippet: { authorDisplayName: "user_01", textOriginal: text, likeCount: likes, publishedAt },
  };
}

function threadItem(threadId: string, top: unknown, totalReplyCount = 0, inlineReplies?: unknown[]) {
  return {
    id: threadId,
    snippet: { totalReplyCount, topLevelComment: top },
    ...(inlineReplies ? { replies: { comments: inlineReplies } } : {}),
  };
}

function analyzeRequest(body: unknown): Request {
  return new Request(`${BASE}/api/analyze-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("OPTIONS preflight returns empty body with CORS headers echoing an allowed origin", async () => {
  const request = new Request(`${BASE}/api/analyze-video`, {
    method: "OPTIONS",
    headers: { Origin: "http://localhost:3000" },
  });
  const response = await worker.fetch(request, ENV, {});
  expect(response.status).toBe(200);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
  expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, GET, OPTIONS");
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
  expect(await response.text()).toBe("");
});

test("GET /api/health returns ok status with JSON and security headers", async () => {
  const response = await worker.fetch(new Request(`${BASE}/api/health`), ENV, {});
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("application/json");
  expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(await response.json()).toEqual({ status: "ok", type: "edge-sentiment" });
});

test("CORS echoes preview subdomains of rasalytics.pages.dev", async () => {
  const request = new Request(`${BASE}/api/health`, {
    headers: { Origin: "https://preview-123.rasalytics.pages.dev" },
  });
  const response = await worker.fetch(request, ENV, {});
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
    "https://preview-123.rasalytics.pages.dev",
  );
});

test("CORS falls back to the default origin for unknown or look-alike origins", async () => {
  for (const origin of ["https://evil.example.com", "https://evilrasalytics.pages.dev"]) {
    const request = new Request(`${BASE}/api/health`, { headers: { Origin: origin } });
    const response = await worker.fetch(request, ENV, {});
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://rasalytics.pages.dev");
  }
});

test("Unknown routes and wrong methods return 404 Not Found", async () => {
  const requests = [
    new Request(`${BASE}/api/unknown`),
    new Request(`${BASE}/api/analyze-video`),
    new Request(`${BASE}/api/health`, { method: "POST" }),
  ];
  for (const request of requests) {
    const response = await worker.fetch(request, ENV, {});
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.json()).toEqual({ error: "Not Found" });
  }
});

test("POST /api/analyze-video without YOUTUBE_API_KEY returns 500 and makes no fetch", async () => {
  const { spy, calls } = mockFetch(() => Response.json({}));
  try {
    const response = await worker.fetch(analyzeRequest({ videoId: VID }), {}, {});
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "YOUTUBE_API_KEY not configured on server" });
    expect(calls).toHaveLength(0);
  } finally {
    spy.mockRestore();
  }
});

test("POST /api/analyze-video with malformed JSON body returns 500 Internal error", async () => {
  const consoleSpy = silenceConsoleError();
  try {
    const request = new Request(`${BASE}/api/analyze-video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    const response = await worker.fetch(request, ENV, {});
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal error" });
    expect(loggedWith(consoleSpy, "Worker error handling /api/analyze-video:")).toBe(true);
  } finally {
    consoleSpy.mockRestore();
  }
});

test("POST /api/analyze-video propagates the status when the first comment page fails", async () => {
  const consoleSpy = silenceConsoleError();
  const { spy } = mockFetch((url) => {
    if (url.pathname === "/youtube/v3/videos") return videoOk();
    return new Response("quota exceeded", { status: 403 });
  });
  try {
    const response = await worker.fetch(analyzeRequest({ videoId: VID }), ENV, {});
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Failed to fetch comment threads" });
    expect(
      consoleSpy.mock.calls.some(
        (args: any[]) => args[0] === "YouTube API Error:" && args[1] === "quota exceeded",
      ),
    ).toBe(true);
  } finally {
    spy.mockRestore();
    consoleSpy.mockRestore();
  }
});

test("POST /api/analyze-video returns 404 when the video has no comments", async () => {
  const { spy } = mockFetch((url) => {
    if (url.pathname === "/youtube/v3/videos") return videoOk();
    return Response.json({ items: [] });
  });
  try {
    const response = await worker.fetch(analyzeRequest({ videoId: VID }), ENV, {});
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "No comments found or comments disabled" });
  } finally {
    spy.mockRestore();
  }
});

test("POST /api/analyze-video treats an unparseable comment thread page as no comments", async () => {
  const consoleSpy = silenceConsoleError();
  const { spy } = mockFetch((url) => {
    if (url.pathname === "/youtube/v3/videos") return videoOk();
    return Response.json({ items: [{ id: 123 }] });
  });
  try {
    const response = await worker.fetch(analyzeRequest({ videoId: VID }), ENV, {});
    expect(response.status).toBe(404);
    expect(loggedWith(consoleSpy, "Failed to parse comment threads:")).toBe(true);
  } finally {
    spy.mockRestore();
    consoleSpy.mockRestore();
  }
});

test("POST /api/analyze-video keeps Unknown video details when the details payload is invalid", async () => {
  const consoleSpy = silenceConsoleError();
  const { spy } = mockFetch((url) => {
    if (url.pathname === "/youtube/v3/videos") {
      return Response.json({ items: [{ snippet: { title: 123 } }] });
    }
    return Response.json({ items: [threadItem("t1", ytComment("c1", "bagus sekali videonya"))] });
  });
  try {
    const response = await worker.fetch(analyzeRequest({ videoId: VID }), ENV, {});
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.videoDetails).toEqual({
      title: "Unknown",
      channel: "Unknown",
      views: 0,
      likes: 0,
      commentCount: 0,
    });
    expect(data.allComments.map((c: any) => c.id)).toEqual(["c1"]);
    expect(loggedWith(consoleSpy, "Failed to parse video details:")).toBe(true);
  } finally {
    spy.mockRestore();
    consoleSpy.mockRestore();
  }
});

test("POST /api/analyze-video fetches only one page by default even when nextPageToken exists", async () => {
  const { spy, callsTo } = mockFetch((url) => {
    if (url.pathname === "/youtube/v3/videos") return videoOk();
    return Response.json({
      nextPageToken: "NEXT",
      items: [threadItem("t1", ytComment("c1", "bagus sekali videonya"))],
    });
  });
  try {
    const response = await worker.fetch(analyzeRequest({ videoId: VID }), ENV, {});
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(callsTo("/youtube/v3/commentThreads")).toHaveLength(1);
    expect(data.allComments).toHaveLength(1);
    expect(data.hasMore).toBe(false);
  } finally {
    spy.mockRestore();
  }
});

test("POST /api/analyze-video follows nextPageToken up to maxPages pages", async () => {
  let page = 0;
  const { spy, callsTo } = mockFetch((url) => {
    if (url.pathname === "/youtube/v3/videos") return videoOk();
    page++;
    return Response.json({
      nextPageToken: "NEXT",
      items: [threadItem(`t${page}`, ytComment(`c${page}`, "bagus sekali videonya"))],
    });
  });
  try {
    const response = await worker.fetch(analyzeRequest({ videoId: VID, maxPages: 2 }), ENV, {});
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    const threadCalls = callsTo("/youtube/v3/commentThreads");
    expect(threadCalls).toHaveLength(2);
    expect(threadCalls[0]!.searchParams.has("pageToken")).toBe(false);
    expect(threadCalls[1]!.searchParams.get("pageToken")).toBe("NEXT");
    expect(data.allComments.map((c: any) => c.id)).toEqual(["c1", "c2"]);
  } finally {
    spy.mockRestore();
  }
});

test("POST /api/analyze-video stops paginating on a later page error and keeps earlier comments", async () => {
  const { spy, callsTo } = mockFetch((url) => {
    if (url.pathname === "/youtube/v3/videos") return videoOk();
    if (url.searchParams.get("pageToken") === "PAGE2") {
      return new Response("server error", { status: 500 });
    }
    return Response.json({
      nextPageToken: "PAGE2",
      items: [threadItem("t1", ytComment("c1", "bagus sekali videonya"))],
    });
  });
  try {
    const response = await worker.fetch(analyzeRequest({ videoId: VID, maxPages: 3 }), ENV, {});
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(callsTo("/youtube/v3/commentThreads")).toHaveLength(2);
    expect(data.allComments.map((c: any) => c.id)).toEqual(["c1"]);
  } finally {
    spy.mockRestore();
  }
});

test("POST /api/analyze-video collects inline replies with textDisplay and like fallbacks", async () => {
  const inlineReply = {
    id: "reply_1",
    snippet: {
      authorDisplayName: "user_02",
      textDisplay: "mantap terima kasih ilmunya",
      publishedAt: "2026-07-07T10:00:00Z",
    },
  };
  const { spy, callsTo } = mockFetch((url) => {
    if (url.pathname === "/youtube/v3/videos") {
      return Response.json({
        items: [
          {
            snippet: { title: "Mock Video", channelTitle: "Mock Channel" },
            statistics: { viewCount: "1234" },
          },
        ],
      });
    }
    return Response.json({
      items: [threadItem("t1", ytComment("c_top", "bagus sekali videonya", 3), 1, [inlineReply])],
    });
  });
  try {
    const response = await worker.fetch(analyzeRequest({ videoId: VID }), ENV, {});
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.videoDetails).toEqual({
      title: "Mock Video",
      channel: "Mock Channel",
      views: 1234,
      likes: 0,
      commentCount: 0,
    });
    expect(data.allComments.map((c: any) => c.id)).toEqual(["c_top", "reply_1"]);
    expect(data.allComments[1]).toMatchObject({
      author: "user_02",
      text: "mantap terima kasih ilmunya",
      likes: 0,
      publishedAt: "2026-07-07T10:00:00Z",
    });
    // All replies were inline, so no extra replies request is needed
    expect(callsTo("/youtube/v3/comments")).toHaveLength(0);
  } finally {
    spy.mockRestore();
  }
});

test("POST /api/analyze-video pages through extra replies and skips inline duplicates", async () => {
  const r1 = ytComment("r1", "keren banget penjelasannya");
  const { spy, callsTo } = mockFetch((url) => {
    if (url.pathname === "/youtube/v3/videos") return videoOk();
    if (url.pathname === "/youtube/v3/comments") {
      if (url.searchParams.get("pageToken") === "R2") {
        return Response.json({ items: [ytComment("r3", "mantap terima kasih ilmunya")] });
      }
      return Response.json({
        nextPageToken: "R2",
        items: [r1, ytComment("r2", "bagus sekali videonya")],
      });
    }
    return Response.json({
      items: [threadItem("thread_1", ytComment("c_top", "bagus sekali videonya"), 3, [r1])],
    });
  });
  try {
    const response = await worker.fetch(analyzeRequest({ videoId: VID, maxPages: 2 }), ENV, {});
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.allComments.map((c: any) => c.id)).toEqual(["c_top", "r1", "r2", "r3"]);
    const replyCalls = callsTo("/youtube/v3/comments");
    expect(replyCalls).toHaveLength(2);
    expect(replyCalls[0]!.searchParams.get("parentId")).toBe("thread_1");
    expect(replyCalls[0]!.searchParams.has("pageToken")).toBe(false);
    expect(replyCalls[1]!.searchParams.get("parentId")).toBe("thread_1");
    expect(replyCalls[1]!.searchParams.get("pageToken")).toBe("R2");
  } finally {
    spy.mockRestore();
  }
});

test("POST /api/analyze-video ignores an unparseable replies payload but keeps the top comment", async () => {
  const consoleSpy = silenceConsoleError();
  const { spy, callsTo } = mockFetch((url) => {
    if (url.pathname === "/youtube/v3/videos") return videoOk();
    if (url.pathname === "/youtube/v3/comments") return Response.json({ items: [{ id: 42 }] });
    return Response.json({
      items: [threadItem("t1", ytComment("c_top", "bagus sekali videonya"), 2)],
    });
  });
  try {
    const response = await worker.fetch(analyzeRequest({ videoId: VID, maxPages: 3 }), ENV, {});
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.allComments.map((c: any) => c.id)).toEqual(["c_top"]);
    expect(callsTo("/youtube/v3/comments")).toHaveLength(1);
    expect(loggedWith(consoleSpy, "Failed to parse replies:")).toBe(true);
  } finally {
    spy.mockRestore();
    consoleSpy.mockRestore();
  }
});

test("POST /api/analyze-video stops fetching replies after a non-OK replies response", async () => {
  const { spy, callsTo } = mockFetch((url) => {
    if (url.pathname === "/youtube/v3/videos") return videoOk();
    if (url.pathname === "/youtube/v3/comments") return new Response("error", { status: 500 });
    return Response.json({
      items: [threadItem("t1", ytComment("c_top", "bagus sekali videonya"), 2)],
    });
  });
  try {
    const response = await worker.fetch(analyzeRequest({ videoId: VID, maxPages: 3 }), ENV, {});
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.allComments.map((c: any) => c.id)).toEqual(["c_top"]);
    expect(callsTo("/youtube/v3/comments")).toHaveLength(1);
  } finally {
    spy.mockRestore();
  }
});

test("POST /api/analyze-video trips the 45-subrequest circuit breaker and reports hasMore", async () => {
  let page = 0;
  const { spy, calls, callsTo } = mockFetch((url) => {
    if (url.pathname === "/youtube/v3/videos") return videoOk();
    if (url.pathname === "/youtube/v3/comments") {
      // Replies endpoint always claims there is another page
      return Response.json({ nextPageToken: "MORE", items: [] });
    }
    page++;
    return Response.json({
      nextPageToken: "NEXT",
      items: [
        threadItem(`ta${page}`, ytComment(`ca${page}`, "bagus sekali videonya"), 5),
        threadItem(`tb${page}`, ytComment(`cb${page}`, "keren banget penjelasannya"), 5),
      ],
    });
  });
  try {
    const response = await worker.fetch(analyzeRequest({ videoId: VID, maxPages: 10 }), ENV, {});
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    // 1 video + 3 thread pages + 41 reply pages = 45 subrequests
    expect(calls).toHaveLength(45);
    expect(callsTo("/youtube/v3/commentThreads")).toHaveLength(3);
    expect(callsTo("/youtube/v3/comments")).toHaveLength(41);
    expect(data.hasMore).toBe(true);
    expect(data.allComments.map((c: any) => c.id)).toEqual([
      "ca1",
      "cb1",
      "ca2",
      "cb2",
      "ca3",
      "cb3",
    ]);
  } finally {
    spy.mockRestore();
  }
});

test("POST /api/analyze-video groups identical comments into a buzzer ring keyed by the first comment", async () => {
  const text = "keren banget penjelasannya";
  const { spy } = mockFetch((url) => {
    if (url.pathname === "/youtube/v3/videos") return videoOk();
    return Response.json({
      items: [
        threadItem("t1", ytComment("b1", text, 1)),
        threadItem("t2", ytComment("b2", text, 9)),
        threadItem("t3", ytComment("b3", text, 5)),
      ],
    });
  });
  try {
    const response = await worker.fetch(analyzeRequest({ videoId: VID }), ENV, {});
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.buzzer).toBe(2);
    expect(data.buzzerRings).toEqual([{ id: "b1", count: 2, text }]);
    expect(data.allComments.map((c: any) => [c.isBuzzer, c.buzzerGroup])).toEqual([
      [false, ""],
      [true, "b1"],
      [true, "b1"],
    ]);
    // Buzzer copies are excluded from the top positive ranking despite more likes
    expect(data.topPositive.map((c: any) => c.id)).toEqual(["b1"]);
  } finally {
    spy.mockRestore();
  }
});

// Hand-written (not model output): kills the mutant that raises the 0.75 threshold. The existing buzzer
// test only uses identical texts (similarity 1.0), which pass at any threshold below 1.
test("POST /api/analyze-video flags a near-duplicate (similarity between 0.75 and 1) as buzzer", async () => {
  const original = "keren banget penjelasannya mantap sekali bang lanjutkan terus kontennya";
  const variant = "keren banget penjelasannya mantap sekali bang lanjutkan terus videonya";
  // Precondition that makes this test meaningful: 7 of 9 shingles shared = 0.778, above 0.75, below 0.95.
  const similarity = jaccard(getShingles(preprocess(original).normalized), getShingles(preprocess(variant).normalized));
  expect(similarity).toBeGreaterThan(0.75);
  expect(similarity).toBeLessThan(0.95);

  const { spy } = mockFetch((url) => {
    if (url.pathname === "/youtube/v3/videos") return videoOk();
    return Response.json({
      items: [threadItem("t1", ytComment("n1", original, 1)), threadItem("t2", ytComment("n2", variant, 1))],
    });
  });
  try {
    const response = await worker.fetch(analyzeRequest({ videoId: VID }), ENV, {});
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.buzzer).toBe(1);
    expect(data.buzzerRings).toEqual([{ id: "n1", count: 1, text: variant }]);
    expect(data.allComments.map((c: any) => [c.isBuzzer, c.buzzerGroup])).toEqual([
      [false, ""],
      [true, "n1"],
    ]);
  } finally {
    spy.mockRestore();
  }
});
