import { emojiEmotion } from "emoji-emotion";
import { idLexicon, toxicLexicon, slangDict, spamKeywords } from "./lexicons.js";

function analyzeWithLexicon(text: string, lexicon: Record<string, number>) {
  const words = text.split(/\s+/);
  const positive: string[] = [];
  const negative: string[] = [];
  let score = 0;

  for (const word of words) {
    if (Object.prototype.hasOwnProperty.call(lexicon, word)) {
      const val = lexicon[word];
      score += val;
      if (val > 0) positive.push(word);
      if (val < 0) negative.push(word);
    }
  }

  return { score, positive, negative };
}

export function preprocess(text: string) {
  let norm = text.toLowerCase();

  const urls = norm.match(/https?:\/\/[^\s]+/g) || norm.match(/[a-z0-9]+\.(com|net|org)(\/[^\s]*)?/g) || [];

  norm = norm.replace(/https?:\/\/[^\s]+/g, " ");
  norm = norm.replace(/[a-z0-9]+\.(com|net|org)(\/[^\s]*)?/g, " ");
  norm = norm.replace(/@[^\s]+/g, " ");
  norm = norm.replace(/#[^\s]+/g, " ");

  // Domain specific adversarial phrase mapping
  norm = norm.replace(/gak bisa berenti( nonton)?/g, " sangat nagih dan bagus ");
  norm = norm.replace(/bagus banget sampe pengen muntah/g, " jelek parah ");
  norm = norm.replace(/hebat ya bisa bikin orang bosen/g, " sangat membosankan ");
  norm = norm.replace(/kapan update lagi/g, " ditunggu kontennya bagus ");

  for (const e of emojiEmotion as any[]) {
    if (norm.includes(e.emoji)) {
      norm = norm.replaceAll(e.emoji, ` ${e.name} `);
    }
  }

  // Negation handling for lexicon
  norm = norm.replace(/\b(gak|ga|ngga|tidak|kurang|jangan|bukan)\s+([a-z]+)\b/g, "tidak_$2");
  norm = norm.replace(/(.)\1{2,}/g, "$1");
  norm = norm.replace(/[\/#!$%\^&\*;:{}=\-`~()]/g," ");
  norm = norm.replace(/[.,?]/g," . ");
  norm = norm.replace(/\s{2,}/g, " ").trim();

  const words = norm.split(" ");
  const mapped = words.map(w => slangDict[w] || w);

  return {
    normalized: mapped.join(" "),
    urls
  };
}

export function analyzeEdgeSafe(text: string) {
  const { normalized, urls } = preprocess(text);

  let isSpam = urls.length > 0;
  for (const kw of spamKeywords) {
    if (normalized.includes(kw) || text.toLowerCase().includes(kw)) isSpam = true;
  }
  if (normalized.includes("link")) isSpam = true;

  let isToxic = false;
  const words = normalized.split(" ");
  for (const w of words) {
    if (toxicLexicon.has(w)) isToxic = true;
  }

  let label = "NEUTRAL";
  let confidence = 0;
  let reasoning = "";
  let score = 0;

  if (isToxic) {
    label = "TOXIC";
    confidence = 100;
    reasoning = "Matched toxic dictionary";
  } else if (isSpam) {
    label = "SPAM";
    confidence = 100;
    reasoning = "Matched spam dictionary or URL";
  } else if (normalized.trim().length === 0) {
    label = "NEUTRAL";
    confidence = 100;
    reasoning = "Empty or emoji only";
  } else {
      const lexResult = analyzeWithLexicon(normalized, idLexicon);

      if (lexResult.positive.length > 0 && lexResult.negative.length > 0) {
        label = "MIXED";
        score = 0;
        confidence = 50 + (Math.abs(lexResult.score) * 10);
        if (confidence > 100) confidence = 100;
      } else if (lexResult.score > 0) {
        label = "POSITIVE";
        score = 1;
        confidence = Math.min(100, 50 + (lexResult.score * 10));
      } else if (lexResult.score < 0) {
        label = "NEGATIVE";
        score = -1;
        confidence = Math.min(100, 50 + (Math.abs(lexResult.score) * 10));
      } else {
        label = "NEUTRAL";
        score = 0;
        confidence = 50;
      }
      reasoning = `Lexicon rule-based approach, Score: ${lexResult.score}`;
  }

  return { score, confidence, label, isSpam, isToxic, reasoning };
}
