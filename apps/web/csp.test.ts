import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const publicDir = join(import.meta.dir, "public");

type Policy = Map<string, string[]>;

function parsePolicy(raw: string): Policy {
  const policy: Policy = new Map();
  for (const part of raw.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) policy.set(name.toLowerCase(), sources);
  }
  return policy;
}

async function headersPolicy(): Promise<Policy> {
  const text = await Bun.file(join(publicDir, "_headers")).text();
  const match = text.match(/^\s*Content-Security-Policy:\s*(.+)$/im);
  if (!match) throw new Error("no Content-Security-Policy in _headers");
  return parsePolicy(match[1]);
}

async function metaPolicy(): Promise<Policy> {
  const text = await Bun.file(join(publicDir, "index.html")).text();
  const match = text.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
  if (!match) throw new Error("no Content-Security-Policy meta in index.html");
  return parsePolicy(match[1]);
}

const required: Array<[string, string[]]> = [
  ["style-src", ["https://fonts.googleapis.com"]],
  ["font-src", ["'self'", "https://fonts.gstatic.com"]],
  ["script-src", ["https://static.cloudflareinsights.com"]],
  ["connect-src", ["https://cloudflareinsights.com"]],
];

describe("web Content-Security-Policy", () => {
  for (const [label, load] of [
    ["_headers", headersPolicy],
    ["index.html meta", metaPolicy],
  ] as const) {
    for (const [directive, sources] of required) {
      test(`${label} ${directive} allows ${sources.join(" ")}`, async () => {
        const policy = await load();
        expect(policy.get(directive) ?? []).toEqual(expect.arrayContaining(sources));
      });
    }
  }

  test("_headers keeps frame-ancestors 'none'", async () => {
    expect((await headersPolicy()).get("frame-ancestors")).toEqual(["'none'"]);
  });

  test("meta omits frame-ancestors, which browsers ignore in a meta policy", async () => {
    expect((await metaPolicy()).has("frame-ancestors")).toBe(false);
  });

  test("meta and _headers policies match apart from frame-ancestors", async () => {
    const headers = await headersPolicy();
    headers.delete("frame-ancestors");
    const meta = await metaPolicy();
    meta.delete("frame-ancestors");
    expect(Object.fromEntries(meta)).toEqual(Object.fromEntries(headers));
  });
});
