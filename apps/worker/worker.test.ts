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
              id: "thread_id_1",
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
