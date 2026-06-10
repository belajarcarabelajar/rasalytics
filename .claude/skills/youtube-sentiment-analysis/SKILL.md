---
name: youtube-sentiment-analysis
description: Use when analyzing, debugging, evaluating, or changing sentiment classification for YouTube comments in this repository, including Indonesian or English preprocessing, transformer inference, lexicon fallback, spam or toxicity labels, mixed sentiment, Ollama verification, confidence, and benchmark accuracy.
---

# YouTube Sentiment Analysis

## Configuration Boundary

This is the Claude Code project skill. Keep Claude Code instructions under
`.claude/skills/`.

Antigravity uses `.gemini/skills/` and Codex uses `.agents/skills/`. Never move,
replace, or synchronize one platform's skill root by overwriting another.

## Core Rule

Trace the current implementation before changing classification behavior. Treat
`src/index.ts`, `src/lexicons.ts`, `src/index.test.ts`, and `benchmark.json` as
evidence; older PRD and audit text may describe superseded behavior.

## Workflow

1. Read `analyzeComment`, `processComment`, and the relevant tests.
2. Read [references/pipeline.md](references/pipeline.md) before changing models,
   preprocessing, label precedence, confidence, output fields, or evaluation.
3. Define the expected classification with a failing `bun:test` case.
4. Make the smallest change that preserves unrelated labels and local fallback
   behavior.
5. Run the focused test, then run `bun test`.
6. Report benchmark results separately from anecdotal examples. Never claim an
   accuracy improvement without fresh evaluation evidence.

## Constraints

- Use Bun and TypeScript. Do not introduce npm, yarn, pnpm, Docker, or a hosted
  sentiment API.
- Keep inference local. Transformer model downloads may use the configured
  Hugging Face path, but comment text must not be sent to hosted inference.
- Preserve raw text separately from normalized text.
- Preserve terminal-label precedence unless the task changes the taxonomy:
  `TOXIC` before `SPAM`, then sentiment labels.
- Treat Ollama as optional verification. Connection failure or invalid output
  must keep the ML label and must not fail comment processing.
- Never expose `YOUTUBE_API_KEY`, environment contents, or private comment data
  in logs or fixtures.

## Testing

Run:

```bash
bun test src/index.test.ts
bun test
```

Add focused regression cases for preprocessing, precedence, mixed text,
low-confidence fallback, or Ollama correction as applicable. Keep benchmark
expectations aligned with `src/index.test.ts`, not stale prose.

For YouTube API fetching, pagination, replies, quota, or disabled-comment
handling, use `/youtube-comments-scraper`.
