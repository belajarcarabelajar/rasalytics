import { parseArgs } from "util";
import Sentiment from "sentiment";
import { writeFileSync, existsSync, unlinkSync } from "fs";
import { emojiEmotion } from "emoji-emotion";
import { idLexicon, toxicLexicon, slangDict, spamKeywords } from "./lexicons";
import { pipeline, env } from "@xenova/transformers";
import { franc } from "franc-min";
import { Database } from "bun:sqlite";

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
const OLLAMA_API_URL = process.env.OLLAMA_API_URL || "http://127.0.0.1:11434/api/generate";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:1.5b";
const MAX_REPLY_PAGES = 5;

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
  is_buzzer?: boolean;
  buzzer_group_id?: string;
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

  norm = norm.replace(/[\/#!$%\^&\*;:{}=\-_`~()]/g," ");
  norm = norm.replace(/[.,?]/g," . ");
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
      
      const lexResult = sentiment.analyze(normalized, { extras: idLexicon });
      
      if (confidence < 75 || Math.abs(lexResult.score) >= 2) {
        if (lexResult.score >= 2) {
          totalScore = Math.max(1, totalScore + 1);
          hasPositive = true;
          if (chunks.length <= 2) hasNegative = false;
          usedModel += " + LexOverride(Pos)";
        } else if (lexResult.score <= -2) {
          totalScore = Math.min(-1, totalScore - 1);
          hasNegative = true;
          if (chunks.length <= 2) hasPositive = false;
          usedModel += " + LexOverride(Neg)";
        } else if (lexResult.score === 1 && avgScore <= 0) {
          totalScore += 1;
          hasPositive = true;
          usedModel += " + Lex(Pos)";
        } else if (lexResult.score === -1 && avgScore >= 0) {
          totalScore -= 1;
          hasNegative = true;
          usedModel += " + Lex(Neg)";
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
    const res = await fetch(OLLAMA_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
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
    is_buzzer: false,
    buzzer_group_id: ""
  };
}

function getShingles(text: string, k = 2): Set<string> {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const shingles = new Set<string>();
  if (words.length < k) {
    if (words.length > 0) shingles.add(words.join(" "));
    return shingles;
  }
  for (let i = 0; i <= words.length - k; i++) {
    shingles.add(words.slice(i, i + k).join(" "));
  }
  return shingles;
}

function jaccard(setA: Set<string>, setB: Set<string>) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const elem of setB) {
    if (setA.has(elem)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
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

  const VIDEO_ID = values.videoId as string;
  const MAX_PAGES = parseInt(values.maxPages as string, 10);
  console.log(`Starting comment collection for Video ID: ${VIDEO_ID}...`);

  const dbPath = `./temp_${VIDEO_ID}.sqlite`;
  const db = new Database(dbPath);
  db.run(`CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS comments (
    comment_id TEXT PRIMARY KEY, author TEXT, raw_text TEXT, normalized_text TEXT,
    like_count INTEGER, published_at TEXT, sentiment_score INTEGER, confidence_score INTEGER,
    sentiment_label TEXT, spam_flag INTEGER, toxic_flag INTEGER, reasoning_summary TEXT,
    model_version TEXT, processed_at TEXT, is_buzzer INTEGER, buzzer_group_id TEXT
  )`);

  let pageToken: string | undefined = undefined;
  const tokenQuery = db.query("SELECT value FROM metadata WHERE key = 'last_page_token'");
  const tokenRes = tokenQuery.get() as any;
  if (tokenRes && tokenRes.value) {
    pageToken = tokenRes.value;
    console.log(`Resuming from saved pageToken: ${pageToken}`);
  }

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO comments (
      comment_id, author, raw_text, normalized_text, like_count, published_at, 
      sentiment_score, confidence_score, sentiment_label, spam_flag, toxic_flag, 
      reasoning_summary, model_version, processed_at, is_buzzer, buzzer_group_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const recentShingles: {id: string, shingles: Set<string>, groupId: string}[] = [];
  let pageCount = 0;

  try {
    while (pageCount < MAX_PAGES) {
      const data = await fetchCommentThreads(VIDEO_ID, API_KEY!, pageToken);
      const items = data.items || [];
      if (items.length === 0) break;

      const newComments: CommentData[] = [];
      for (const item of items) {
        const topLevelComment = item.snippet.topLevelComment;
        newComments.push(await processComment(topLevelComment.id, topLevelComment.snippet));

        if (item.snippet.totalReplyCount > 0) {
          let replyPageToken: string | undefined = undefined;
          let replyCount = 0;
          while (replyCount < MAX_REPLY_PAGES) {
            const replyData = await fetchReplies(item.id, API_KEY!, replyPageToken);
            const replies = replyData.items || [];
            for (const reply of replies) {
              newComments.push(await processComment(reply.id, reply.snippet));
            }
            replyPageToken = replyData.nextPageToken;
            if (!replyPageToken) break;
            replyCount++;
          }
        }
      }

      db.transaction(() => {
        for (const c of newComments) {
           const cShingles = getShingles(c.normalized_text);
           let matchedGroup = "";
           let isBuzzer = false;
           
           if (cShingles.size > 0 && !c.spam_flag) {
             for (const recent of recentShingles) {
                const score = jaccard(cShingles, recent.shingles);
                if (score > 0.75) {
                   isBuzzer = true;
                   matchedGroup = recent.groupId || recent.id;
                   if (!recent.groupId) recent.groupId = matchedGroup;
                   break;
                }
             }
           }
           
           c.is_buzzer = isBuzzer;
           c.buzzer_group_id = matchedGroup;
           
           if (cShingles.size > 0 && !c.spam_flag) {
             recentShingles.push({id: c.comment_id, shingles: cShingles, groupId: matchedGroup});
             if (recentShingles.length > 1000) recentShingles.shift();
           }

           insertStmt.run(
             c.comment_id, c.author, c.raw_text, c.normalized_text, c.like_count, c.published_at,
             c.sentiment_score, c.confidence_score, c.sentiment_label, c.spam_flag ? 1 : 0, 
             c.toxic_flag ? 1 : 0, c.reasoning_summary, c.model_version, c.processed_at,
             c.is_buzzer ? 1 : 0, c.buzzer_group_id
           );
        }
      })();

      pageToken = data.nextPageToken;
      if (pageToken) {
         db.query(`INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_page_token', ?)`).run(pageToken);
      } else {
         db.query(`DELETE FROM metadata WHERE key = 'last_page_token'`).run();
         break;
      }
      pageCount++;
      console.log(`Processed page ${pageCount} ...`);
    }
  } catch (err: any) {
    console.error(`\nExecution stopped: ${err.message}`);
    console.error(`Data is safely stored in ${dbPath}. Run again to resume.`);
  }

  try {
    const totalCount = (db.query("SELECT COUNT(*) as count FROM comments").get() as any).count;
    if (totalCount > 0) {
       const positive = (db.query("SELECT COUNT(*) as c FROM comments WHERE sentiment_label='POSITIVE'").get() as any).c;
       const negative = (db.query("SELECT COUNT(*) as c FROM comments WHERE sentiment_label='NEGATIVE'").get() as any).c;
       const neutral = (db.query("SELECT COUNT(*) as c FROM comments WHERE sentiment_label='NEUTRAL'").get() as any).c;
       const mixed = (db.query("SELECT COUNT(*) as c FROM comments WHERE sentiment_label='MIXED'").get() as any).c;
       const spam = (db.query("SELECT COUNT(*) as c FROM comments WHERE spam_flag=1").get() as any).c;
       const toxic = (db.query("SELECT COUNT(*) as c FROM comments WHERE toxic_flag=1").get() as any).c;
       const buzzer = (db.query("SELECT COUNT(*) as c FROM comments WHERE is_buzzer=1").get() as any).c;

       const topPositive = db.query("SELECT * FROM comments WHERE sentiment_label='POSITIVE' AND spam_flag=0 ORDER BY like_count DESC LIMIT 5").all() as any[];
       const topNegative = db.query("SELECT * FROM comments WHERE sentiment_label='NEGATIVE' AND spam_flag=0 ORDER BY like_count DESC LIMIT 5").all() as any[];
       
       const buzzerRings = db.query(`
         SELECT buzzer_group_id, COUNT(*) as buzz_count, raw_text 
         FROM comments 
         WHERE buzzer_group_id != '' 
         GROUP BY buzzer_group_id 
         ORDER BY buzz_count DESC 
         LIMIT 5
       `).all() as any[];

       const markdownLines: string[] = [
        `# YouTube Comments Analysis: ${VIDEO_ID}`,
        `*Model Version: ${MODEL_VERSION}*`,
        ``,
        `## 📊 Summary & Actionable Insights`,
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

       const mdPath = `./comments_${VIDEO_ID}.md`;
       const csvPath = `./comments_${VIDEO_ID}.csv`;
       
       writeFileSync(mdPath, markdownLines.join("\n"), "utf-8");
       
       const allRows = db.query("SELECT * FROM comments").all() as any[];
       const csvLines = ["comment_id,author,sentiment_label,is_spam,is_toxic,is_buzzer,buzzer_group_id,raw_text"];
       for (const r of allRows) {
         const escapedText = r.raw_text.replace(/"/g, '""');
         csvLines.push(`"${r.comment_id}","${r.author}","${r.sentiment_label}",${r.spam_flag},${r.toxic_flag},${r.is_buzzer},"${r.buzzer_group_id}","${escapedText}"`);
       }
       writeFileSync(csvPath, csvLines.join("\n"), "utf-8");

       console.log(`\n=== SENTIMENT RECAP ===`);
       console.log(`Macro F1 requirement: Check test suite (rtk bun test)`);
       console.log(`Total Comments: ${totalCount}`);
       console.log(`Positive: ${positive}`);
       console.log(`Negative: ${negative}`);
       console.log(`Neutral: ${neutral}`);
       console.log(`Mixed: ${mixed}`);
       console.log(`Spam: ${spam}`);
       console.log(`Toxic: ${toxic}`);
       console.log(`Buzzer: ${buzzer}`);
       console.log(`=======================`);
       console.log(`Markdown report saved to: ${mdPath}`);
       console.log(`Raw data exported to: ${csvPath}`);
    }
    
    db.close();
    if (existsSync(dbPath)) {
       unlinkSync(dbPath);
       console.log(`Cleaned up temporary database: ${dbPath}`);
    }
  } catch (err: any) {
    console.error(`Error during report generation: ${err.message}`);
  }
}

run();