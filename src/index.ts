import { parseArgs } from "util";
import { writeFileSync, existsSync, unlinkSync } from "fs";
import { emojiEmotion } from "emoji-emotion";
import { idLexicon, toxicLexicon, slangDict, spamKeywords } from "./lexicons";
import { Database } from "bun:sqlite";

const MODEL_VERSION = "v7.0-pure-classical-ml";
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

import { preprocess } from "./shared-sentiment.js";
export { preprocess };

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
    if (normalized.includes(kw) || text.toLowerCase().includes(kw)) isSpam = true;
  }
  if (normalized.includes("link")) isSpam = true;

  let isToxic = false;
  for (const w of toxicLexicon) {
    if (normalized.includes(w)) isToxic = true;
  }

  let label = "NEUTRAL";
  let confidence = 100;
  let reasoning = "";
  let score = 0;

  if (isToxic) {
    label = "TOXIC";
    reasoning = "Matched toxic dictionary";
  } else if (isSpam) {
    label = "SPAM";
    reasoning = "Matched spam dictionary or URL";
  } else if (normalized.trim().length === 0) {
    label = "NEUTRAL";
    reasoning = "Empty or emoji only";
  } else {
    const words = normalized.split(/\s+/);
    const positive = [];
    const negative = [];
    
    for (let i = 0; i < words.length; i++) {
      if (i < words.length - 1) {
        const bigram = `${words[i]}_${words[i+1]}`;
        if (idLexicon[bigram] !== undefined) {
          const val = idLexicon[bigram];
          score += val;
          if (val > 0) positive.push(bigram);
          if (val < 0) negative.push(bigram);
          i++; continue;
        }
      }
      const word = words[i];
      if (idLexicon[word] !== undefined) {
        const val = idLexicon[word];
        score += val;
        if (val > 0) positive.push(word);
        if (val < 0) negative.push(word);
      }
    }

    if (positive.length > 0 && negative.length > 0) {
      const minNeg = Math.min(...negative.map(w => idLexicon[w]));
      if (minNeg <= -4) {
        label = "NEGATIVE";
        score = -1;
      } else {
        label = "MIXED";
        score = 0;
      }
    } else if (score > 0) {
      label = "POSITIVE";
      score = 1;
    } else if (score < 0) {
      label = "NEGATIVE";
      score = -1;
    }
    
    confidence = Math.min(100, 50 + (Math.abs(score) * 15));
    reasoning = `Model: N-gram Classical Lexicon, RawScore: ${score} (${confidence}%)`;
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



export async function processComment(id: string, snippet: any): Promise<CommentData> {
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

       const topPositive = db.query("SELECT * FROM comments WHERE sentiment_label='POSITIVE' AND spam_flag=0 AND toxic_flag=0 AND is_buzzer=0 ORDER BY like_count DESC LIMIT 5").all() as any[];
       const topNegative = db.query("SELECT * FROM comments WHERE sentiment_label='NEGATIVE' AND spam_flag=0 AND toxic_flag=0 AND is_buzzer=0 ORDER BY like_count DESC LIMIT 5").all() as any[];
       
       const buzzerRings = db.query(`
         SELECT buzzer_group_id, COUNT(*) as buzz_count, raw_text 
         FROM comments 
         WHERE buzzer_group_id != '' 
         GROUP BY buzzer_group_id 
         ORDER BY buzz_count DESC 
         LIMIT 5
       `).all() as any[];

       const timeSeries = db.query(`
         SELECT 
           substr(published_at, 1, 10) as date,
           SUM(CASE WHEN sentiment_label='POSITIVE' THEN 1 ELSE 0 END) as pos,
           SUM(CASE WHEN sentiment_label='NEGATIVE' THEN 1 ELSE 0 END) as neg
         FROM comments
         WHERE published_at IS NOT NULL
         GROUP BY date
         ORDER BY date ASC
       `).all() as any[];
       const xDates = timeSeries.map(r => `"${r.date}"`).join(", ");
       const posCounts = timeSeries.map(r => r.pos).join(", ");
       const negCounts = timeSeries.map(r => r.neg).join(", ");

       // Generate Word Cloud
       const allTexts = db.query("SELECT normalized_text FROM comments WHERE spam_flag=0 AND toxic_flag=0 AND is_buzzer=0").all() as {normalized_text: string}[];
       const stopwords = new Set(["dan", "yang", "di", "ke", "dari", "ini", "itu", "untuk", "dengan", "dalam", "pada", "adalah", "ada", "tidak", "akan", "juga", "sebagai", "oleh", "karena", "seperti", "kita", "bisa", "sudah", "saya", "kamu", "dia", "mereka", "atau", "apa", "saat", "jika", "lagi", "terus", "buat", "sama", "kok", "sih", "nya", "yg", "the", "and", "to", "of", "a", "in", "is", "that", "it", "for", "on", "with", "di", "aja", "udah", "ya", "gak", "ga", "kalo", "aku", "pun", "nah", "sih", "kok", "itu"]);
       const wordCounts: Record<string, number> = {};
       for (const row of allTexts) {
         const words = (row.normalized_text || "").split(/\s+/);
         for (const w of words) {
           const cleanW = w.toLowerCase().replace(/[^a-z0-9]/g, '');
           if (cleanW.length > 2 && !stopwords.has(cleanW)) {
             wordCounts[cleanW] = (wordCounts[cleanW] || 0) + 1;
           }
         }
       }
       const sortedWords = Object.entries(wordCounts).sort((a,b) => b[1] - a[1]).slice(0, 50);
       const wordCloudText = sortedWords.map(w => w[0]).join(" ");
       
       let wordcloudPath = "";
       if (wordCloudText.length > 0) {
         try {
           console.log("Generating Word Cloud...");
           const wcRes = await fetch("https://quickchart.io/wordcloud", {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify({
               format: "png",
               width: 800,
               height: 400,
               text: wordCloudText,
               colors: ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd"]
             })
           });
           if (wcRes.ok) {
             const wcBuf = await wcRes.arrayBuffer();
             wordcloudPath = `./wordcloud_${VIDEO_ID}.png`;
             writeFileSync(wordcloudPath, Buffer.from(wcBuf));
           }
         } catch(e) {
           console.error("Failed to generate wordcloud:", e);
         }
       }



       // Fetch Video Details
       let videoTitle = "Unknown Title";
       let channelName = "Unknown Channel";
       let viewCount = "0";
       let likeCount = "0";
       let commentCount = "0";
       
       try {
         const vRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${VIDEO_ID}&key=${API_KEY}`);
         if (vRes.ok) {
           const vData = await vRes.json();
           if (vData.items && vData.items.length > 0) {
             const vInfo = vData.items[0];
             videoTitle = vInfo.snippet.title;
             channelName = vInfo.snippet.channelTitle;
             viewCount = parseInt(vInfo.statistics.viewCount || "0").toLocaleString();
             likeCount = parseInt(vInfo.statistics.likeCount || "0").toLocaleString();
             commentCount = parseInt(vInfo.statistics.commentCount || "0").toLocaleString();
           }
         }
       } catch(e) {
         console.error("Failed to fetch video details:", e);
       }

       const markdownLines = generateMarkdownReport({
           VIDEO_ID, MODEL_VERSION, videoTitle, channelName, viewCount, likeCount, commentCount,
           positive, negative, neutral, mixed, xDates, posCounts, negCounts, wordcloudPath,
           totalCount, spam, toxic, buzzer, topPositive, topNegative, buzzerRings
         });

       const mdPath = `./comments_${VIDEO_ID}.md`;
       const csvPath = `./comments_${VIDEO_ID}.csv`;
       const cleanCsvPath = `./comments_${VIDEO_ID}_clean.csv`;
       
       writeFileSync(mdPath, markdownLines.join("\n"), "utf-8");
       
       const allRows = db.query("SELECT * FROM comments").all() as any[];
       const csvLines = ["comment_id,author,sentiment_label,is_spam,is_toxic,is_buzzer,buzzer_group_id,raw_text"];
       for (const r of allRows) {
         const escapedText = r.raw_text.replace(/"/g, '""');
         csvLines.push(`"${r.comment_id}","${r.author}","${r.sentiment_label}",${r.spam_flag},${r.toxic_flag},${r.is_buzzer},"${r.buzzer_group_id}","${escapedText}"`);
       }
       writeFileSync(csvPath, csvLines.join("\n"), "utf-8");

       const cleanRows = db.query("SELECT * FROM comments WHERE spam_flag=0 AND toxic_flag=0 AND is_buzzer=0").all() as any[];
       const cleanCsvLines = ["comment_id,author,sentiment_label,raw_text"];
       for (const r of cleanRows) {
         const escapedText = r.raw_text.replace(/"/g, '""');
         cleanCsvLines.push(`"${r.comment_id}","${r.author}","${r.sentiment_label}","${escapedText}"`);
       }
       writeFileSync(cleanCsvPath, cleanCsvLines.join("\n"), "utf-8");

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
       console.log(`Clean data exported to: ${cleanCsvPath}`);
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
