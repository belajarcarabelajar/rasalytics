import { expect, test } from "bun:test";
import { readFileSync } from "fs";

// Mock browser environment
const window: any = { location: { hostname: "localhost" } };
const document: any = { addEventListener: () => {} };

// We need to evaluate app.v8.js to load RasalyticsExportHelpers onto our mock window
const appJsCode = readFileSync("public/app.v8.js", "utf-8");
eval(appJsCode);

const escapeCsv = window.RasalyticsExportHelpers.escapeCsv;
const generateReportMarkdown = window.RasalyticsExportHelpers.generateReportMarkdown;

test("escapeCsv - standard strings", () => {
  expect(escapeCsv("hello")).toBe('"hello"');
  expect(escapeCsv("hello world")).toBe('"hello world"');
});

test("escapeCsv - nulls and undefined", () => {
  expect(escapeCsv(null)).toBe('');
  expect(escapeCsv(undefined)).toBe('');
});

test("escapeCsv - formula injection", () => {
  expect(escapeCsv("=1+1")).toBe('"\'=1+1"');
  expect(escapeCsv("+A1")).toBe('"\'+A1"');
  expect(escapeCsv("-B2")).toBe('"\'-B2"');
  expect(escapeCsv("@SUM(A1:A2)")).toBe('"\'@SUM(A1:A2)"');
});

test("escapeCsv - quotes and newlines", () => {
  expect(escapeCsv('he said "hello"')).toBe('"he said ""hello"""');
  expect(escapeCsv("line1\nline2")).toBe('"line1\nline2"');
  expect(escapeCsv("a,b,c")).toBe('"a,b,c"');
});

test("generateReportMarkdown - structure", () => {
  const data = {
    videoDetails: { title: "Test Vid", channel: "Tester", views: 1000, likes: 50, commentCount: 10 },
    total: 10, toxic: 1, spam: 0, positive: 5, neutral: 2, negative: 3, mixed: 0,
    topPositive: [
      { author: "user1", sentiment: "POSITIVE", confidence: 90, text: "great vid" }
    ],
    timeSeries: [
      { date: "2026-06-12", pos: 5, neg: 3 }
    ]
  };
  const md = generateReportMarkdown(data);
  expect(md).toContain("# Analysis Report: Test Vid");
  expect(md).toContain("- **Views**: 1,000");
  expect(md).toContain("## Top Positive Comments");
  expect(md).toContain("> **@user1** [POSITIVE] (90%)");
  expect(md).toContain("> great vid");
  expect(md).toContain("## Sentiment Over Time");
  expect(md).toContain("| 2026-06-12 | 5 | 3 |");
});
