import { expect, test } from "bun:test";
import { join } from "node:path";

const config = Bun.TOML.parse(await Bun.file(join(import.meta.dir, "wrangler.toml")).text()) as any;

test("the worker is served on the api-rasalytics custom domain", () => {
  expect(config.routes).toEqual([
    { pattern: "api-rasalytics.belajarcarabelajar.com", custom_domain: true },
  ]);
});

test("workers.dev stays enabled for clients still on the old URL", () => {
  expect(config.workers_dev).toBe(true);
});

test("the analyze rate limiter keeps 10 requests per 60s in its own namespace", () => {
  expect(config.ratelimits).toEqual([
    { name: "ANALYZE_RATE_LIMITER", namespace_id: "81001", simple: { limit: 10, period: 60 } },
  ]);
});
