      );
    } else {
      db.query(`DELETE FROM metadata WHERE key = 'last_page_token'`).run();
      break;
    }
    pageCount++;
    console.log(`Processed page ${pageCount} ...`);
  }
}

async function exportOutputs(videoId: string, db: Database) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    throw new Error("Invalid videoId");
  }
  const totalCount = (db.query("SELECT COUNT(*) as count FROM comments").get() as any).count;
  if (totalCount === 0) return;

  const positive = (
    db.query("SELECT COUNT(*) as c FROM comments WHERE sentiment_label='POSITIVE'").get() as any
  ).c;
  const negative = (
    db.query("SELECT COUNT(*) as c FROM comments WHERE sentiment_label='NEGATIVE'").get() as any
  ).c;
  const neutral = (
    db.query("SELECT COUNT(*) as c FROM comments WHERE sentiment_label='NEUTRAL'").get() as any
  ).c;
  const mixed = (
    db.query("SELECT COUNT(*) as c FROM comments WHERE sentiment_label='MIXED'").get() as any
  ).c;
  const spam = (db.query("SELECT COUNT(*) as c FROM comments WHERE spam_flag=1").get() as any).c;
  const toxic = (db.query("SELECT COUNT(*) as c FROM comments WHERE toxic_flag=1").get() as any).c;
  const buzzer = (db.query("SELECT COUNT(*) as c FROM comments WHERE is_buzzer=1").get() as any).c;

  const topPositive = db
    .query(
      "SELECT * FROM comments WHERE sentiment_label='POSITIVE' AND spam_flag=0 AND toxic_flag=0 AND is_buzzer=0 ORDER BY like_count DESC LIMIT 5",
    )
    .all() as any[];
  const topNegative = db
    .query(
      "SELECT * FROM comments WHERE sentiment_label='NEGATIVE' AND spam_flag=0 AND toxic_flag=0 AND is_buzzer=0 ORDER BY like_count DESC LIMIT 5",
    )
    .all() as any[];

  const buzzerRings = db
    .query(
      `
    SELECT buzzer_group_id, COUNT(*) as buzz_count, raw_text
    FROM comments
    WHERE buzzer_group_id != ''
    GROUP BY buzzer_group_id
    ORDER BY buzz_count DESC
    LIMIT 5
  `,
    )
    .all() as any[];

  const timeSeries = db
    .query(
      `
    SELECT
      substr(published_at, 1, 10) as date,
      SUM(CASE WHEN sentiment_label='POSITIVE' THEN 1 ELSE 0 END) as pos,
      SUM(CASE WHEN sentiment_label='NEGATIVE' THEN 1 ELSE 0 END) as neg
    FROM comments
    WHERE published_at IS NOT NULL
    GROUP BY date
    ORDER BY date ASC
  `,
    )
    .all() as any[];
  const xDates = timeSeries.map((r) => `"${r.date}"`).join(", ");
  const posCounts = timeSeries.map((r) => r.pos).join(", ");
  const negCounts = timeSeries.map((r) => r.neg).join(", ");

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
      const vData = (await vRes.json()) as any;
      if (vData.items && vData.items.length > 0) {
        const vInfo = vData.items[0];
        videoTitle = vInfo.snippet.title;
        channelName = vInfo.snippet.channelTitle;
        viewCount = parseInt(vInfo.statistics.viewCount || "0").toLocaleString();
        likeCount = parseInt(vInfo.statistics.likeCount || "0").toLocaleString();
        commentCount = parseInt(vInfo.statistics.commentCount || "0").toLocaleString();
      }
    }
  } catch (e) {
    console.error("Failed to fetch video details:", e);
  }

  const markdownLines = generateMarkdownReport({
    VIDEO_ID: videoId,
    MODEL_VERSION: "v8.0-roberta-hybrid",
    videoTitle,
    channelName,
    viewCount,
    likeCount,
    commentCount,
