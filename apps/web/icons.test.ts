import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const publicDir = join(import.meta.dir, "public");
const indexHtml = () => Bun.file(join(publicDir, "index.html")).text();

// Width and height of a PNG from its IHDR chunk.
async function pngSize(name: string): Promise<[number, number]> {
  const buf = Buffer.from(await Bun.file(join(publicDir, name)).arrayBuffer());
  expect(buf.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

// Image sizes listed in an ICO directory (0 means 256).
async function icoSizes(name: string): Promise<number[]> {
  const buf = Buffer.from(await Bun.file(join(publicDir, name)).arrayBuffer());
  expect(buf.readUInt16LE(0)).toBe(0);
  expect(buf.readUInt16LE(2)).toBe(1);
  const sizes: number[] = [];
  for (let i = 0; i < buf.readUInt16LE(4); i++) {
    const w = buf[6 + i * 16] || 256;
    const h = buf[7 + i * 16] || 256;
    expect(w).toBe(h);
    sizes.push(w);
  }
  return sizes.sort((a, b) => a - b);
}

describe("Google-eligible favicon and logo", () => {
  test("favicon.ico holds square 16, 32 and 48 px images", async () => {
    expect(await icoSizes("favicon.ico")).toEqual([16, 32, 48]);
  });

  test("PNG icons and logo have the expected square sizes", async () => {
    expect(await pngSize("icon-192.png")).toEqual([192, 192]);
    expect(await pngSize("apple-touch-icon.png")).toEqual([180, 180]);
    expect(await pngSize("logo-512.png")).toEqual([512, 512]);
  });

  test("home page links the raster favicons before any SVG icon", async () => {
    const html = await indexHtml();
    const icons = [...html.matchAll(/<link\s+rel="(icon|apple-touch-icon)"[^>]*>/gi)].map((m) => m[0]);
    expect(icons[0]).toContain('href="/favicon.ico"');
    expect(icons[0]).toContain('sizes="48x48"');
    expect(icons).toContainEqual(expect.stringContaining('href="/icon-192.png"'));
    expect(icons).toContainEqual(expect.stringContaining('rel="apple-touch-icon" href="/apple-touch-icon.png"'));
  });

  test("JSON-LD names an Organization with a PNG logo of at least 112 px", async () => {
    const html = await indexHtml();
    const blocks = [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
    const nodes = blocks.flatMap((b) => {
      const data = JSON.parse(b[1]);
      return data["@graph"] ?? [data];
    });
    const org = nodes.find((n) => n["@type"] === "Organization");
    expect(org?.logo).toBe("https://rasalytics.belajarcarabelajar.com/logo-512.png");
    const [w, h] = await pngSize("logo-512.png");
    expect(Math.min(w, h)).toBeGreaterThanOrEqual(112);
  });
});

describe("social preview image", () => {
  // og:image and twitter:image must point at a real file: a missing one falls through to the SPA and serves HTML (audit 2026-11-01).
  test("og:image and twitter:image are a 1200x630 PNG in public/", async () => {
    const html = await indexHtml();
    const urls = [...html.matchAll(/<meta\s+(?:property|name)="(?:og|twitter):image"\s+content="([^"]+)"/gi)].map((m) => m[1]);
    expect(urls.length).toBe(2);
    for (const url of urls) {
      const { host, pathname } = new URL(url);
      expect(host).toBe("rasalytics.belajarcarabelajar.com");
      expect(await pngSize(pathname.slice(1))).toEqual([1200, 630]);
    }
  });
});
