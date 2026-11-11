import { expect, test, spyOn } from "bun:test";

// The query string gives this file its own module instance, so the classifier
// state is untouched by other test files that already triggered a load.
const freshModule = "./index.ts?race";

test("getClassifier shares one model load between concurrent callers", async () => {
  const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

  try {
    const { getClassifier } = (await import(freshModule)) as typeof import("./index");
    const results = await Promise.all(Array.from({ length: 5 }, () => getClassifier()));

    // No local model exists under test, so every load attempt ends in one warning.
    const loadWarnings = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes("Failed to load Transformer model"),
    );
    expect(loadWarnings.length).toBe(1);
    expect(results).toEqual(["failed", "failed", "failed", "failed", "failed"]);

    expect(await getClassifier()).toBe("failed");
    expect(
      warnSpy.mock.calls.filter((c) => String(c[0]).includes("Failed to load Transformer model"))
        .length,
    ).toBe(1);
  } finally {
    warnSpy.mockRestore();
  }
});
