import Sentiment from "sentiment";
import { emojiEmotion } from "emoji-emotion";
import { idLexicon, toxicLexicon, slangDict, spamKeywords } from "./lexicons.js";

const sentiment = new Sentiment();

export function preprocess(text: string) {
  let norm = text.toLowerCase();
  
  const urls = norm.match(/https?:\/\/[^\s]+/g) || norm.match(/[a-z0-9]+\.(com|net|org)(\/[^\s]*)?/g) || [];
  
  norm = norm.replace(/https?:\/\/[^\s]+/g, " ");
  norm = norm.replace(/[a-z0-9]+\.(com|net|org)(\/[^\s]*)?/g, " ");
  norm = norm.replace(/@[^\s]+/g, " ");
  norm = norm.replace(/#[^\s]+/g, " ");
  
  for (const e of emojiEmotion as any[]) {
    if (norm.includes(e.emoji)) {
      norm = norm.replaceAll(e.emoji, ` ${e.name} `);
    }
  }

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
    if (normalized.includes(kw)) isSpam = true;
  }

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
      const lexResult = sentiment.analyze(normalized, { extras: idLexicon });
      
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
