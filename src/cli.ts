import { parseArgs } from "util";
import { writeFileSync, existsSync, unlinkSync } from "fs";
import { Database } from "bun:sqlite";
import { fetchCommentThreads, fetchReplies, processComment, generateMarkdownReport, CommentData } from "./index.js";
import { getShingles, jaccard } from "./forensics.js";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    videoId: { type: "string" },
    maxPages: { type: "string", default: "5" },
  },
});

const API_KEY = process.env.YOUTUBE_API_KEY;
const MAX_REPLY_PAGES = 5;

// Initialize Database
function setupDatabase(dbPath: string): Database {
  const db = new Database(dbPath);
  db.run(`CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS comments (
    comment_id TEXT PRIMARY KEY, author TEXT, raw_text TEXT, normalized_text TEXT,
    like_count INTEGER, published_at TEXT, sentiment_score INTEGER, confidence_score INTEGER,
    sentiment_label TEXT, spam_flag INTEGER, toxic_flag INTEGER, reasoning_summary TEXT,
    model_version TEXT, processed_at TEXT, is_buzzer INTEGER, buzzer_group_id TEXT
  )`);
  return db;
}

// Fetch Comments from API
async function collectComments(videoId: string, maxPages: number, db: Database) {
  let pageToken: string | undefined = undefined;
  const tokenRes = db.query("SELECT value FROM metadata WHERE key = 'last_page_token'").get() as any;
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

  while (pageCount < maxPages) {
    const data = await fetchCommentThreads(videoId, API_KEY!, pageToken);
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
}

async function exportOutputs(videoId: string, db: Database) {
  const totalCount = (db.query("SELECT COUNT(*) as count FROM comments").get() as any).count;
  if (totalCount === 0) return;

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

  let wordcloudPath = "";
  let videoTitle = "Unknown Title";
  let channelName = "Unknown Channel";
  let viewCount = "0";
  let likeCount = "0";
  let commentCount = "0";

  try {
    const vUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    vUrl.searchParams.append("part", "snippet,statistics");
    vUrl.searchParams.append("id", videoId);
    vUrl.searchParams.append("key", API_KEY!);
    const vRes = await fetch(vUrl.toString());
    if (vRes.ok) {
      const vData = await vRes.json() as any;
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
      VIDEO_ID: videoId, MODEL_VERSION: "v8.0-roberta-hybrid", videoTitle, channelName, viewCount, likeCount, commentCount,
      positive, negative, neutral, mixed, xDates, posCounts, negCounts, wordcloudPath,
      totalCount, spam, toxic, buzzer, topPositive, topNegative, buzzerRings
    });

  const mdPath = `./comments_${videoId}.md`;
  const csvPath = `./comments_${videoId}.csv`;
  const cleanCsvPath = `./comments_${videoId}_clean.csv`;

  function sanitizeCsvField(text: string): string {
    let escaped = (text || "").replace(/"/g, '""');
    if (/^[=\+\-@]/.test(escaped)) {
      escaped = "'" + escaped;
    }
    return escaped;
  }

  writeFileSync(mdPath, markdownLines.join("\n"), "utf-8");

  const allRows = db.query("SELECT * FROM comments").all() as any[];
  const csvLines = ["comment_id,author,sentiment_label,is_spam,is_toxic,is_buzzer,buzzer_group_id,raw_text"];
  for (const r of allRows) {
    const escapedText = sanitizeCsvField(r.raw_text);
    const escapedAuthor = sanitizeCsvField(r.author);
    csvLines.push(`"${r.comment_id}","${escapedAuthor}","${r.sentiment_label}",${r.spam_flag},${r.toxic_flag},${r.is_buzzer},"${r.buzzer_group_id}","${escapedText}"`);
  }
  writeFileSync(csvPath, csvLines.join("\n"), "utf-8");

  const cleanRows = db.query("SELECT * FROM comments WHERE spam_flag=0 AND toxic_flag=0 AND is_buzzer=0").all() as any[];
  const cleanCsvLines = ["comment_id,author,sentiment_label,raw_text"];
  for (const r of cleanRows) {
    const escapedText = sanitizeCsvField(r.raw_text);
    const escapedAuthor = sanitizeCsvField(r.author);
    cleanCsvLines.push(`"${r.comment_id}","${escapedAuthor}","${r.sentiment_label}","${escapedText}"`);
  }
  writeFileSync(cleanCsvPath, cleanCsvLines.join("\n"), "utf-8");

  console.log(`\n=== SENTIMENT RECAP ===`);
  console.log(`Total Comments: ${totalCount}`);
  console.log(`Positive: ${positive}`);
  console.log(`Negative: ${negative}`);
  console.log(`Neutral: ${neutral}`);
  console.log(`Mixed: ${mixed}`);
  console.log(`Spam: ${spam}`);
  console.log(`Toxic: ${toxic}`);
  console.log(`Buzzer: ${buzzer}`);
  console.log(`=======================`);
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
  const db = setupDatabase(dbPath);

  try {
    await collectComments(VIDEO_ID, MAX_PAGES, db);
  } catch (err: any) {
    console.error(`\nExecution stopped: ${err.message}`);
    console.error(`Data is safely stored in ${dbPath}. Run again to resume.`);
  }

  try {
    await exportOutputs(VIDEO_ID, db);
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
