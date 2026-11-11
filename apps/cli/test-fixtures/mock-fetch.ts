// Preload fixture for the CLI tests: replaces global fetch in the child process.
// Loaded only through `bun --preload`; a test file must never import it, or the
// per-file coverage threshold in bunfig.toml would apply to it.
const MODE = process.env.MOCK_MODE || "";
const DUPLICATE_TEXT = "produk ini sangat bagus sekali dan pelayanan toko cepat";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function thread(id: string, text: string, publishedAt?: string) {
  const snippet: Record<string, unknown> = {
    textOriginal: text,
    authorDisplayName: `author-${id}`,
    likeCount: 1,
  };
  if (publishedAt) snippet.publishedAt = publishedAt;
  return { id, snippet: { topLevelComment: { id, snippet }, totalReplyCount: 0 } };
}

function commentThreads(pageToken: string | null): Response {
  if (MODE === "page2-403") {
    if (!pageToken) {
      return json({
        items: [thread("c1", DUPLICATE_TEXT, "2026-01-02T03:04:05Z")],
        nextPageToken: "PAGE2",
      });
    }
    return json({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403);
  }
  if (MODE === "page2-duplicate") {
    if (pageToken === "PAGE2") {
      return json({ items: [thread("c2", DUPLICATE_TEXT, "2026-01-03T03:04:05Z")] });
    }
    return json({ items: [] });
  }
  if (MODE === "single-page" || MODE === "videos-throw") {
    return json({
      items: [
        thread("plain", "komentar biasa tanpa rumus", "2026-01-02T03:04:05Z"),
        thread("tab", '\t=HYPERLINK("x")', "2026-01-02T05:00:00Z"),
        thread("cr", "\r=1+1", "2026-01-02T06:00:00Z"),
        thread("undated", "komentar tanpa tanggal terbit"),
      ],
    });
  }
  return json({ error: `mock-fetch: unknown MOCK_MODE ${MODE}` }, 400);
}

const mockFetch = async (input: string | URL | Request): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (url.pathname === "/youtube/v3/commentThreads") {
    return commentThreads(url.searchParams.get("pageToken"));
  }
  if (url.pathname === "/youtube/v3/videos") {
    if (MODE === "videos-throw") {
      throw new Error(
        "Unable to connect to https://www.googleapis.com/youtube/v3/videos?id=x&key=SECRET123&part=snippet",
      );
    }
    return json({
      items: [
        {
          snippet: { title: "Mock title", channelTitle: "Mock channel" },
          statistics: { viewCount: "10", likeCount: "2", commentCount: "4" },
        },
      ],
    });
  }
  // Fail closed: nothing in a test may reach the real network.
  return json({ error: `mock-fetch: unexpected URL ${url.pathname}` }, 404);
};

globalThis.fetch = mockFetch as unknown as typeof fetch;
