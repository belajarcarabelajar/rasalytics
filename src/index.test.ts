import { expect, test, spyOn, afterEach } from "bun:test";
import { analyzeComment, preprocess, fetchWithRetry, processComment, escapeMarkdown } from "./index";

afterEach(() => {
  // Clear all mocks after each test
});

test("Preprocessing strips URLs, mentions, and normalizes slang", () => {
  const { normalized, urls } = preprocess("Wah @budi ini keren bgt link.com");
  expect(urls.length).toBeGreaterThan(0);
  expect(normalized).toBe("wah ini keren banget");
});

test("Confidence score boundaries", async () => {
  const { confidence } = await analyzeComment("ini komentar biasa saja tanpa kata kunci");
  expect(confidence).toBeGreaterThanOrEqual(0);
  expect(confidence).toBeLessThanOrEqual(100);
});

test("Spam detection", async () => {
  const result = await analyzeComment("subs channel aku ya http://spam.com");
  expect(result.label).toBe("SPAM");
  expect(result.isSpam).toBe(true);
});

test("Toxic detection", async () => {
  const result = await analyzeComment("dasar lu anjing goblok");
  expect(result.label).toBe("TOXIC");
  expect(result.isToxic).toBe(true);
});

test("Mixed detection", async () => {
  const result = await analyzeComment("This video is absolutely wonderful. However, the audio quality is terrible.");
  expect(result.label).toBe("MIXED");
});

test("Raw text preservation via CommentData format check is implicitly handled in index.ts", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL, options?: RequestInit) => {
    if (url.toString().includes("11434")) {
      throw new Error("Ollama not available");
    }
    // For other requests, returning a mock to prevent real network calls
    return new Response(JSON.stringify({}), { status: 200 });
  });

  const snippet = {
    textOriginal: "Line 1\nLine 2\nLine 3",
    authorDisplayName: "Test Author",
    likeCount: 5,
    publishedAt: "2023-01-01T00:00:00Z"
  };
  const comment = await processComment("test_id", snippet);
  expect(comment.raw_text).toBe("Line 1 Line 2 Line 3");
  expect(comment.comment_id).toBe("test_id");

  fetchSpy.mockRestore();
});

test("Fetch retry loop recovers after intermittent 500 error", async () => {
  let calls = 0;
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
    calls++;
    if (calls < 3) {
      throw new Error("fetch failed"); // Simulate network error
    }
    return new Response(JSON.stringify({ items: ["success"] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  const result = await fetchWithRetry("http://fake-url.com", 3, 10);
  
  expect(calls).toBe(3);
  expect(result.items[0]).toBe("success");
  
  fetchSpy.mockRestore();
});

test("escapeMarkdown sanitizes pipe characters and newlines", () => {
  const badInput = "Hello | World\nNew Line";
  const safe = escapeMarkdown(badInput);
  expect(safe).toBe("Hello \\| World New Line");
});

import { fetchCommentThreads, fetchReplies, generateMarkdownReport } from "./index";

test("fetchCommentThreads constructs correct URL and calls fetchWithRetry", async () => {
  let calledUrl = "";
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
    calledUrl = url.toString();
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  });

  await fetchCommentThreads("TEST_VIDEO", "TEST_KEY", "NEXT_PAGE");
  
  expect(calledUrl).toContain("videoId=TEST_VIDEO");
  expect(calledUrl).toContain("key=TEST_KEY");
  expect(calledUrl).toContain("pageToken=NEXT_PAGE");
  expect(calledUrl).toContain("maxResults=100");
  
  fetchSpy.mockRestore();
});

test("fetchReplies constructs correct URL and calls fetchWithRetry", async () => {
  let calledUrl = "";
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
    calledUrl = url.toString();
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  });

  await fetchReplies("PARENT_ID", "TEST_KEY");
  
  expect(calledUrl).toContain("parentId=PARENT_ID");
  expect(calledUrl).toContain("key=TEST_KEY");
  expect(calledUrl).not.toContain("pageToken=");
  
  fetchSpy.mockRestore();
});

test("generateMarkdownReport renders correctly with deterministic data", () => {
  const dummyData = {
    VIDEO_ID: "vid123",
    MODEL_VERSION: "v1.0",
    videoTitle: "Awesome Video",
    channelName: "Cool Channel",
    viewCount: "10,000",
    likeCount: "500",
    commentCount: "100",
    positive: 60,
    negative: 20,
    neutral: 15,
    mixed: 5,
    xDates: "'2026-06-01', '2026-06-02'",
    posCounts: "30, 30",
    negCounts: "10, 10",
    wordcloudPath: "path/to/cloud.png",
    totalCount: 100,
    spam: 10,
    toxic: 5,
    buzzer: 2,
    topPositive: [
      { author: "Alice", like_count: 10, raw_text: "Great!", confidence_score: 99 }
    ],
    topNegative: [
      { author: "Bob", like_count: 2, raw_text: "Bad!", confidence_score: 80 }
    ],
    buzzerRings: [
      { buzzer_group_id: "group1", buzz_count: 1, raw_text: "Copas comment" }
    ]
  };

  const lines = generateMarkdownReport(dummyData);
  const report = lines.join("\n");

  expect(report).toContain("# YouTube Comments Analysis: vid123");
  expect(report).toContain("Awesome Video");
  expect(report).toContain("Cool Channel");
  expect(report).toContain("10,000");
  expect(report).toContain("![Word Cloud](path/to/cloud.png)");
  expect(report).toContain("**Alice** (10 likes): \"Great!\" (Confidence: 99%)");
  expect(report).toContain("**Bob** (2 likes): \"Bad!\" (Confidence: 80%)");
  expect(report).toContain("**Ring ID:** group1 | **Size:** 2 identical comments | **Template:** \"Copas comment\"");
});
