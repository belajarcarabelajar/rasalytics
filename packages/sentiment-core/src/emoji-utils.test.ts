import { describe, expect, it } from "bun:test";
import { emojiMap, emojiRegexFastUni, emojiRegexReplace } from "./emoji-utils";

describe("emoji-utils", () => {
  describe("emojiMap", () => {
    it("should correctly map common emojis to their padded names", () => {
      expect(emojiMap.get("💯")).toBe(" 100 ");
      expect(emojiMap.get("👍")).toBe(" thumbsup ");
      expect(emojiMap.get("❤️")).toBe(" heart ");
    });

    it("should contain a large number of emojis", () => {
      expect(emojiMap.size).toBeGreaterThan(100);
    });
  });

  describe("emojiRegexFastUni", () => {
    it("should match standard emojis", () => {
      expect(emojiRegexFastUni.test("hello 👍 world")).toBe(true);
      expect(emojiRegexFastUni.test("🚀")).toBe(true);
      expect(emojiRegexFastUni.test("👨‍👩‍👧‍👦")).toBe(true);
    });

    it("should match explicitly listed edge-case emojis", () => {
      expect(emojiRegexFastUni.test("☹️")).toBe(true);
      expect(emojiRegexFastUni.test("❤️")).toBe(true);
      expect(emojiRegexFastUni.test("☺️")).toBe(true);
      expect(emojiRegexFastUni.test("☠️")).toBe(true);
      expect(emojiRegexFastUni.test("✌️")).toBe(true);
    });

    it("should not match plain text", () => {
      expect(emojiRegexFastUni.test("hello world")).toBe(false);
      expect(emojiRegexFastUni.test("12345")).toBe(false);
      expect(emojiRegexFastUni.test("!@#$%^&*()")).toBe(false);
    });
  });

  describe("emojiRegexReplace", () => {
    it("should match emojis present in the emoji-emotion package", () => {
      const text = "I love this ❤️ and 💯!";
      const matches = text.match(emojiRegexReplace);
      expect(matches).toBeTruthy();
      if (matches) {
        expect(matches.includes("❤️")).toBe(true);
        expect(matches.includes("💯")).toBe(true);
      }
    });

    it("can be used to replace emojis with their string representations", () => {
      const text = "Good job 👍";
      const replaced = text.replace(emojiRegexReplace, (match) => emojiMap.get(match) || match);
      expect(replaced).toBe("Good job  thumbsup ");
    });

    it("should match emojis globally across a string", () => {
       const text = "👍 😊 ❤️";
       const matches = text.match(emojiRegexReplace);
       expect(matches).toBeTruthy();
       if (matches) {
           expect(matches.length).toBe(3);
       }
    });
  });
});
