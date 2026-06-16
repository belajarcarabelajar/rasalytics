import { expect, test } from "bun:test";
import { getShingles, jaccard } from "../src/forensics";

test("getShingles generates correct bigrams", () => {
  const text = "hello world test";
  const shingles = getShingles(text);
  expect(shingles.size).toBeGreaterThan(0);
  expect(shingles.has("hello world")).toBe(true);
  expect(shingles.has("world test")).toBe(true);
});

test("jaccard similarity computes correctly", () => {
  const s1 = new Set(["a", "b", "c"]);
  const s2 = new Set(["b", "c", "d"]);
  const score = jaccard(s1, s2);
  // intersection: b,c (2)
  // union: a,b,c,d (4)
  // 2 / 4 = 0.5
  expect(score).toBe(0.5);
});
