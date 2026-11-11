import { afterEach, expect, spyOn, test } from "bun:test";
import worker from "./worker.js";

const BASE = "https://rasalytics.pages.dev";
const VALID_ID = "Qq1_-Zz9aBc";

// Stand-in for the Workers Cache API: rejects non-GET keys like the real cache.put does
class FakeCache {
  store = new Map<string, Response>();
  async match(key: Request | string): Promise<Response | undefined> {
    const k = typeof key === "string" ? key : key.url;
    return this.store.get(k)?.clone();
  }
  async put(key: Request | string, response: Response): Promise<void> {
    if (typeof key !== "string" && key.method !== "GET") {
      throw new TypeError("Cache API only accepts GET keys");
    }
    const k = typeof key === "string" ? key : key.url;
    this.store.set(k, response.clone());
  }
}

const g = globalThis as any;
const originalCaches = g.caches;
const restorers: Array<() => void> = [];

afterEach(() => {
  while (restorers.length) restorers.pop()!();
  if (originalCaches === undefined) delete g.caches;
  else g.caches = originalCaches;
});

function installCache(): FakeCache {
  const cache = new FakeCache();
  g.caches = { default: cache };
  return cache;
}

function mockYouTube() {
  const calls: URL[] = [];
  const spy = spyOn(globalThis, "fetch").mockImplementation((async (input: any) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.pathname === "/youtube/v3/videos") {
      return Response.json({
        items: [
          {
            snippet: { title: "Mock Video", channelTitle: "Mock Channel" },
            statistics: { viewCount: "1", likeCount: "1", commentCount: "1" },
          },
        ],
      });
    }
    return Response.json({
      items: [
        {
          id: "t1",
          snippet: {
            totalReplyCount: 0,
            topLevelComment: {
              id: "c1",
              snippet: { authorDisplayName: "u", textOriginal: "bagus sekali" },
            },
          },
        },
      ],
    });
  }) as any);
  restorers.push(() => spy.mockRestore());
  return calls;
}

function analyzeRequest(body: unknown, origin = BASE, ip = "203.0.113.7"): Request {
  return new Request(`${BASE}/api/analyze-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, "CF-Connecting-IP": ip },
    body: JSON.stringify(body),
  });
}

test("a second analyze request for the same video is served from cache without calling YouTube", async () => {
  const cache = installCache();
  const calls = mockYouTube();
  const env = { YOUTUBE_API_KEY: "dummy" };

  const first = await worker.fetch(analyzeRequest({ videoId: VALID_ID }), env, {});
  expect(first.status).toBe(200);
  const firstBody = (await first.json()) as Record<string, unknown>;
  const callsAfterFirst = calls.length;
  expect(callsAfterFirst).toBeGreaterThan(0);

  const stored = [...cache.store.values()][0];
  expect(stored?.headers.get("Cache-Control")).toBe("public, max-age=3600");

  const second = await worker.fetch(
    analyzeRequest({ videoId: VALID_ID }, "http://localhost:3000"),
    env,
    {},
  );
  expect(second.status).toBe(200);
  expect(calls.length).toBe(callsAfterFirst);
  expect((await second.json()) as Record<string, unknown>).toEqual(firstBody);
  expect(second.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
});

test("a cached result for one maxPages value is not served for another", async () => {
  installCache();
  const calls = mockYouTube();
  const env = { YOUTUBE_API_KEY: "dummy" };

  await worker.fetch(analyzeRequest({ videoId: VALID_ID, maxPages: 1 }), env, {});
  const callsAfterFirst = calls.length;
  const second = await worker.fetch(analyzeRequest({ videoId: VALID_ID, maxPages: 2 }), env, {});
  expect(second.status).toBe(200);
  expect(calls.length).toBeGreaterThan(callsAfterFirst);
});

test("a partial analyze result is not cached", async () => {
  const cache = installCache();
  const spy = spyOn(globalThis, "fetch").mockImplementation((async (input: any) => {
    const url = new URL(String(input));
    if (url.pathname === "/youtube/v3/commentThreads" && url.searchParams.get("pageToken")) {
      return new Response("upstream down", { status: 503 });
    }
    if (url.pathname === "/youtube/v3/commentThreads") {
      return Response.json({
        nextPageToken: "p2",
        items: [
          {
            id: "t1",
            snippet: {
              totalReplyCount: 0,
              topLevelComment: {
                id: "c1",
                snippet: { authorDisplayName: "u", textOriginal: "bagus sekali" },
              },
            },
          },
        ],
      });
    }
    return Response.json({ items: [] });
  }) as any);
  restorers.push(() => spy.mockRestore());
  const errSpy = spyOn(console, "error").mockImplementation(() => {});
  restorers.push(() => errSpy.mockRestore());

  const response = await worker.fetch(
    analyzeRequest({ videoId: VALID_ID, maxPages: 2 }),
    { YOUTUBE_API_KEY: "dummy" },
    {},
  );
  expect(response.status).toBe(200);
  expect(((await response.json()) as any).partial).toBe(true);
  expect(cache.store.size).toBe(0);
});

test("an analyze request over the per-IP rate limit gets 429 with Retry-After and no YouTube call", async () => {
  installCache();
  const calls = mockYouTube();
  const keys: string[] = [];
  const env = {
    YOUTUBE_API_KEY: "dummy",
    ANALYZE_RATE_LIMITER: {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: false };
      },
    },
  };

  const response = await worker.fetch(
    analyzeRequest({ videoId: VALID_ID }, BASE, "198.51.100.23"),
    env,
    {},
  );
  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("60");
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(BASE);
  expect(keys).toEqual(["198.51.100.23"]);
  expect(calls).toHaveLength(0);
});

test("an analyze request under the rate limit proceeds to YouTube", async () => {
  installCache();
  const calls = mockYouTube();
  const env = {
    YOUTUBE_API_KEY: "dummy",
    ANALYZE_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };

  const response = await worker.fetch(analyzeRequest({ videoId: VALID_ID }), env, {});
  expect(response.status).toBe(200);
  expect(calls.length).toBeGreaterThan(0);
});
