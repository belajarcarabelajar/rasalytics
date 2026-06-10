---
name: youtube-comments-scraper
description: Use when fetching, exporting, or debugging YouTube comments in this repository through YouTube Data API v3, including video IDs, top-level threads, replies, pagination, retries, quota errors, disabled comments, API key safety, and Bun CLI execution.
---

# YouTube Comments Scraper

## Configuration Boundary

This is the Claude Code project skill. Keep Claude Code instructions under
`.claude/skills/`.

Antigravity uses `.gemini/skills/` and Codex uses `.agents/skills/`. Never move,
replace, or synchronize one platform's skill root by overwriting another.

## Core Rule

Use the official YouTube Data API v3. Do not scrape YouTube HTML or use browser
automation.

## Workflow

1. Inspect `src/index.ts`, the API documentation under `docs/`, and relevant
   tests before changing collection behavior.
2. Confirm `.env` supplies `YOUTUBE_API_KEY` without printing its value.
3. Use `commentThreads.list` for top-level comments and `comments.list` with
   `parentId` for replies.
4. Preserve `maxResults=100`, `textFormat=plainText`, pagination tokens, and
   configured page bounds unless the task explicitly changes them.
5. Retry only recoverable network and server failures. Surface client errors,
   disabled comments, and exhausted quota without an infinite loop.
6. Pass every API snippet into `processComment` and preserve the exported
   `CommentData` fields.
7. Run focused tests, then run `bun test`.

## Constraints

- Use Bun commands only: `bun install`, `bun run`, and `bun test`.
- Keep API credentials in `.env`; never hardcode, print, or commit them.
- Keep collection bounded to avoid accidental quota exhaustion.
- Do not add OAuth, cloud deployment, Docker, databases, or browser scraping
  unless the user explicitly changes project scope.

## Sentiment Delegation

Use `/youtube-sentiment-analysis` for changes to preprocessing, language
detection, transformer or lexicon models, confidence, label taxonomy, spam or
toxicity classification, Ollama verification, benchmark behavior, or sentiment
output fields.

Do not replace the current hybrid pipeline with lexicon-only analysis because
older project documents may describe an earlier architecture.
