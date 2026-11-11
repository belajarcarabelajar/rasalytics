import { expect, test } from "bun:test";
import { analyzeEdgeSafe, preprocess } from "./shared-sentiment";

// Quadratic matching needs over a billion steps for this input (seconds); linear matching
// needs milliseconds. The bound sits between the two with room for a slow shared runner.
const LONG_TOKEN_LIMIT_MS = 1000;

test("preprocess handles a 50000 character token without a dot in linear time", () => {
  const started = performance.now();
  const { normalized, urls } = preprocess("a".repeat(50000));
  const elapsed = performance.now() - started;

  expect(urls).toEqual([]);
  expect(normalized).toBe("a");
  expect(elapsed).toBeLessThan(LONG_TOKEN_LIMIT_MS);
});

test("preprocess still strips a bare domain that follows a non-alphanumeric character", () => {
  const { normalized, urls } = preprocess("cek foo-bar.com/x ok");
  expect(urls).toEqual(["bar.com/x"]);
  expect(normalized).toBe("cek foo ok");
});

test("analyzeEdgeSafe - empty or emoji only returns NEUTRAL", () => {
  const result = analyzeEdgeSafe("");
  expect(result.label).toBe("NEUTRAL");
  expect(result.confidence).toBe(100);
  expect(result.reasoning).toBe("Empty or emoji only");
});

test("analyzeEdgeSafe - neutral text returns NEUTRAL", () => {
  const result = analyzeEdgeSafe("ini buku meja");
  expect(result.label).toBe("NEUTRAL");
  expect(result.score).toBe(0);
});

test("analyzeEdgeSafe - positive text returns POSITIVE", () => {
  const result = analyzeEdgeSafe("bagus keren mantap");
  expect(result.label).toBe("POSITIVE");
  expect(result.score).toBe(1);
});

test("analyzeEdgeSafe - negative text returns NEGATIVE", () => {
  const result = analyzeEdgeSafe("jelek buruk payah");
  expect(result.label).toBe("NEGATIVE");
  expect(result.score).toBe(-1);
});

test("analyzeEdgeSafe - mixed text returns MIXED", () => {
  const result = analyzeEdgeSafe("bagus tapi jelek");
  expect(result.label).toBe("MIXED");
  expect(result.score).toBe(0);
});

test("analyzeEdgeSafe - spam detection via URL", () => {
  const result = analyzeEdgeSafe("kunjungi http://example.com");
  expect(result.label).toBe("SPAM");
  expect(result.isSpam).toBe(true);
});

test("analyzeEdgeSafe - spam detection via 'link' keyword", () => {
  const result = analyzeEdgeSafe("klik link di bio");
  expect(result.label).toBe("SPAM");
  expect(result.isSpam).toBe(true);
});

test("analyzeEdgeSafe - spam detection via spam keywords", () => {
  const result = analyzeEdgeSafe("subs channel aku ya");
  expect(result.label).toBe("SPAM");
  expect(result.isSpam).toBe(true);
});

test("analyzeEdgeSafe - toxic detection via toxic lexicon", () => {
  const result = analyzeEdgeSafe("dasar lu anjing");
  expect(result.label).toBe("TOXIC");
  expect(result.isToxic).toBe(true);
});
