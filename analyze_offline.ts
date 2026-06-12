import { readFileSync } from "fs";

// Mock fetch to instantly reject any requests to Ollama
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (typeof url === "string" && url.includes("127.0.0.1:11434")) {
    return Promise.reject(new Error("Ollama skipped for offline analysis"));
  }
  return originalFetch(url, options);
};

// Use dynamic import so fetch is mocked BEFORE index.ts is loaded
async function run() {
  const { processComment } = await import("./src/index");
  
  console.log("Loading comments...");
  const jsonString = readFileSync("Presiden Prabowo Bertolak ke Lampung dalam Rangka Kunjungan Kerja, 10 Juni 2026 [-2gsJ0uXQqo].info.json", "utf-8");
  const data = JSON.parse(jsonString);
  const comments = data.comments || [];
  
  let positive = 0, negative = 0, neutral = 0, mixed = 0, spam = 0, toxic = 0;
  
  const total = comments.length;
  console.log(`Starting analysis of ${total} comments...`);

  let count = 0;
  for (const c of comments) {
    const snippet = {
      textOriginal: c.text,
      authorDisplayName: c.author,
      likeCount: c.like_count,
      publishedAt: c.timestamp ? new Date(c.timestamp * 1000).toISOString() : ""
    };
    
    // Process comment
    const result = await processComment(c.id, snippet);
    
    if (result.spam_flag) spam++;
    else if (result.toxic_flag) toxic++;
    else if (result.sentiment_label === "POSITIVE") positive++;
    else if (result.sentiment_label === "NEGATIVE") negative++;
    else if (result.sentiment_label === "NEUTRAL") neutral++;
    else if (result.sentiment_label === "MIXED") mixed++;

    count++;
    if (count % 20 === 0) {
      console.log(`Processed ${count}/${total} comments...`);
    }
  }
  
  console.log(`\n=== SENTIMENT RECAP ===`);
  console.log(`Total Comments: ${total}`);
  console.log(`Positive: ${positive}`);
  console.log(`Negative: ${negative}`);
  console.log(`Neutral: ${neutral}`);
  console.log(`Mixed: ${mixed}`);
  console.log(`Spam: ${spam}`);
  console.log(`Toxic: ${toxic}`);
  console.log(`=======================`);
}

run();
