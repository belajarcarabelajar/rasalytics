import { expect, test } from "bun:test";
import worker from "./worker.js";

test("POST /api/analyze-video with invalid body returns 400 error", async () => {
  const request = new Request("https://rasalytics.pages.dev/api/analyze-video", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ videoId: "" }) // invalid, empty
  });

  const env = { YOUTUBE_API_KEY: "dummy" };
  const ctx = {};

  const response = await worker.fetch(request, env, ctx);
  expect(response.status).toBe(400);
  
  const data = await response.json();
  expect(data.error).toContain("Missing videoId");
});
