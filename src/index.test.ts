import { expect, test, spyOn } from "bun:test";
import { analyzeComment, preprocess } from "./index";
import fs from "fs";

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

import { fetchWithRetry, processComment } from "./index";

test("Raw text preservation via CommentData format check is implicitly handled in index.ts", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: any, options: any) => {
    if (url.toString().includes("11434")) {
      throw new Error("Ollama not available");
    }
    return originalFetch(url, options);
  };

  try {
    const snippet = {
      textOriginal: "Line 1\nLine 2\nLine 3",
      authorDisplayName: "Test Author",
      likeCount: 5,
      publishedAt: "2023-01-01T00:00:00Z"
    };
    const comment = await processComment("test_id", snippet);
    expect(comment.raw_text).toBe("Line 1 Line 2 Line 3");
    expect(comment.comment_id).toBe("test_id");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Fetch retry loop recovers after intermittent 500 error", async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  
  globalThis.fetch = async (url: any) => {
    calls++;
    if (calls < 3) {
      throw new Error("fetch failed"); // Simulate network error
    }
    return new Response(JSON.stringify({ items: ["success"] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await fetchWithRetry("http://fake-url.com", 3, 10);
  globalThis.fetch = originalFetch;
  
  expect(calls).toBe(3);
  expect(result.items[0]).toBe("success");
});

test("Benchmark Macro F1 Score", async () => {
  const benchmarkData = JSON.parse(fs.readFileSync("./benchmark.json", "utf-8"));
  let correct = 0;
  
  const metrics: Record<string, { tp: number, fp: number, fn: number }> = {
    POSITIVE: { tp: 0, fp: 0, fn: 0 },
    NEGATIVE: { tp: 0, fp: 0, fn: 0 },
    NEUTRAL: { tp: 0, fp: 0, fn: 0 },
    MIXED: { tp: 0, fp: 0, fn: 0 },
    SPAM: { tp: 0, fp: 0, fn: 0 },
    TOXIC: { tp: 0, fp: 0, fn: 0 }
  };

  const LABELS = ["POSITIVE", "NEGATIVE", "NEUTRAL", "MIXED", "SPAM", "TOXIC"];
  const confusionMatrix: Record<string, Record<string, number>> = {};
  for (const actual of LABELS) {
    confusionMatrix[actual] = {};
    for (const predicted of LABELS) {
      confusionMatrix[actual][predicted] = 0;
    }
  }

  for (const item of benchmarkData) {
    const { label } = await analyzeComment(item.text);
    
    if (!confusionMatrix[item.expected]) confusionMatrix[item.expected] = {};
    if (confusionMatrix[item.expected][label] === undefined) confusionMatrix[item.expected][label] = 0;
    confusionMatrix[item.expected][label]++;

    if (label === item.expected) {
      correct++;
      metrics[item.expected].tp++;
    } else {
      metrics[label].fp++;
      metrics[item.expected].fn++;
    }
  }

  console.log(`\n--- BENCHMARK RESULTS ---`);
  let totalF1 = 0;
  let weightedF1Sum = 0;
  let classes = 0;
  const totalSamples = benchmarkData.length;

  for (const [cls, data] of Object.entries(metrics)) {
    const precision = data.tp / (data.tp + data.fp) || 0;
    const recall = data.tp / (data.tp + data.fn) || 0;
    const f1 = 2 * (precision * recall) / (precision + recall) || 0;
    const support = data.tp + data.fn;

    if (support > 0) {
      totalF1 += f1;
      weightedF1Sum += f1 * support;
      classes++;
      console.log(`[${cls.padEnd(8)}] P: ${(precision*100).toFixed(1)}% | R: ${(recall*100).toFixed(1)}% | F1: ${(f1*100).toFixed(1)}% | Support: ${support}`);
    }
  }

  const accuracy = correct / totalSamples;
  const macroF1 = totalF1 / classes;
  const weightedF1 = weightedF1Sum / totalSamples;
  
  console.log(`\nMetrics Summary:`);
  console.log(`- Overall Accuracy : ${(accuracy * 100).toFixed(1)}%`);
  console.log(`- Macro F1 Score   : ${(macroF1 * 100).toFixed(1)}%`);
  console.log(`- Weighted F1 Score: ${(weightedF1 * 100).toFixed(1)}%`);

  console.log(`\n--- CONFUSION MATRIX ---`);
  console.log(`(Row = Actual, Column = Predicted)`);
  const header = "         " + LABELS.map(l => l.substring(0, 3).padStart(5)).join(" ");
  console.log(header);
  for (const actual of LABELS) {
    let rowStr = actual.padEnd(8) + " ";
    for (const predicted of LABELS) {
      rowStr += confusionMatrix[actual][predicted].toString().padStart(5) + " ";
    }
    console.log(rowStr);
  }
  
  expect(macroF1).toBeGreaterThan(0.50); 
});

import { escapeMarkdown } from "./index";

test("escapeMarkdown sanitizes pipe characters and newlines", () => {
  const badInput = "Hello | World\nNew Line";
  const safe = escapeMarkdown(badInput);
  expect(safe).toBe("Hello \\| World New Line");
});
