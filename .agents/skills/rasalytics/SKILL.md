---
name: rasalytics
description: Use when fetching or exporting YouTube comments in this repository through YouTube Data API v3, including video IDs, top-level threads, replies, pagination, retry behavior, quota errors, disabled comments, API key safety, and Bun CLI execution.
---

# Rasalytics Scraper

## Core Rule

Use the official YouTube Data API v3. Do not scrape YouTube HTML and do not use
browser automation.

## Workflow

1. Inspect `src/index.ts`, the API reference under `docs/`, and relevant tests.
2. Confirm `.env` supplies `YOUTUBE_API_KEY` without printing its value.
3. Use `commentThreads.list` for top-level comments and `comments.list` with
   `parentId` for replies.
4. Preserve `maxResults=100`, `textFormat=plainText`, pagination tokens, and
   configured page bounds unless the task explicitly changes them.
5. Retry only recoverable network and server failures. Surface client errors,
   disabled comments, and exhausted quota without an infinite loop.
6. Pass each API snippet into `processComment` and preserve the exported
   `CommentData` fields.
7. Generate comprehensive Markdown reports including Video Metadata, Mermaid `xychart-beta` for Sentiment Over Time, QuickChart API for Word Clouds, and Buzzer Forensics.
8. Export both raw and clean CSV datasets (excluding spam, toxic, and buzzer comments).
9. Run focused tests and then `bun test`.

## Constraints

- Use Bun commands only: `bun install`, `bun run`, and `bun test`.
- Keep API credentials in `.env`; never hardcode or log them.
- Keep collection bounded to avoid accidental quota exhaustion.
- Do not add OAuth, cloud deployment, Docker, databases, or browser scraping
  unless the user explicitly changes project scope.

## Sentiment Delegation

**REQUIRED SUB-SKILL:** Use `$rasalytics-sentiment` for any change to
preprocessing, language detection, transformer or lexicon models, confidence,
label taxonomy, spam or toxicity classification, Ollama verification, benchmark
behavior, or sentiment output fields.

Do not replace the current hybrid pipeline with lexicon-only analysis merely
because older project documents describe that earlier architecture.
