import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const appJs = readFileSync(join(import.meta.dir, "public", "app.v8.js"), "utf-8");

// Evaluates the browser script against a stub window and returns its WORKER_URL and API helpers
function loadApp(hostname: string): { workerUrl: string; helpers: any } {
  const window: any = { location: { hostname } };
  const document: any = { addEventListener: () => {} };
  const workerUrl = eval(`${appJs}\n;WORKER_URL`);
  void document;
  return { workerUrl, helpers: window.RasalyticsApiHelpers };
}

test("production pages call the API on the api-rasalytics custom domain", () => {
  expect(loadApp("rasalytics.pages.dev").workerUrl).toBe(
    "https://api-rasalytics.belajarcarabelajar.com",
  );
});

test("localhost still calls the local wrangler dev server", () => {
  expect(loadApp("localhost").workerUrl).toBe("http://127.0.0.1:8787");
});

test("a 429 response turns into a wait message using Retry-After seconds", () => {
  const { helpers } = loadApp("rasalytics.pages.dev");
  expect(helpers.apiErrorMessage(429, "60", { error: "Too many requests" })).toBe(
    "TOO MANY REQUESTS. TRY AGAIN IN 60 SECONDS.",
  );
});

test("a 429 response without a usable Retry-After asks to try again later", () => {
  const { helpers } = loadApp("rasalytics.pages.dev");
  expect(helpers.apiErrorMessage(429, null, {})).toBe("TOO MANY REQUESTS. TRY AGAIN LATER.");
});

test("other API errors keep the server message", () => {
  const { helpers } = loadApp("rasalytics.pages.dev");
  expect(helpers.apiErrorMessage(400, null, { error: "Invalid videoId" })).toBe("Invalid videoId");
  expect(helpers.apiErrorMessage(500, null, {})).toBe("API REJECTED REQUEST");
});
