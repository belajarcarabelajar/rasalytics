import { expect, test, spyOn } from "bun:test";
import worker from "./worker.js";

const BASE = "https://rasalytics.pages.dev";
const ENV = { YOUTUBE_API_KEY: "dummy" };
const VALID_ID = "dQw4w9WgXcQ";

type Route = (url: URL) => Response | Promise<Response>;

// Replaces global fetch with a router and records every requested URL
function mockFetch(route: Route) {
  const calls: URL[] = [];
  const spy = spyOn(globalThis, "fetch").mockImplementation((async (input: any) => {
    const url = new URL(String(input));
    calls.push(url);
    return route(url);
  }) as any);
  return { spy, calls };
}

function silenceConsoleError() {
  return spyOn(console, "error").mockImplementation(() => {});
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

function ytComment(id: string, text: string) {
  return {
    id,
    snippet: {
      authorDisplayName: "user_01",
      textOriginal: text,
      likeCount: 1,
      publishedAt: "2026-07-06T10:00:00Z",
    },
  };
}

function threadItem(threadId: string, top: unknown, totalReplyCount = 0) {
  return { id: threadId, snippet: { totalReplyCount, topLevelComment: top } };
}

function analyzeRequest(body: unknown): Request {
  return new Request(`${BASE}/api/analyze-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function onePage(text = "bagus sekali videonya"): Route {
  return (url) => {
    if (url.pathname === "/youtube/v3/videos") return videoOk();
    return Response.json({ items: [threadItem("t1", ytComment("c1", text))] });
  };
}

async function analyze(route: Route, body: unknown) {
  const consoleSpy = silenceConsoleError();
  const { spy, calls } = mockFetch(route);
  try {
    const response = await worker.fetch(analyzeRequest(body), ENV, {});
    return { status: response.status, data: (await response.json()) as any, calls };
  } finally {
    spy.mockRestore();
    consoleSpy.mockRestore();
  }
}

for (const [name, videoId] of [
  ["shorter than 11 characters", "abc"],
  ["longer than 11 characters", "a".repeat(50)],
  ["11 characters with a character outside the id alphabet", "dQw4w9WgXc$"],
  ["a valid id followed by a newline", `${VALID_ID}\n`],
] as const) {
  test(`POST /api/analyze-video rejects a videoId ${name} before any subrequest`, async () => {
    const { status, data, calls } = await analyze(onePage(), { videoId });
    expect(status).toBe(400);
    expect(data.error).toBe("Invalid videoId");
    expect(data.details).toEqual([{ path: "videoId", message: "Invalid videoId" }]);
    expect(calls).toHaveLength(0);
  });
}

test("POST /api/analyze-video accepts an 11 character videoId and sends it to YouTube", async () => {
  const { status, calls } = await analyze(onePage(), { videoId: "a-B_c1d2E3f" });
  expect(status).toBe(200);
  expect(calls.map((u) => u.searchParams.get("id") ?? u.searchParams.get("videoId"))).toEqual([
    "a-B_c1d2E3f",
    "a-B_c1d2E3f",
  ]);
});

test("POST /api/analyze-video counts toxic and spam comments in total", async () => {
  const { status, data } = await analyze(
    (url) => {
      if (url.pathname === "/youtube/v3/videos") return videoOk();
      return Response.json({
        items: [
          threadItem("t1", ytComment("c1", "dasar anjing")),
          threadItem("t2", ytComment("c2", "bagus sekali")),
          threadItem("t3", ytComment("c3", "cek https://example.com/promo")),
        ],
      });
    },
    { videoId: VALID_ID },
  );
  expect(status).toBe(200);
  expect(data.allComments.map((c: any) => c.sentiment)).toEqual(["TOXIC", "POSITIVE", "SPAM"]);
  expect(data.total).toBe(3);
});

test("POST /api/analyze-video reports partial false with an empty reason on a clean run", async () => {
  const { status, data } = await analyze(onePage(), { videoId: VALID_ID });
  expect(status).toBe(200);
  expect(data.partial).toBe(false);
  expect(data.partialReason).toBe("");
});

test("POST /api/analyze-video reports partial true when a later comment page fails", async () => {
  const { status, data } = await analyze(
    (url) => {
      if (url.pathname === "/youtube/v3/videos") return videoOk();
      if (url.searchParams.get("pageToken") === "PAGE2") {
        return new Response("server error", { status: 500 });
      }
      return Response.json({
        nextPageToken: "PAGE2",
        items: [threadItem("t1", ytComment("c1", "bagus sekali videonya"))],
      });
    },
    { videoId: VALID_ID, maxPages: 3 },
  );
  expect(status).toBe(200);
  expect(data.allComments.map((c: any) => c.id)).toEqual(["c1"]);
  expect(data.partial).toBe(true);
  expect(data.partialReason).toBe("comment page request failed");
  expect(data.hasMore).toBe(false);
});

test("POST /api/analyze-video reports partial true when a later comment page cannot be parsed", async () => {
  const { status, data } = await analyze(
    (url) => {
      if (url.pathname === "/youtube/v3/videos") return videoOk();
      if (url.searchParams.get("pageToken") === "PAGE2") {
        return Response.json({ items: [{ id: 123 }] });
      }
      return Response.json({
        nextPageToken: "PAGE2",
        items: [threadItem("t1", ytComment("c1", "bagus sekali videonya"))],
      });
    },
    { videoId: VALID_ID, maxPages: 3 },
  );
  expect(status).toBe(200);
  expect(data.partial).toBe(true);
  expect(data.partialReason).toBe("comment page parse failed");
});

const REPLY_FAILURES: [string, () => Response, string][] = [
  ["answers non-OK", () => new Response("error", { status: 500 }), "reply request failed"],
  ["cannot be parsed", () => Response.json({ items: [{ id: 42 }] }), "reply parse failed"],
  [
    "throws",
    () => {
      throw new Error("Simulated network error fetching replies");
    },
    "reply request failed",
  ],
];

for (const [name, replyResponse, reason] of REPLY_FAILURES) {
  test(`POST /api/analyze-video reports partial true when a replies request ${name}`, async () => {
    const { status, data } = await analyze(
      (url) => {
        if (url.pathname === "/youtube/v3/videos") return videoOk();
        if (url.pathname === "/youtube/v3/comments") return replyResponse();
        return Response.json({
          items: [threadItem("t1", ytComment("c_top", "bagus sekali videonya"), 2)],
        });
      },
      { videoId: VALID_ID, maxPages: 3 },
    );
    expect(status).toBe(200);
    expect(data.allComments.map((c: any) => c.id)).toEqual(["c_top"]);
    expect(data.partial).toBe(true);
    expect(data.partialReason).toBe(reason);
  });
}

test("POST /api/analyze-video does not flag partial when the subrequest circuit breaker stops it", async () => {
  let page = 0;
  const { status, data } = await analyze(
    (url) => {
      if (url.pathname === "/youtube/v3/videos") return videoOk();
      if (url.pathname === "/youtube/v3/comments") {
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
    },
    { videoId: VALID_ID, maxPages: 10 },
  );
  expect(status).toBe(200);
  expect(data.hasMore).toBe(true);
  expect(data.partial).toBe(false);
});
