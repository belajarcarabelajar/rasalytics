---
name: youtube-comments-scraper
description: Use when Antigravity needs to fetch, analyze, debug, or export YouTube comments in this repository with Bun, YouTube Data API v3, local transformer sentiment models, Indonesian preprocessing, spam or toxicity labels, and optional Ollama verification.
---

# YouTube Comments Scraper

## Configuration Boundary

This is the Antigravity workspace skill. Keep Antigravity instructions under
`.gemini/skills/`.

Codex uses `.agents/skills/`. Do not replace, move, or synchronize either skill
root by overwriting the other.

## Workflow

1. Inspect `src/index.ts`, `src/lexicons.ts`, `src/index.test.ts`, and
   `benchmark.json` before changing behavior.
2. Use Bun commands only.
3. Fetch comments through YouTube Data API v3, never HTML scraping or browser
   automation.
4. Keep `YOUTUBE_API_KEY` in `.env` and never print its value.
5. Preserve pagination limits, reply fetching, and recoverable-error retry
   behavior.
6. Run each comment through the local hybrid analysis pipeline.
7. Add a focused `bun:test` regression before changing classification.
8. Run `bun test` before reporting completion.

## Hybrid Sentiment Pipeline

- Normalize English and Indonesian text, URLs, mentions, emoji, repeated
  characters, negations, and slang.
- Apply terminal labels in the current order: `TOXIC`, then `SPAM`.
- Route detected English text to
  `Xenova/distilbert-base-uncased-finetuned-sst-2-english`.
- Route other detected languages to
  `Xenova/bert-base-multilingual-uncased-sentiment`.
- Use the local Indonesian lexicon only as a low-confidence fallback.
- Produce `MIXED` when separate chunks contain both positive and negative
  sentiment.
- Treat local Ollama `qwen2.5:1.5b` as optional verification. If unavailable or
  invalid, retain the transformer result and continue processing.

Keep inference local. Do not introduce hosted sentiment APIs.

## Output Contract

Preserve:

- raw and normalized text
- sentiment score, label, and confidence
- spam and toxicity flags
- reasoning summary
- model version and processing timestamp

Write reports to repository-relative or user-requested paths. Do not hardcode a
specific user's home directory or Windows Downloads path.

## Evaluation

Use `src/index.test.ts` and `benchmark.json` as current evidence. Do not claim
accuracy improvements from a few examples or from stale documentation. Report
the fresh macro-F1 result produced by:

```bash
bun test
```
