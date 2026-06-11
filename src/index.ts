import { parseArgs } from "util";
import Sentiment from "sentiment";
import { writeFileSync } from "fs";
import { emojiEmotion } from "emoji-emotion";
import { idLexicon, toxicLexicon, slangDict } from "./lexicons";
import { pipeline, env } from "@xenova/transformers";
import { franc } from "franc-min";

env.localModelPath = './local_models';
env.allowRemoteModels = true;

const MODEL_VERSION = "v6.0-hybrid-ollama";
let classifierEn: any = null;
let classifierId: any = null;

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    videoId: {
      type: "string",
    },
    maxPages: {
      type: "string",
      default: "5",
    },
  },
});

const API_KEY = process.env.YOUTUBE_API_KEY;

const emojiScores: Record<string, number> = {};
emojiEmotion.forEach((e: any) => {
  emojiScores[e.emoji] = e.polarity;
});

const sentiment = new Sentiment();

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
}

export function escapeMarkdown(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ").replace(/\r/g, "");
}

export function preprocess(text: string) {
  let norm = text.toLowerCase();
  
  const urls = norm.match(/https?:\/\/[^\s]+/g) || norm.match(/[a-z0-9]+\.(com|net|org)(\/[^\s]*)?/g) || [];
  
  norm = norm.replace(/https?:\/\/[^\s]+/g, " ");
  norm = norm.replace(/[a-z0-9]+\.(com|net|org)(\/[^\s]*)?/g, " ");
  norm = norm.replace(/@[^\s]+/g, " ");
  norm = norm.replace(/#[^\s]+/g, " ");
  
  // Convert emojis to their text names
  for (const e of emojiEmotion) {
    if (norm.includes(e.emoji)) {
      norm = norm.replaceAll(e.emoji, ` ${e.name} `);
    }
  }

  // handle negations before punctuation removal
  norm = norm.replace(/\b(gak|ga|ngga|tidak)\s+([a-z]+)\b/g, "$1_$2");
  
  // Normalize repeating characters (e.g., baguuuus -> baguus)
  norm = norm.replace(/(.)\1{2,}/g, "$1$1");

  norm = norm.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g," . ");
  norm = norm.replace(/\s{2,}/g, " ").trim();
  
  const words = norm.split(" ");
  const mapped = words.map(w => slangDict[w] || w);
  
  return {
    normalized: mapped.join(" "),
    urls
  };
}

export async function analyzeComment(text: string): Promise<{ 
  score: number, 
  confidence: number,
  label: string, 
  isSpam: boolean, 
  isToxic: boolean, 
  reasoning: string 
}> {
  const { normalized, urls } = preprocess(text);
  
  let isSpam = urls.length > 0;
  const spamKeywords = ["subs", "cek channel", "bio saya", "subscribe", "mampir", "follback", "profilku"];
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
    try {
      const language = franc(normalized);
      let currentClassifier;
      let usedModel = "unknown";

      if (language === 'eng') {
        if (!classifierEn) {
          classifierEn = await pipeline('sentiment-analysis', 'Xenova/distilbert-base-uncased-finetuned-sst-2-english');
        }
        currentClassifier = classifierEn;
        usedModel = "SST-2-English";
      } else {
        if (!classifierId) {
          classifierId = await pipeline('sentiment-analysis', 'Xenova/bert-base-multilingual-uncased-sentiment');
        }
        currentClassifier = classifierId;
        usedModel = "BERT-Multilingual";
      }

      const chunks = normalized.split('.').map(s => s.trim()).filter(s => s.length > 3);
      if (chunks.length === 0) chunks.push(normalized);
      
      let totalScore = 0;
      let totalConfidence = 0;
      let hasPositive = false;
      let hasNegative = false;
      
      for (const chunk of chunks) {
        const result = await currentClassifier(chunk);
        const modelLabel = result[0].label.toLowerCase();
        const modelScore = result[0].score;
        
        let chunkScore = 0;
        if (modelLabel.includes("pos") || modelLabel.includes("4 star") || modelLabel.includes("5 star")) { chunkScore = 1; hasPositive = true; }
        else if (modelLabel.includes("neg") || modelLabel.includes("1 star") || modelLabel.includes("2 star")) { chunkScore = -1; hasNegative = true; }
        
        totalScore += chunkScore;
        totalConfidence += modelScore;
      }
      
      const avgScore = totalScore / chunks.length;
      confidence = Math.round((totalConfidence / chunks.length) * 100);
      
      if (confidence < 60) {
        const lexResult = sentiment.analyze(normalized, { extras: idLexicon });
        if (lexResult.score > 1 && avgScore <= 0) {
          totalScore += 1;
          usedModel += " + Lexicon(Pos)";
        } else if (lexResult.score < -1 && avgScore >= 0) {
          totalScore -= 1;
          usedModel += " + Lexicon(Neg)";
        }
      }

      if (hasPositive && hasNegative) {
        label = "MIXED";
        score = 0;
      } else if (totalScore > 0) {
        label = "POSITIVE";
        score = 1;
      } else if (totalScore < 0) {
        label = "NEGATIVE";
        score = -1;
      } else {
        label = "NEUTRAL";
        score = 0;
      }
      
      reasoning = `Lang: ${language}, Model: ${usedModel}, Score: ${totalScore.toFixed(2)} (${confidence}%)`;
    } catch (e: any) {
       reasoning = `Error in ML Model: ${e.message}`;
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
          let errorData: any = {};
          try { errorData = JSON.parse(errorText); } catch(e) {}
          
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

async function fetchCommentThreads(videoId: string, apiKey: string, pageToken?: string) {
  const url = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
  url.searchParams.append("part", "snippet");
  url.searchParams.append("videoId", videoId);
  url.searchParams.append("key", apiKey);
  url.searchParams.append("maxResults", "100");
  url.searchParams.append("textFormat", "plainText");
  if (pageToken) url.searchParams.append("pageToken", pageToken);

  return fetchWithRetry(url.toString());
}

async function fetchReplies(parentId: string, apiKey: string, pageToken?: string) {
  const url = new URL("https://www.googleapis.com/youtube/v3/comments");
  url.searchParams.append("part", "snippet");
  url.searchParams.append("parentId", parentId);
  url.searchParams.append("key", apiKey);
  url.searchParams.append("maxResults", "100");
  url.searchParams.append("textFormat", "plainText");
  if (pageToken) url.searchParams.append("pageToken", pageToken);

  return fetchWithRetry(url.toString());
}

async function verifyWithOllama(text: string, mlLabel: string): Promise<string> {
  const sample = text.length > 200 ? text.substring(0, 200) + "..." : text;
  const safeSample = sample.replace(/"/g, "'");
  const prompt = `You are an expert sentiment analyzer for Indonesian YouTube comments.
Determine the actual sentiment of this comment. It may contain sarcasm, slang, or complaints.
<comment>${safeSample}</comment>
Reply with EXACTLY ONE WORD: POSITIVE, NEGATIVE, or NEUTRAL. No explanations or punctuation.`;

  try {
    const res = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5:1.5b",
        prompt: prompt,
        stream: false,
        options: { temperature: 0.0, num_predict: 5 }
      })
    });
    if (!res.ok) return mlLabel;
    const data = await res.json();
    const output = data.response.trim().toUpperCase();
    if (output.includes("POSITIVE")) return "POSITIVE";
    if (output.includes("NEGATIVE")) return "NEGATIVE";
    if (output.includes("NEUTRAL")) return "NEUTRAL";
    return mlLabel;
  } catch (e) {
    return mlLabel;
  }
}

export async function processComment(id: string, snippet: any): Promise<CommentData> {
  const rawText = snippet.textOriginal || snippet.textDisplay || "";
  const { normalized } = preprocess(rawText);
  let { score, confidence, label, isSpam, isToxic, reasoning } = await analyzeComment(rawText);

  if (!isSpam && !isToxic && normalized.trim().length > 0) {
    const ollamaLabel = await verifyWithOllama(normalized, label);
    if (ollamaLabel !== label) {
      reasoning += ` -> [Ollama Qwen: Corrected from ${label} to ${ollamaLabel}]`;
      label = ollamaLabel;
      if (label === "POSITIVE") score = 1;
      else if (label === "NEGATIVE") score = -1;
      else score = 0;
    } else {
      reasoning += ` -> [Ollama Qwen: Agreed]`;
    }
  }

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
  };
}

async function run() {
  if (process.env.NODE_ENV === "test") return;

  if (!values.videoId) {
    console.error("Error: --videoId is required.");
    process.exit(1);
  }
  if (!API_KEY) {
    console.error("Error: YOUTUBE_API_KEY is not set in .env");
    process.exit(1);
  }

  const VIDEO_ID = values.videoId;
  const MAX_PAGES = parseInt(values.maxPages as string, 10);
  console.log(`Starting comment collection for Video ID: ${VIDEO_ID}...`);

  const allComments: CommentData[] = [];
  let pageToken: string | undefined = undefined;
  let pageCount = 0;

  try {
    while (pageCount < MAX_PAGES) {
      const data = await fetchCommentThreads(VIDEO_ID, API_KEY!, pageToken);
      const items = data.items || [];
      if (items.length === 0) break;

      for (const item of items) {
        const topLevelComment = item.snippet.topLevelComment;
        allComments.push(await processComment(topLevelComment.id, topLevelComment.snippet));

        if (item.snippet.totalReplyCount > 0) {
          let replyPageToken: string | undefined = undefined;
          let replyCount = 0;
          while (replyCount < 5) {
            const replyData = await fetchReplies(item.id, API_KEY!, replyPageToken);
            const replies = replyData.items || [];
            for (const reply of replies) {
              allComments.push(await processComment(reply.id, reply.snippet));
            }
            replyPageToken = replyData.nextPageToken;
            if (!replyPageToken) break;
            replyCount++;
          }
        }
      }
      pageToken = data.nextPageToken;
      if (!pageToken) break;
      pageCount++;
    }
  } catch (err: any) {
    console.error(`Execution stopped: ${err.message}`);
  }

  try {
    if (allComments.length > 0) {
      let positive = 0, negative = 0, neutral = 0, mixed = 0, spam = 0, toxic = 0;
      const positiveComments: CommentData[] = [];
      const negativeComments: CommentData[] = [];

      for (const c of allComments) {
        if (c.sentiment_label === "POSITIVE") { positive++; positiveComments.push(c); }
        else if (c.sentiment_label === "NEGATIVE") { negative++; negativeComments.push(c); }
        else if (c.sentiment_label === "NEUTRAL") neutral++;
        else if (c.sentiment_label === "MIXED") mixed++;
        else if (c.sentiment_label === "SPAM") spam++;
        else if (c.sentiment_label === "TOXIC") toxic++;
      }

      positiveComments.sort((a, b) => b.like_count - a.like_count);
      negativeComments.sort((a, b) => b.like_count - a.like_count);

      const topPositive = positiveComments.slice(0, 5);
      const topNegative = negativeComments.slice(0, 5);

      const markdownLines: string[] = [
        `# YouTube Comments Analysis: ${VIDEO_ID}`,
        `*Model Version: ${MODEL_VERSION}*`,
        ``,
        `## 📊 Summary & Actionable Insights`,
        `- **Total Comments:** ${allComments.length}`,
        `- **Positive:** ${positive} (${((positive/allComments.length)*100).toFixed(1)}%)`,
        `- **Negative:** ${negative} (${((negative/allComments.length)*100).toFixed(1)}%)`,
        `- **Neutral:** ${neutral}`,
        `- **Mixed:** ${mixed}`,
        `- **Spam Ratio:** ${((spam/allComments.length)*100).toFixed(1)}% (${spam} comments)`,
        `- **Toxicity Ratio:** ${((toxic/allComments.length)*100).toFixed(1)}% (${toxic} comments)`,
        ``,
        `### 💡 Key Takeaways`,
        `The video received predominantly ${positive > negative ? "Positive" : "Negative"} feedback.`,
        spam > (allComments.length * 0.1) ? `⚠️ **Warning:** High spam activity detected.` : `✅ Spam levels are normal.`,
        toxic > (allComments.length * 0.05) ? `⚠️ **Warning:** High toxicity levels detected.` : `✅ Community toxicity is low.`,
        ``,
        `## 🌟 Top 5 Positive Comments`,
        ...topPositive.map(c => `- **${c.author}** (${c.like_count} likes): "${c.raw_text}" (Confidence: ${c.confidence_score}%)`),
        ``,
        `## 🚨 Top 5 Negative Comments`,
        ...topNegative.map(c => `- **${c.author}** (${c.like_count} likes): "${c.raw_text}" (Confidence: ${c.confidence_score}%)`),
        ``,
        `## 📄 Full Export Dump`,
        `| ID | Author | Label | Score | Conf | Raw Text | Normalized | Reasoning |`,
        `|---|---|---|---|---|---|---|---|`,
        ...allComments.map(c => `| ${c.comment_id} | ${escapeMarkdown(c.author)} | ${c.sentiment_label} | ${c.sentiment_score} | ${c.confidence_score}% | ${escapeMarkdown(c.raw_text)} | ${escapeMarkdown(c.normalized_text)} | ${escapeMarkdown(c.reasoning_summary)} |`),
      ];

      const outputPath = `./comments_${VIDEO_ID}.md`;
      writeFileSync(outputPath, markdownLines.join("\n"), "utf-8");
      
      console.log(`\n=== SENTIMENT RECAP ===`);
      console.log(`Macro F1 requirement: Check test suite (rtk bun test)`);
      console.log(`Total Comments: ${allComments.length}`);
      console.log(`Positive: ${positive}`);
      console.log(`Negative: ${negative}`);
      console.log(`Neutral: ${neutral}`);
      console.log(`Mixed: ${mixed}`);
      console.log(`Spam: ${spam}`);
      console.log(`Toxic: ${toxic}`);
      console.log(`=======================`);
      console.log(`Full markdown report saved to: ${outputPath}`);
    }
  } catch (err: any) {
    console.error(`Error during report generation: ${err.message}`);
  }
}

run();