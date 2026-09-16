// Must be set BEFORE the `./cli` import — cli.ts invokes `run()` at module load,
// which short-circuits when NODE_ENV === "test".
process.env.NODE_ENV = "test";

import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import type { Database } from "bun:sqlite";
import {
  fetchVideoDetails,
  setupDatabase,
  sanitizeCsvField,
  buildCsvLines,
  getSentimentStats,
  getTopComments,
  getBuzzerRings,
  getTimeSeries,
  writeReport,
  exportOutputs,
  collectComments,
} from "./cli";

const FALLBACK = {
  videoTitle: "Unknown Title",
  channelName: "Unknown Channel",
  viewCount: "0",
  likeCount: "0",
  commentCount: "0",
};

let db: Database;
let fetchSpy: ReturnType<typeof spyOn>;
let errSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  db = setupDatabase(":memory:");
  fetchSpy = spyOn(globalThis, "fetch");
  errSpy = spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  fetchSpy.mockRestore();
  errSpy.mockRestore();
  db.close();
});

test("fetchVideoDetails › success path returns parsed fields", async () => {
  fetchSpy.mockImplementation(async () => {
    return new Response(
      JSON.stringify({
        items: [
          {
            snippet: { title: "Mock Video", channelTitle: "Mock Channel" },
            statistics: { viewCount: "1000", likeCount: "50", commentCount: "7" },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const result = await fetchVideoDetails("dQw4w9WfXgQ", "test-key");

  expect(result.videoTitle).toBe("Mock Video");
  expect(result.channelName).toBe("Mock Channel");
  // toLocaleString on 1000 → "1,000" in default en locale
  expect(result.viewCount).toBe("1,000");
  expect(result.likeCount).toBe("50");
  expect(result.commentCount).toBe("7");

  const calledUrl = String(fetchSpy.mock.calls[0]![0]);
  expect(calledUrl).toContain("youtube/v3/videos");
  expect(calledUrl).toContain("part=snippet%2Cstatistics");
  expect(calledUrl).toContain("id=dQw4w9WfXgQ");
  expect(calledUrl).toContain("key=test-key");
});

test("fetchVideoDetails › HTTP 500 returns fallback, no error logged", async () => {
  fetchSpy.mockImplementation(async () => new Response("", { status: 500 }));

  const result = await fetchVideoDetails("dQw4w9WfXgQ", "test-key");

  expect(result).toEqual(FALLBACK);
  // HTTP failures are handled by the `if (!vRes.ok) return fallback` branch,
  // not by the catch block — so console.error should NOT be called.
  expect(errSpy).not.toHaveBeenCalled();
});

test("fetchVideoDetails › empty items array returns fallback", async () => {
  fetchSpy.mockImplementation(
    async () =>
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );

  const result = await fetchVideoDetails("dQw4w9WfXgQ", "test-key");

  expect(result).toEqual(FALLBACK);
  expect(errSpy).not.toHaveBeenCalled();
});

test("fetchVideoDetails › missing items key returns fallback", async () => {
  fetchSpy.mockImplementation(
    async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );

  const result = await fetchVideoDetails("dQw4w9WfXgQ", "test-key");

  expect(result).toEqual(FALLBACK);
  expect(errSpy).not.toHaveBeenCalled();
});

test("fetchVideoDetails › thrown network error returns fallback and logs", async () => {
  const networkError = new Error("network failure");
  fetchSpy.mockImplementation(async () => {
    throw networkError;
  });

  const result = await fetchVideoDetails("dQw4w9WfXgQ", "test-key");

  expect(result).toEqual(FALLBACK);
  expect(errSpy).toHaveBeenCalledTimes(1);
  const [prefix, errArg] = errSpy.mock.calls[0]!;
  expect(prefix).toBe("Failed to fetch video details:");
  expect(errArg).toBe(networkError);
});

test("fetchVideoDetails › missing statistics fields defaults to '0' (no throw)", async () => {
  fetchSpy.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              snippet: { title: "X", channelTitle: "Y" },
              statistics: {},
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  );

  const result = await fetchVideoDetails("dQw4w9WfXgQ", "test-key");

  expect(result.videoTitle).toBe("X");
  expect(result.channelName).toBe("Y");
  // parseInt(undefined || "0") → 0 → "0"
  expect(result.viewCount).toBe("0");
  expect(result.likeCount).toBe("0");
  expect(result.commentCount).toBe("0");
});

// =====================================================================
// Group A: sanitizeCsvField — CSV formula-injection guard
// =====================================================================

test("sanitizeCsvField › plain text passes through unchanged", () => {
  expect(sanitizeCsvField("hello world")).toBe("hello world");
});

test("sanitizeCsvField › equals-sign prefix is escaped with leading apostrophe", () => {
  expect(sanitizeCsvField("=cmd|'/c calc!A1")).toBe("'=cmd|'/c calc!A1");
  expect(sanitizeCsvField("=SUM(A1)")).toBe("'=SUM(A1)");
});

test("sanitizeCsvField › plus-sign prefix is escaped with leading apostrophe", () => {
  expect(sanitizeCsvField("+SUM(A1)")).toBe("'+SUM(A1)");
  expect(sanitizeCsvField("+1+1")).toBe("'+1+1");
});

test("sanitizeCsvField › minus-sign prefix is escaped with leading apostrophe", () => {
  expect(sanitizeCsvField("-2+3")).toBe("'-2+3");
  expect(sanitizeCsvField("-SUM(A1)")).toBe("'-SUM(A1)");
});

test("sanitizeCsvField › at-sign prefix is escaped with leading apostrophe", () => {
  expect(sanitizeCsvField("@SUM(A1:A2)")).toBe("'@SUM(A1:A2)");
});

test("sanitizeCsvField › embedded double-quote is doubled", () => {
  expect(sanitizeCsvField('say "hi"')).toBe('say ""hi""');
  expect(sanitizeCsvField('"')).toBe('""');
});

test("sanitizeCsvField › empty string returns empty", () => {
  expect(sanitizeCsvField("")).toBe("");
});

test("sanitizeCsvField › null or undefined input returns empty", () => {
  expect(sanitizeCsvField(null as any)).toBe("");
  expect(sanitizeCsvField(undefined as any)).toBe("");
});

test("sanitizeCsvField › non-prefix special characters are NOT escaped", () => {
  // A "=" mid-string should not trigger the prefix guard.
  expect(sanitizeCsvField("a=b")).toBe("a=b");
  // "+" not at the very start is fine.
  expect(sanitizeCsvField("1+1")).toBe("1+1");
});

test("sanitizeCsvField › quote-doubling + formula-escape stack correctly", () => {
  // = "danger" — the prefix guard runs on the post-doubled string.
  // The two inner `"` chars become `""`; the leading `=` triggers the `'=` prefix.
  expect(sanitizeCsvField('="danger"')).toBe(`'=""danger""`);
});

// =====================================================================
// Group B: buildCsvLines — header selection + row formatting
// =====================================================================

test("buildCsvLines › with flags emits 8-column header", () => {
  const lines = buildCsvLines([], true);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toBe(
    "comment_id,author,sentiment_label,is_spam,is_toxic,is_buzzer,buzzer_group_id,raw_text",
  );
});

test("buildCsvLines › without flags emits 4-column header", () => {
  const lines = buildCsvLines([], false);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toBe("comment_id,author,sentiment_label,raw_text");
});

test("buildCsvLines › with flags row includes all boolean flags unquoted", () => {
  const rows = [
    {
      comment_id: "c1",
      author: "alice",
      sentiment_label: "POSITIVE",
      spam_flag: 0,
      toxic_flag: 1,
      is_buzzer: 0,
      buzzer_group_id: "",
      raw_text: "hello",
    },
  ];
  const lines = buildCsvLines(rows, true);
  expect(lines[1]).toBe('"c1","alice","POSITIVE",0,1,0,"","hello"');
});

test("buildCsvLines › without flags row omits the flag columns", () => {
  const rows = [
    {
      comment_id: "c1",
      author: "alice",
      sentiment_label: "POSITIVE",
      spam_flag: 0,
      toxic_flag: 0,
      is_buzzer: 0,
      buzzer_group_id: "",
      raw_text: "hello",
    },
  ];
  const lines = buildCsvLines(rows, false);
  expect(lines[1]).toBe('"c1","alice","POSITIVE","hello"');
});

test("buildCsvLines › formula-injection in raw_text is escaped via sanitizeCsvField", () => {
  const rows = [
    {
      comment_id: "c1",
      author: "alice",
      sentiment_label: "POSITIVE",
      spam_flag: 0,
      toxic_flag: 0,
      is_buzzer: 0,
      buzzer_group_id: "",
      raw_text: "=SUM(A1)",
    },
  ];
  const lines = buildCsvLines(rows, false);
  // raw_text starts with '=' → sanitizeCsvField adds leading "'"
  expect(lines[1]).toBe('"c1","alice","POSITIVE","\'=SUM(A1)"');
});

test("buildCsvLines › embedded double-quote in raw_text is doubled", () => {
  const rows = [
    {
      comment_id: "c1",
      author: 'name "with" quotes',
      sentiment_label: "POSITIVE",
      spam_flag: 0,
      toxic_flag: 0,
      is_buzzer: 0,
      buzzer_group_id: "",
      raw_text: 'say "hi"',
    },
  ];
  const lines = buildCsvLines(rows, false);
  expect(lines[1]).toBe('"c1","name ""with"" quotes","POSITIVE","say ""hi"""');
});

// =====================================================================
// Group C: SQL aggregations
// =====================================================================

function insertComment(
  db: Database,
  row: {
    comment_id?: string;
    author?: string;
    raw_text?: string;
    normalized_text?: string;
    like_count?: number;
    published_at?: string;
    sentiment_score?: number;
    confidence_score?: number;
    sentiment_label?: string;
    spam_flag?: number;
    toxic_flag?: number;
    reasoning_summary?: string;
    model_version?: string;
    processed_at?: string;
    is_buzzer?: number;
    buzzer_group_id?: string;
  },
) {
  db.prepare(
    `INSERT OR REPLACE INTO comments (
      comment_id, author, raw_text, normalized_text, like_count, published_at,
      sentiment_score, confidence_score, sentiment_label, spam_flag, toxic_flag,
      reasoning_summary, model_version, processed_at, is_buzzer, buzzer_group_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.comment_id ?? "c",
    row.author ?? "u",
    row.raw_text ?? "t",
    row.normalized_text ?? "n",
    row.like_count ?? 0,
    row.published_at ?? "",
    row.sentiment_score ?? 0,
    row.confidence_score ?? 0,
    row.sentiment_label ?? "NEUTRAL",
    row.spam_flag ?? 0,
    row.toxic_flag ?? 0,
    row.reasoning_summary ?? "",
    row.model_version ?? "v8.0-roberta-hybrid",
    row.processed_at ?? "",
    row.is_buzzer ?? 0,
    row.buzzer_group_id ?? "",
  );
}

test("getSentimentStats › empty DB returns all zeros", () => {
  expect(getSentimentStats(db)).toEqual({
    totalCount: 0,
    positive: 0,
    negative: 0,
    neutral: 0,
    mixed: 0,
    spam: 0,
    toxic: 0,
    buzzer: 0,
  });
});

test("getSentimentStats › mixed seed counts labels and flags correctly", () => {
  insertComment(db, { comment_id: "a", sentiment_label: "POSITIVE", spam_flag: 1 });
  insertComment(db, { comment_id: "b", sentiment_label: "POSITIVE" });
  insertComment(db, { comment_id: "c", sentiment_label: "NEGATIVE", toxic_flag: 1 });
  insertComment(db, { comment_id: "d", sentiment_label: "NEUTRAL" });
  insertComment(db, { comment_id: "e", sentiment_label: "MIXED", is_buzzer: 1 });
  insertComment(db, { comment_id: "f", sentiment_label: "POSITIVE", is_buzzer: 1 });

  expect(getSentimentStats(db)).toEqual({
    totalCount: 6,
    positive: 3,
    negative: 1,
    neutral: 1,
    mixed: 1,
    spam: 1,
    toxic: 1,
    buzzer: 2,
  });
});

test("getTopComments › filters spam/toxic/buzzer, orders by like_count DESC", () => {
  insertComment(db, { comment_id: "a", sentiment_label: "POSITIVE", like_count: 10 });
  insertComment(db, { comment_id: "b", sentiment_label: "POSITIVE", like_count: 100 });
  insertComment(db, { comment_id: "c", sentiment_label: "POSITIVE", like_count: 50, spam_flag: 1 });
  insertComment(db, { comment_id: "d", sentiment_label: "POSITIVE", like_count: 80, toxic_flag: 1 });
  insertComment(db, { comment_id: "e", sentiment_label: "POSITIVE", like_count: 70, is_buzzer: 1 });
  insertComment(db, { comment_id: "f", sentiment_label: "NEGATIVE", like_count: 200 });

  const top = getTopComments(db, "POSITIVE", 5);
  expect(top.map((r: any) => r.comment_id)).toEqual(["b", "a"]);
  expect(top).toHaveLength(2);
});

test("getBuzzerRings › groups by buzzer_group_id, returns top 5", () => {
  insertComment(db, { comment_id: "a", buzzer_group_id: "ring-1", raw_text: "alpha" });
  insertComment(db, { comment_id: "b", buzzer_group_id: "ring-1", raw_text: "alpha" });
  insertComment(db, { comment_id: "c", buzzer_group_id: "ring-1", raw_text: "alpha" });
  insertComment(db, { comment_id: "d", buzzer_group_id: "ring-2", raw_text: "beta" });
  insertComment(db, { comment_id: "e", buzzer_group_id: "", raw_text: "lonely" });

  const rings = getBuzzerRings(db);
  expect(rings).toHaveLength(2);
  expect(rings[0].buzzer_group_id).toBe("ring-1");
  expect(rings[0].buzz_count).toBe(3);
  expect(rings[0].raw_text).toBe("alpha");
  expect(rings[1].buzzer_group_id).toBe("ring-2");
});

test("getTimeSeries › groups by date, sums pos/neg, orders ASC", () => {
  insertComment(db, { comment_id: "a", sentiment_label: "POSITIVE", published_at: "2024-01-01T00:00:00Z" });
  insertComment(db, { comment_id: "b", sentiment_label: "POSITIVE", published_at: "2024-01-01T12:00:00Z" });
  insertComment(db, { comment_id: "c", sentiment_label: "NEGATIVE", published_at: "2024-01-01T18:00:00Z" });
  insertComment(db, { comment_id: "d", sentiment_label: "POSITIVE", published_at: "2024-01-02T00:00:00Z" });
  insertComment(db, { comment_id: "e", sentiment_label: "NEGATIVE", published_at: "2024-01-02T06:00:00Z" });
  insertComment(db, { comment_id: "f", sentiment_label: "NEUTRAL", published_at: "2024-01-02T09:00:00Z" });

  const ts = getTimeSeries(db);
  expect(ts).toHaveLength(2);
  expect(ts[0]).toEqual({ date: "2024-01-01", pos: 2, neg: 1 });
  expect(ts[1]).toEqual({ date: "2024-01-02", pos: 1, neg: 1 });
});

test("getTimeSeries › empty published_at groups as its own bucket (current behavior)", () => {
  // Documents the existing SQL behavior: `substr('', 1, 10) = ''` is grouped
  // separately rather than excluded. Rows with no published_at still appear.
  insertComment(db, { comment_id: "a", sentiment_label: "POSITIVE", published_at: "" });
  insertComment(db, { comment_id: "b", sentiment_label: "NEGATIVE", published_at: "" });

  const ts = getTimeSeries(db);
  expect(ts).toHaveLength(1);
  expect(ts[0].date).toBe("");
  expect(ts[0].pos).toBe(1);
  expect(ts[0].neg).toBe(1);
});

// =====================================================================
// Group D: writeReport — 3-file write mocked
// =====================================================================

test("writeReport › writes 3 files (md, full csv, clean csv) and clean csv filters flags", async () => {
  // Seed: one clean, one spam, one buzzer
  insertComment(db, { comment_id: "clean", sentiment_label: "POSITIVE", raw_text: "good" });
  insertComment(db, { comment_id: "spam", sentiment_label: "NEUTRAL", raw_text: "buy", spam_flag: 1 });
  insertComment(db, { comment_id: "buzz", sentiment_label: "NEUTRAL", raw_text: "same", is_buzzer: 1 });

  const writes: Array<{ path: string; content: string }> = [];
  const fsSpy = spyOn(await import("fs"), "writeFileSync").mockImplementation(
    ((path: string, content: string) => {
      writes.push({ path, content });
    }) as any,
  );

  try {
    writeReport(
      "/tmp/test.md",
      "/tmp/test.csv",
      "/tmp/test_clean.csv",
      {
        videoId: "dQw4w9WfXgQ",
        video: {
          videoTitle: "T",
          channelName: "C",
          viewCount: "1,000",
          likeCount: "50",
          commentCount: "3",
        },
        stats: {
          totalCount: 3,
          positive: 1,
          negative: 0,
          neutral: 2,
          mixed: 0,
          spam: 1,
          toxic: 0,
          buzzer: 1,
        },
        xDates: '"2024-01-01"',
        posCounts: "1",
        negCounts: "0",
        wordcloudPath: "",
        topPositive: [],
        topNegative: [],
        buzzerRings: [],
      },
      db,
    );

    expect(writes).toHaveLength(3);
    expect(writes[0].path).toBe("/tmp/test.md");
    expect(writes[1].path).toBe("/tmp/test.csv");
    expect(writes[2].path).toBe("/tmp/test_clean.csv");

    // MD contains video id and pie chart
    expect(writes[0].content).toContain("dQw4w9WfXgQ");
    expect(writes[0].content).toContain("Positive");

    // Full CSV has all 8 columns and 3 rows
    expect(writes[1].content.split("\n")[0]).toBe(
      "comment_id,author,sentiment_label,is_spam,is_toxic,is_buzzer,buzzer_group_id,raw_text",
    );
    expect(writes[1].content.split("\n")).toHaveLength(4);

    // Clean CSV filters spam+buzzer; only "clean" remains
    expect(writes[2].content.split("\n")[0]).toBe(
      "comment_id,author,sentiment_label,raw_text",
    );
    expect(writes[2].content).toContain("clean");
    expect(writes[2].content).not.toContain("spam");
    expect(writes[2].content).not.toContain("buzz");
  } finally {
    fsSpy.mockRestore();
  }
});

// =====================================================================
// Group E: exportOutputs — orchestrator
// =====================================================================

test("exportOutputs › invalid videoId (too short) throws", async () => {
  await expect(exportOutputs("short", db)).rejects.toThrow("Invalid videoId");
});

test("exportOutputs › invalid videoId (special chars) throws", async () => {
  await expect(exportOutputs("bad chars!!", db)).rejects.toThrow("Invalid videoId");
});

test("exportOutputs › empty DB early-returns without writing any files", async () => {
  const fsSpy = spyOn(await import("fs"), "writeFileSync").mockImplementation(() => {});
  try {
    await exportOutputs("dQw4w9WfXgQ", db);
    expect(fsSpy).not.toHaveBeenCalled();
  } finally {
    fsSpy.mockRestore();
  }
});

test("exportOutputs › valid videoId + seeded DB writes 3 files and logs recap", async () => {
  insertComment(db, {
    comment_id: "a",
    sentiment_label: "POSITIVE",
    raw_text: "good",
    like_count: 10,
    published_at: "2024-01-01T00:00:00Z",
  });
  insertComment(db, {
    comment_id: "b",
    sentiment_label: "NEGATIVE",
    raw_text: "bad",
    like_count: 5,
    published_at: "2024-01-01T00:00:00Z",
  });

  fetchSpy.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              snippet: { title: "T", channelTitle: "C" },
              statistics: { viewCount: "100", likeCount: "5", commentCount: "2" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  );

  const writes: string[] = [];
  const fsSpy = spyOn(await import("fs"), "writeFileSync").mockImplementation(
    ((path: string, _content: string) => {
      writes.push(path);
    }) as any,
  );

  const logSpy = spyOn(console, "log").mockImplementation(() => {});

  try {
    await exportOutputs("dQw4w9WfXgQ", db);
    expect(writes).toHaveLength(3);
    expect(writes[0]).toBe("./comments_dQw4w9WfXgQ.md");
    expect(writes[1]).toBe("./comments_dQw4w9WfXgQ.csv");
    expect(writes[2]).toBe("./comments_dQw4w9WfXgQ_clean.csv");

    const logMessages = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logMessages).toContain("Total Comments: 2");
    expect(logMessages).toContain("Positive: 1");
    expect(logMessages).toContain("Negative: 1");
  } finally {
    fsSpy.mockRestore();
    logSpy.mockRestore();
  }
});

// =====================================================================
// Group F: collectComments — pagination + buzzer detection
// =====================================================================

test("collectComments › processes one page with no nextPageToken, clears stored token", async () => {
  fetchSpy.mockImplementation(async () => {
    return new Response(
      JSON.stringify({
        items: [
          {
            id: "thread-1",
            snippet: {
              totalReplyCount: 0,
              topLevelComment: {
                id: "c1",
                snippet: {
                  authorDisplayName: "u1",
                  textOriginal: "keren banget videonya",
                  likeCount: 3,
                  publishedAt: "2024-01-01T00:00:00Z",
                },
              },
            },
          },
        ],
        // No nextPageToken → loop terminates after one page
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  // Seed token to verify it gets cleared.
  db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_page_token', ?)")
    .run("OLD-TOKEN");

  await collectComments("dQw4w9WfXgQ", 5, db);

  const stored = db.query("SELECT value FROM metadata WHERE key = 'last_page_token'").get();
  expect(stored).toBeNull();

  const rows = db.query("SELECT * FROM comments").all() as any[];
  expect(rows).toHaveLength(1);
  expect(rows[0].comment_id).toBe("c1");
});

test("collectComments › saves nextPageToken to metadata for resume", async () => {
  // Two pages: page 1 has items + nextPageToken (token saved after page),
  // page 2 is empty (loop breaks early via items.length===0 → prior token persists).
  // This documents the actual behavior: the empty-page break at line 63 happens
  // BEFORE the token-clearing branch, so the last saved token remains.
  let calls = 0;
  fetchSpy.mockImplementation(async () => {
    calls++;
    if (calls === 1) {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "thread-a",
              snippet: {
                totalReplyCount: 0,
                topLevelComment: {
                  id: "ca",
                  snippet: {
                    authorDisplayName: "ua",
                    textOriginal: "pertama",
                    likeCount: 1,
                    publishedAt: "2024-01-01T00:00:00Z",
                  },
                },
              },
            },
          ],
          nextPageToken: "PAGE-2",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    // Second page: empty, no token → loop breaks at items.length === 0.
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  // Spy on db.query to capture SQL — cli.ts uses `db.query(sql).run(...)`
  // for metadata writes.
  const queries: Array<{ sql: string }> = [];
  const origQuery = db.query.bind(db);
  const querySpy = spyOn(db, "query").mockImplementation(((
    sql: any,
  ) => {
    queries.push({ sql: String(sql) });
    return origQuery(sql);
  }) as any);

  try {
    await collectComments("dQw4w9WfXgQ", 5, db);

    // At least one metadata INSERT happened with the nextPageToken.
    const metadataInserts = queries.filter((r) =>
      r.sql.includes("INSERT OR REPLACE INTO metadata"),
    );
    expect(metadataInserts.length).toBe(1);

    // The first page's token was persisted (and remains after the empty
    // second page triggers an early break).
    const stored = db
      .query("SELECT value FROM metadata WHERE key = 'last_page_token'")
      .get() as any;
    expect(stored?.value).toBe("PAGE-2");

    // First page's comment was processed.
    const rows = db.query("SELECT * FROM comments").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].comment_id).toBe("ca");
  } finally {
    querySpy.mockRestore();
  }
});

test("collectComments › clears stored pageToken when final page has no nextPageToken", async () => {
  // Single page with items but NO nextPageToken: token-clearing branch runs.
  fetchSpy.mockImplementation(async () => {
    return new Response(
      JSON.stringify({
        items: [
          {
            id: "thread-x",
            snippet: {
              totalReplyCount: 0,
              topLevelComment: {
                id: "cx",
                snippet: {
                  authorDisplayName: "ux",
                  textOriginal: "halo",
                  likeCount: 1,
                  publishedAt: "2024-01-01T00:00:00Z",
                },
              },
            },
          },
        ],
        // No nextPageToken → token-clearing DELETE branch runs after this page.
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  // Pre-seed a stale token to verify it gets cleared.
  db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_page_token', ?)")
    .run("STALE");

  await collectComments("dQw4w9WfXgQ", 5, db);

  const stored = db.query("SELECT value FROM metadata WHERE key = 'last_page_token'").get();
  expect(stored).toBeNull();
});

test("collectComments › buzzer ring: two near-identical comments flagged with same group_id", async () => {
  // Texts designed so the bigram (k=2) shingles overlap above the 0.75
  // threshold. Both texts share 6 of 7 bigrams; only the final word differs,
  // yielding jaccard = 6/7 ≈ 0.857 (well above the 0.75 cutoff).
  fetchSpy.mockImplementation(async () => {
    return new Response(
      JSON.stringify({
        items: [
          {
            id: "t1",
            snippet: {
              totalReplyCount: 0,
              topLevelComment: {
                id: "b1",
                snippet: {
                  authorDisplayName: "userA",
                  textOriginal:
                    "konten bagus sekali channel keren banget selalu update terbaru",
                  likeCount: 1,
                  publishedAt: "2024-01-01T00:00:00Z",
                },
              },
            },
          },
          {
            id: "t2",
            snippet: {
              totalReplyCount: 0,
              topLevelComment: {
                id: "b2",
                snippet: {
                  authorDisplayName: "userB",
                  textOriginal:
                    "konten bagus sekali channel keren banget selalu update mantap",
                  likeCount: 1,
                  publishedAt: "2024-01-01T01:00:00Z",
                },
              },
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  await collectComments("dQw4w9WfXgQ", 5, db);

  const rows = db.query("SELECT * FROM comments ORDER BY comment_id").all() as any[];
  expect(rows).toHaveLength(2);

  const r1 = rows.find((r: any) => r.comment_id === "b1");
  const r2 = rows.find((r: any) => r.comment_id === "b2");

  // First buzzer is the ring seed (no match yet → is_buzzer=0).
  expect(r1.is_buzzer).toBe(0);
  expect(r1.buzzer_group_id).toBe("");

  // Second matches the first (jaccard > 0.75 on shingles).
  expect(r2.is_buzzer).toBe(1);
  expect(r2.buzzer_group_id).toBe("b1");
});

test("collectComments › spam-flagged comments are NOT added to buzzer recentShingles", async () => {
  // Both comments are near-identical, but one is spam (contains a URL → flag=true).
  // Spam comments are skipped in the shingles pool → no buzzer match.
  fetchSpy.mockImplementation(async () => {
    return new Response(
      JSON.stringify({
        items: [
          {
            id: "t1",
            snippet: {
              totalReplyCount: 0,
              topLevelComment: {
                id: "spam1",
                snippet: {
                  authorDisplayName: "userA",
                  textOriginal: "cek http://spam.com video yang luar biasa keren sekali",
                  likeCount: 1,
                  publishedAt: "2024-01-01T00:00:00Z",
                },
              },
            },
          },
          {
            id: "t2",
            snippet: {
              totalReplyCount: 0,
              topLevelComment: {
                id: "spam2",
                snippet: {
                  authorDisplayName: "userB",
                  textOriginal: "video yang luar biasa keren sekali teman-teman",
                  likeCount: 1,
                  publishedAt: "2024-01-01T01:00:00Z",
                },
              },
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  await collectComments("dQw4w9WfXgQ", 5, db);

  const rows = db.query("SELECT * FROM comments ORDER BY comment_id").all() as any[];
  // Neither should be flagged as buzzer, because spam1 was excluded from
  // the shingles pool (its spam_flag=1).
  for (const r of rows) {
    expect(r.is_buzzer).toBe(0);
    expect(r.buzzer_group_id).toBe("");
  }
});

test("collectComments › resumes from saved pageToken if present in metadata", async () => {
  db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_page_token', ?)")
    .run("RESUME-TOKEN");

  let calledUrl = "";
  fetchSpy.mockImplementation(async (url: any) => {
    calledUrl = String(url);
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  await collectComments("dQw4w9WfXgQ", 5, db);

  expect(calledUrl).toContain("pageToken=RESUME-TOKEN");
});