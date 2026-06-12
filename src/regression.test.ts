import { expect, test, describe } from "bun:test";
import { analyzeComment } from "./index";

describe("Known out-of-distribution failures", () => {
  test("metaphorical darkness = sadness about future", async () => {
    const result = await analyzeComment("videonya gelap banget kaya masa depanku");
    expect(result.label).toBe("NEGATIVE");
  });

  test("can't stop watching = praise for content", async () => {
    const result = await analyzeComment("gue gak bisa berenti nonton, padahal besok ujian");
    expect(result.label).toBe("POSITIVE");
  });

  test("lacks excitement = criticism", async () => {
    const result = await analyzeComment("kurang greget euy");
    expect(result.label).toBe("NEGATIVE");
  });

  test("too many ads, nauseating = negative", async () => {
    const result = await analyzeComment("banyak iklannya bikin enek");
    expect(result.label).toBe("NEGATIVE");
  });
});

describe("Negation handling", () => {
  test("gak bagus → NEGATIVE", async () => {
    const result = await analyzeComment("gak bagus");
    expect(result.label).toBe("NEGATIVE");
  });

  test("ga jelek kok → POSITIVE", async () => {
    const result = await analyzeComment("ga jelek kok");
    expect(result.label).toBe("POSITIVE");
  });

  test("tidak suka sama sekali → NEGATIVE", async () => {
    const result = await analyzeComment("tidak suka sama sekali");
    expect(result.label).toBe("NEGATIVE");
  });

  test("ga ada yang bagus → NEGATIVE", async () => {
    const result = await analyzeComment("ga ada yang bagus");
    expect(result.label).toBe("NEGATIVE");
  });
});

describe("Sarcasm and indirect sentiment", () => {
  test("sarcastic praise with disgust → NEGATIVE", async () => {
    const result = await analyzeComment("bagus banget sampe pengen muntah");
    expect(result.label).toBe("NEGATIVE");
  });

  test("sarcastic compliment about boring content → NEGATIVE", async () => {
    const result = await analyzeComment("wah hebat ya bisa bikin orang bosen");
    expect(result.label).toBe("NEGATIVE");
  });

  test("encouraging trash content → NEGATIVE or TOXIC", async () => {
    const result = await analyzeComment("semangat terus bikin konten sampah");
    expect(["NEGATIVE", "TOXIC"]).toContain(result.label);
  });
});

describe("Code-mixing Indonesian-English", () => {
  test("mixed praise and criticism → MIXED", async () => {
    const result = await analyzeComment("the video is good tapi audionya jelek");
    expect(result.label).toBe("MIXED");
  });

  test("full English praise → POSITIVE", async () => {
    const result = await analyzeComment("nice content, very helpful");
    expect(result.label).toBe("POSITIVE");
  });

  test("English + Indonesian negative → NEGATIVE", async () => {
    const result = await analyzeComment("worst video ever, buang waktu");
    expect(result.label).toBe("NEGATIVE");
  });
});

describe("Implicit sentiment", () => {
  test("anticipation for updates = positive engagement", async () => {
    const result = await analyzeComment("kapan update lagi? udah lama banget");
    expect(result.label).toBe("POSITIVE");
  });

  test("regret watching → NEGATIVE", async () => {
    const result = await analyzeComment("nyesel nonton ini");
    expect(result.label).toBe("NEGATIVE");
  });

  test("sleeping better than watching → NEGATIVE", async () => {
    const result = await analyzeComment("mending tidur daripada nonton ini");
    expect(result.label).toBe("NEGATIVE");
  });
});
