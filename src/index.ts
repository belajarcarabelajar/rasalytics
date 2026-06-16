import "/home/belajarcarabelajar/rasalytics/preload_mock_sharp";
import { writeFileSync, existsSync, unlinkSync } from "fs";
import { emojiEmotion } from "emoji-emotion";
import { idLexicon, toxicLexicon, slangDict, spamKeywords, conjunctions } from "./lexicons";
import { Database } from "bun:sqlite";
import { pipeline, env } from "@xenova/transformers";

env.localModelPath = "./local_models";
env.allowRemoteModels = false;

const MODEL_VERSION = "v8.0-roberta-hybrid";

const API_KEY = process.env.YOUTUBE_API_KEY;
const OLLAMA_API_URL = process.env.OLLAMA_API_URL || "http://127.0.0.1:11434/api/generate";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:1.5b";

const emojiScores: Record<string, number> = {};
emojiEmotion.forEach((e: { emoji: string; polarity: number }) => {
  emojiScores[e.emoji] = e.polarity;
});

export interface CommentData {
  comment_id: string;
  author: string;
  raw_text: string;
  normalized_text: string;
  like_count: number;
  published_at: string;
  sentiment_score: number;
  confidence_score: number;
  sentiment_label: string;
  spam_flag: boolean;
  toxic_flag: boolean;
  reasoning_summary: string;
  model_version: string;
  processed_at: string;
  is_buzzer?: boolean;
  buzzer_group_id?: string;
}

export function escapeMarkdown(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ").replace(/\r/g, "");
}

import { preprocess, analyzeEdgeSafe } from "./shared-sentiment.js";
export { preprocess };

let classifier: Function | "failed" | null = null;

export async function getClassifier() {
  if (!classifier) {
    try {
      classifier = await pipeline("sentiment-analysis", "indonesian-roberta", {
        local_files_only: true,
        quantized: false
      });
    } catch (err) {
      console.warn("Failed to load Transformer model, falling back to Lexicon.", err);
      classifier = "failed";
    }
  }
  return classifier;
}

function splitByConjunction(text: string): string[] {
  let parts = [text];
  for (const c of conjunctions) {
     let newParts: string[] = [];
     for (const p of parts) {
        newParts.push(...p.split(c));
     }
     parts = newParts;
  }
  return parts.filter(p => p.trim().length > 3);
}

export async function analyzeComment(text: string): Promise<{
  score: number,
  confidence: number,
  label: string,
  isSpam: boolean,
  isToxic: boolean,
  reasoning: string
}> {
  // Preprocess text without negation joining for the transformer
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
  norm = norm.replace(/ga ada yang bagus/g, " semuanya jelek buruk ");
  norm = norm.replace(/gak ada yang bagus/g, " semuanya jelek buruk ");

  for (const e of emojiEmotion as { emoji: string; name: string }[]) {
    if (norm.includes(e.emoji)) {
      norm = norm.replaceAll(e.emoji, ` ${e.name} `);
    }
  }

  norm = norm.replace(/(.)\1{2,}/g, "$1");
  norm = norm.replace(/[\/#!$%\^&\*;:{}=\-`~()]/g," ");
  norm = norm.replace(/[.,?]/g," . ");
  norm = norm.replace(/\s{2,}/g, " ").trim();

  const words = norm.split(" ");
  const mapped = words.map(w => slangDict[w] || w);
  const normalizedForTransformer = mapped.join(" ");

  let isSpam = urls.length > 0;
  for (const kw of spamKeywords) {
    if (normalizedForTransformer.includes(kw) || text.toLowerCase().includes(kw)) isSpam = true;
  }
  if (normalizedForTransformer.includes("link")) isSpam = true;

  let isToxic = false;
  for (const w of words) {
    if (toxicLexicon.has(w)) isToxic = true;
  }

  let label = "NEUTRAL";
  let confidence = 100;
  let reasoning = "";
  let score = 0;

  if (isToxic) {
    label = "TOXIC";
    reasoning = "Matched toxic dictionary";
    score = -1;
  } else if (isSpam) {
    label = "SPAM";
    reasoning = "Matched spam dictionary or URL";
    score = 0;
  } else if (normalizedForTransformer.trim().length === 0) {
    label = "NEUTRAL";
    reasoning = "Empty or emoji only";
    score = 0;
  } else {
    // Lexicon Scoring for override heuristics
    let lexiconScore = 0;
    for (const w of mapped) {
      if (idLexicon[w]) lexiconScore += idLexicon[w];
    }
    for (let i = 0; i < mapped.length - 1; i++) {
      const bigram = `${mapped[i]}_${mapped[i+1]}`;
      if (idLexicon[bigram]) lexiconScore += idLexicon[bigram];
    }

    // Transformer Inference
    const cls = await getClassifier();

    if (cls === "failed") {
      return analyzeEdgeSafe(text);
    }

    // MIXED Detection via conjunction splitting
    const parts = splitByConjunction(normalizedForTransformer);
    if (parts.length > 1) {
       let hasPos = false;
       let hasNeg = false;
       for (const p of parts) {
          const res = await cls(p);
          let partLabel = res[0].label.toUpperCase();
          
          let pLexScore = 0;
          const pWords = p.split(" ");
          for (const w of pWords) if (idLexicon[w]) pLexScore += idLexicon[w];
          for (let i = 0; i < pWords.length - 1; i++) {
             const bg = `${pWords[i]}_${pWords[i+1]}`;
             if (idLexicon[bg]) pLexScore += idLexicon[bg];
          }
          
          if (partLabel === 'NEUTRAL') {
            if (pLexScore >= 2) partLabel = 'POSITIVE';
            else if (pLexScore <= -2) partLabel = 'NEGATIVE';
          } else if (partLabel === 'NEGATIVE' && pLexScore >= 3) {
            partLabel = 'POSITIVE';
          } else if (partLabel === 'POSITIVE' && pLexScore <= -3) {
            partLabel = 'NEGATIVE';
          }
          
          if (partLabel === 'POSITIVE') hasPos = true;
          if (partLabel === 'NEGATIVE') hasNeg = true;
       }
       if (hasPos && hasNeg) {
          return { score: 0, confidence: 80, label: "MIXED", isSpam, isToxic, reasoning: "Transformer: mixed sentiment across conjunctions" };
       }
    }

    // Whole sentence classification
    const res = await cls(normalizedForTransformer);
    label = res[0].label.toUpperCase();
    confidence = Math.round(res[0].score * 100);
    reasoning = `Model: Indonesian RoBERTa Transformer (${confidence}%)`;
    score = label === 'POSITIVE' ? 1 : label === 'NEGATIVE' ? -1 : 0;

    // Lexicon Override Heuristics
    if (label === 'NEUTRAL') {
      if (lexiconScore >= 2) {
        label = 'POSITIVE'; score = 1; confidence = 75; reasoning += " (Lexicon override: Positive)";
      } else if (lexiconScore <= -2) {
        label = 'NEGATIVE'; score = -1; confidence = 75; reasoning += " (Lexicon override: Negative)";
      }
    } else if (label === 'NEGATIVE' && lexiconScore >= 3) {
      label = 'POSITIVE'; score = 1; confidence = 75; reasoning += " (Lexicon override: Strong Positive)";
    } else if (label === 'POSITIVE' && lexiconScore <= -3) {
      label = 'NEGATIVE'; score = -1; confidence = 75; reasoning += " (Lexicon override: Strong Negative)";
    }
  }

  return { score, confidence, label, isSpam, isToxic, reasoning };
}

export async function fetchWithRetry(url: string, retries = 3, backoff = 1000): Promise<any> {
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();

      if (response.status >= 400 && response.status < 500) {
        const errorText = await response.text();
        if (response.status === 403) {
          let errorData: Record<string, any> = {};
          try { errorData = JSON.parse(errorText); } catch(e) {
            console.warn("Could not parse error response text as JSON.");
          }

          if (errorData.error?.errors?.[0]?.reason === "commentsDisabled") {
            throw new Error("Comments are disabled for this video.");
          }
        }
        throw new Error(`API Error ${response.status}: ${errorText}`);
      }

      if (i === retries) {
        throw new Error(`API failed after ${retries} retries with status ${response.status}`);
      }

      console.warn(`Retry ${i + 1}/${retries} after API error ${response.status}... waiting ${backoff}ms`);
    } catch (err: any) {
      if (err.message?.includes("API Error") || err.message?.includes("API failed") || err.message?.includes("Comments are disabled")) {
        throw err;
      }
      if (i === retries) {
        throw err;
      }
      console.warn(`Retry ${i + 1}/${retries} after network error: ${err.message}... waiting ${backoff}ms`);
    }
    await new Promise(res => setTimeout(res, backoff));
    backoff *= 2;
  }
}

export async function fetchCommentThreads(videoId: string, apiKey: string, pageToken?: string) {
  const url = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
  url.searchParams.append("part", "snippet");
  url.searchParams.append("videoId", videoId);
  url.searchParams.append("key", apiKey);
  url.searchParams.append("maxResults", "100");
  url.searchParams.append("textFormat", "plainText");
  if (pageToken) url.searchParams.append("pageToken", pageToken);

  return fetchWithRetry(url.toString());
}

export async function fetchReplies(parentId: string, apiKey: string, pageToken?: string) {
  const url = new URL("https://www.googleapis.com/youtube/v3/comments");
  url.searchParams.append("part", "snippet");
  url.searchParams.append("parentId", parentId);
  url.searchParams.append("key", apiKey);
  url.searchParams.append("maxResults", "100");
  url.searchParams.append("textFormat", "plainText");
  if (pageToken) url.searchParams.append("pageToken", pageToken);

  return fetchWithRetry(url.toString());
}



export async function processComment(id: string, snippet: Record<string, any>): Promise<CommentData> {
  const rawText = snippet.textOriginal || snippet.textDisplay || "";
  const { normalized } = preprocess(rawText);
  let { score, confidence, label, isSpam, isToxic, reasoning } = await analyzeComment(rawText);



  return {
    comment_id: id,
    author: snippet.authorDisplayName || "",
    raw_text: rawText.replace(/\n/g, " "),
    normalized_text: normalized,
    like_count: snippet.likeCount || 0,
    published_at: snippet.publishedAt || "",
    sentiment_score: score,
    confidence_score: confidence,
    sentiment_label: label,
    spam_flag: isSpam,
    toxic_flag: isToxic,
    reasoning_summary: reasoning,
    model_version: MODEL_VERSION,
    processed_at: new Date().toISOString(),
    is_buzzer: false,
    buzzer_group_id: ""
  };
}



export interface ReportData {
  VIDEO_ID: string;
  MODEL_VERSION: string;
  videoTitle: string;
  channelName: string;
  viewCount: string;
  likeCount: string;
  commentCount: string;
  positive: number;
  negative: number;
  neutral: number;
  mixed: number;
  xDates: string;
  posCounts: string;
  negCounts: string;
  wordcloudPath: string | null;
  totalCount: number;
  spam: number;
  toxic: number;
  buzzer: number;
  topPositive: any[];
  topNegative: any[];
  buzzerRings: any[];
}

export function generateMarkdownReport(data: ReportData): string[] {
  const { VIDEO_ID, MODEL_VERSION, videoTitle, channelName, viewCount, likeCount, commentCount, positive, negative, neutral, mixed, xDates, posCounts, negCounts, wordcloudPath, totalCount, spam, toxic, buzzer, topPositive, topNegative, buzzerRings } = data;
  return [
    `# YouTube Comments Analysis: ${VIDEO_ID}`,
    `*Model Version: ${MODEL_VERSION}*`,
    ``,
    `## 🎥 Video Details`,
    `- **Title:** ${videoTitle}`,
    `- **Channel:** ${channelName}`,
    `- **Views:** ${viewCount}`,
    `- **Likes:** ${likeCount}`,
    `- **Total Comments (API):** ${commentCount}`,
    ``,
    `## 📊 Summary & Actionable Insights`,
    ``,
    `\`\`\`mermaid`,
    `pie title Sentiment Distribution`,
    `    "Positive" : ${positive}`,
    `    "Negative" : ${negative}`,
    `    "Neutral" : ${neutral}`,
    `    "Mixed" : ${mixed}`,
    `\`\`\``,
    ``,
    `## 📈 Sentiment Over Time`,
    ``,
    `\`\`\`mermaid`,
    `xychart-beta`,
    `    title "Sentiment Trend (Positive vs Negative)"`,
    `    x-axis [${xDates}]`,
    `    y-axis "Count"`,
    `    line [${posCounts}]`,
    `    line [${negCounts}]`,
    `\`\`\``,
    ``,
    `## ☁️ Word Cloud (Top Themes)`,
    wordcloudPath ? `![Word Cloud](${wordcloudPath})` : `*Word cloud generation failed or not enough data.*`,
    ``,
    `- **Total Comments:** ${totalCount}`,
    `- **Positive:** ${positive} (${((positive/totalCount)*100).toFixed(1)}%)`,
    `- **Negative:** ${negative} (${((negative/totalCount)*100).toFixed(1)}%)`,
    `- **Neutral:** ${neutral}`,
    `- **Mixed:** ${mixed}`,
    `- **Spam Ratio:** ${((spam/totalCount)*100).toFixed(1)}% (${spam} comments)`,
    `- **Toxicity Ratio:** ${((toxic/totalCount)*100).toFixed(1)}% (${toxic} comments)`,
    `- **Buzzer/Copas Ratio:** ${((buzzer/totalCount)*100).toFixed(1)}% (${buzzer} suspected)`,
    ``,
    `### 💡 Key Takeaways`,
    `The video received predominantly ${positive > negative ? "Positive" : "Negative"} feedback.`,
    spam > (totalCount * 0.1) ? `⚠️ **Warning:** High spam activity detected.` : `✅ Spam levels are normal.`,
    toxic > (totalCount * 0.05) ? `⚠️ **Warning:** High toxicity levels detected.` : `✅ Community toxicity is low.`,
    buzzer > (totalCount * 0.05) ? `🚨 **Alert:** Significant organized Buzzer/Astroturfing activity detected.` : `✅ Inorganic buzzer manipulation is low.`,
    ``,
    `## 🌟 Top 5 Positive Comments`,
    ...topPositive.map(c => `- **${c.author}** (${c.like_count} likes): "${c.raw_text}" (Confidence: ${c.confidence_score}%)`),
    ``,
    `## 🚨 Top 5 Negative Comments`,
    ...topNegative.map(c => `- **${c.author}** (${c.like_count} likes): "${c.raw_text}" (Confidence: ${c.confidence_score}%)`),
    ``,
    `## 🕸️ Top Buzzer Rings Forensics`,
    buzzerRings.length > 0 ? buzzerRings.map(r => `- **Ring ID:** ${r.buzzer_group_id} | **Size:** ${r.buzz_count + 1} identical comments | **Template:** "${escapeMarkdown(r.raw_text)}"`).join("\n") : `No significant buzzer rings detected.`,
    ``,
    `*Note: Full raw data has been exported to CSV.*`
  ];
}
