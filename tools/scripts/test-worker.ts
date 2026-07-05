import worker from "../../apps/worker/worker.ts";

const req = new Request("http://127.0.0.1:8787/api/analyze-video", {
  method: "POST",
  headers: {
    Origin: "http://localhost:3000",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ videoId: "dQw4w9WgXcQ", maxPages: 1 }),
});

const res = await worker.fetch(req, { YOUTUBE_API_KEY: "dummy" }, {});
console.log(res.status);
const text = await res.text();
console.log(text);
