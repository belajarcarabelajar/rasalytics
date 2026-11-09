import { expect, test, spyOn } from "bun:test";
import {
  analyzeComment,
  fetchWithRetry,
  processComment,
  generateMarkdownReport,
  type ReportData,
} from "./index";

// Only branches decided before getClassifier() is called are exercised here,
// so results are identical with or without local Transformer weights.

test("analyzeComment returns NEUTRAL 'Empty or emoji only' when nothing remains after normalization", async () => {
  for (const input of ["", "!!!", "@budi #viral"]) {
    const result = await analyzeComment(input);
    expect(result).toEqual({
      score: 0,
      confidence: 100,
      label: "NEUTRAL",
      isSpam: false,
      isToxic: false,
      reasoning: "Empty or emoji only",
    });
  }
});

test("analyzeComment gives TOXIC precedence over SPAM but still reports the spam flag", async () => {
  const result = await analyzeComment("dasar anjing subscribe dong");
  expect(result).toEqual({
    score: -1,
    confidence: 100,
    label: "TOXIC",
    isSpam: true,
    isToxic: true,
    reasoning: "Matched toxic dictionary",
  });
});

test("processComment falls back to textDisplay and default fields when snippet values are missing", async () => {
  const comment = await processComment("gap_id", { textDisplay: "@budi\n#viral" });
  expect(comment.comment_id).toBe("gap_id");
  expect(comment.raw_text).toBe("@budi #viral");
  expect(comment.normalized_text).toBe("");
  expect(comment.author).toBe("");
  expect(comment.like_count).toBe(0);
  expect(comment.published_at).toBe("");
  expect(comment.sentiment_label).toBe("NEUTRAL");
  expect(comment.sentiment_score).toBe(0);
  expect(comment.confidence_score).toBe(100);
  expect(comment.reasoning_summary).toBe("Empty or emoji only");
  expect(comment.model_version).toBe("v8.0-roberta-hybrid");
  expect(comment.is_buzzer).toBe(false);
  expect(comment.buzzer_group_id).toBe("");
});

test("fetchWithRetry throws a dedicated error when comments are disabled (403) without retrying", async () => {
  let calls = 0;
  const fetchSpy = spyOn(globalThis as any, "fetch").mockImplementation(async () => {
    calls++;
    return new Response(
      JSON.stringify({ error: { errors: [{ reason: "commentsDisabled" }] } }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  });

  try {
    await expect(fetchWithRetry("http://fake-url.com", 3, 1)).rejects.toThrow(
      "Comments are disabled for this video.",
    );
    expect(calls).toBe(1);
  } finally {
    fetchSpy.mockRestore();
  }
});

test("fetchWithRetry reports a JSON 403 with another reason as a generic API error without retrying", async () => {
  const body = JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } });
  let calls = 0;
  const fetchSpy = spyOn(globalThis as any, "fetch").mockImplementation(async () => {
    calls++;
    return new Response(body, { status: 403, headers: { "Content-Type": "application/json" } });
  });

  try {
    await expect(fetchWithRetry("http://fake-url.com", 3, 1)).rejects.toThrow(
      `API Error 403: ${body}`,
    );
    expect(calls).toBe(1);
  } finally {
    fetchSpy.mockRestore();
  }
});

test("fetchWithRetry retries 5xx with doubling backoff and fails after the last retry", async () => {
  let calls = 0;
  const fetchSpy = spyOn(globalThis as any, "fetch").mockImplementation(async () => {
    calls++;
    return new Response("server error", { status: 500 });
  });
  const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

  try {
    await expect(fetchWithRetry("http://fake-url.com", 2, 1)).rejects.toThrow(
      "API failed after 2 retries with status 500",
    );
    expect(calls).toBe(3);
    expect(warnSpy.mock.calls.map((c) => c[0])).toEqual([
      "Retry 1/2 after API error 500... waiting 1ms",
      "Retry 2/2 after API error 500... waiting 2ms",
    ]);
  } finally {
    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  }
});

test("fetchWithRetry with retries = 0 fails on the first 5xx without waiting or warning", async () => {
  let calls = 0;
  const fetchSpy = spyOn(globalThis as any, "fetch").mockImplementation(async () => {
    calls++;
    return new Response("unavailable", { status: 503 });
  });
  const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

  try {
    await expect(fetchWithRetry("http://fake-url.com", 0, 1)).rejects.toThrow(
      "API failed after 0 retries with status 503",
    );
    expect(calls).toBe(1);
    expect(warnSpy).not.toHaveBeenCalled();
  } finally {
    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  }
});

test("fetchWithRetry recovers when a 5xx is followed by a successful response", async () => {
  let calls = 0;
  const fetchSpy = spyOn(globalThis as any, "fetch").mockImplementation(async () => {
    calls++;
    if (calls === 1) {
      return new Response("unavailable", { status: 503 });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

  try {
    const result = await fetchWithRetry("http://fake-url.com", 3, 1);
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(warnSpy.mock.calls.map((c) => c[0])).toEqual([
      "Retry 1/3 after API error 503... waiting 1ms",
    ]);
  } finally {
    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  }
});

test("fetchWithRetry rethrows the original network error once retries are exhausted", async () => {
  let calls = 0;
  const fetchSpy = spyOn(globalThis as any, "fetch").mockImplementation(async () => {
    calls++;
    throw new Error("fetch failed");
  });
  const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

  try {
    await expect(fetchWithRetry("http://fake-url.com", 1, 5)).rejects.toThrow("fetch failed");
    expect(calls).toBe(2);
    expect(warnSpy.mock.calls.map((c) => c[0])).toEqual([
      "Retry 1/1 after network error: fetch failed... waiting 5ms",
    ]);
  } finally {
    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  }
});

function makeReportData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    VIDEO_ID: "vid_gap",
    MODEL_VERSION: "v-test",
    videoTitle: "Judul Video",
    channelName: "Kanal Contoh",
    viewCount: "1,000",
    likeCount: "100",
    commentCount: "100",
    positive: 40,
    negative: 30,
    neutral: 20,
    mixed: 10,
    xDates: "'2026-06-01'",
    posCounts: "40",
    negCounts: "30",
    wordcloudPath: "cloud.png",
    totalCount: 100,
    spam: 0,
    toxic: 0,
    buzzer: 0,
    topPositive: [],
    topNegative: [],
    buzzerRings: [],
    ...overrides,
  };
}

test("generateMarkdownReport shows fallback text when there is no word cloud and no buzzer rings", () => {
  const lines = generateMarkdownReport(makeReportData({ wordcloudPath: null, buzzerRings: [] }));
  const report = lines.join("\n");

  expect(lines).toContain("*Word cloud generation failed or not enough data.*");
  expect(lines).toContain("No significant buzzer rings detected.");
  expect(report).not.toContain("![Word Cloud]");
  expect(report).not.toContain("**Ring ID:**");
});

test("generateMarkdownReport raises warnings when spam, toxicity and buzzer ratios exceed thresholds", () => {
  const lines = generateMarkdownReport(makeReportData({ spam: 11, toxic: 6, buzzer: 6 }));
  const report = lines.join("\n");

  expect(report).toContain("**Warning:** High spam activity detected.");
  expect(report).toContain("**Warning:** High toxicity levels detected.");
  expect(report).toContain("**Alert:** Significant organized Buzzer/Astroturfing activity detected.");
  expect(report).not.toContain("Spam levels are normal.");
  expect(report).not.toContain("Community toxicity is low.");
  expect(report).not.toContain("Inorganic buzzer manipulation is low.");
  expect(lines).toContain("- **Spam Ratio:** 11.0% (11 comments)");
  expect(lines).toContain("- **Buzzer/Copas Ratio:** 6.0% (6 suspected)");
});

test("generateMarkdownReport calls a positive/negative tie predominantly Negative", () => {
  const lines = generateMarkdownReport(makeReportData({ positive: 30, negative: 30 }));
  expect(lines).toContain("The video received predominantly Negative feedback.");
  expect(lines).not.toContain("The video received predominantly Positive feedback.");
});

// Hand-written (not model output): the tie test above passes with the comparison inverted (30 < 30 and
// 30 > 30 both pick "Negative"), so a strict majority in each direction is asserted here.
test("generateMarkdownReport names the strict majority: Positive when positive leads, Negative when negative leads", () => {
  const positiveLeads = generateMarkdownReport(makeReportData({ positive: 40, negative: 30 }));
  expect(positiveLeads).toContain("The video received predominantly Positive feedback.");
  expect(positiveLeads).not.toContain("The video received predominantly Negative feedback.");

  const negativeLeads = generateMarkdownReport(makeReportData({ positive: 30, negative: 40 }));
  expect(negativeLeads).toContain("The video received predominantly Negative feedback.");
  expect(negativeLeads).not.toContain("The video received predominantly Positive feedback.");
});

test("generateMarkdownReport joins multiple buzzer rings and escapes markdown in templates", () => {
  const lines = generateMarkdownReport(
    makeReportData({
      buzzerRings: [
        { buzzer_group_id: "g1", buzz_count: 3, raw_text: "cek *promo* | sekarang" },
        { buzzer_group_id: "g2", buzz_count: 0, raw_text: "halo\nsemua" },
      ],
    }),
  );

  expect(lines).toContain(
    '- **Ring ID:** g1 | **Size:** 4 identical comments | **Template:** "cek \\*promo\\* \\| sekarang"\n' +
      '- **Ring ID:** g2 | **Size:** 1 identical comments | **Template:** "halo semua"',
  );
  expect(lines).not.toContain("No significant buzzer rings detected.");
});
