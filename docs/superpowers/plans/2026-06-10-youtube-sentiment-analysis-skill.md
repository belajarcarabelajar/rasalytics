# YouTube Sentiment Analysis Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a current Codex skill for the repository's hybrid YouTube comment sentiment pipeline and narrow the existing scraper skill to YouTube Data API responsibilities.

**Architecture:** Keep both skills repo-scoped under `.agents/skills`. The scraper skill owns collection and delegates classification work; the sentiment skill owns preprocessing, local inference, taxonomy, optional Ollama verification, output fields, and benchmark discipline. Detailed implementation evidence lives in one progressive-disclosure reference.

**Tech Stack:** Codex Agent Skills, Markdown, YAML, Bun, TypeScript

---

### Task 1: Capture Baseline Skill Behavior

**Files:**
- Inspect: `.agents/skills/youtube-comments-scraper/SKILL.md`
- Inspect: `src/index.ts`

- [x] **Step 1: Run a content contract without the new sentiment skill**

Check that the sentiment skill exists, the scraper delegates sentiment work, and
the stale lexicon-only mandate is absent. Observe this contract fail before
implementation.

- [x] **Step 2: Record baseline gaps**

Confirm that the old skill repeats the stale lexicon-only instruction, misses
delegation to the current transformer pipeline, and lacks the dedicated
sentiment skill. Use these gaps to constrain the new skill.

### Task 2: Create the Sentiment Skill

**Files:**
- Create: `.agents/skills/youtube-sentiment-analysis/SKILL.md`
- Create: `.agents/skills/youtube-sentiment-analysis/agents/openai.yaml`
- Create: `.agents/skills/youtube-sentiment-analysis/references/pipeline.md`

- [x] **Step 1: Initialize the skill with the official creator**

Run:

```bash
python3 /home/belajarcarabelajar/.codex/skills/.system/skill-creator/scripts/init_skill.py \
  youtube-sentiment-analysis \
  --path .agents/skills \
  --resources references \
  --interface 'display_name=YouTube Sentiment Analysis' \
  --interface 'short_description=Maintain local YouTube sentiment classification' \
  --interface 'default_prompt=Use $youtube-sentiment-analysis to inspect or improve this repository sentiment pipeline.'
```

Expected: the skill folder, `SKILL.md`, `agents/openai.yaml`, and
`references/` are created.

- [x] **Step 2: Replace the template with concise workflow instructions**

Write frontmatter:

```yaml
---
name: youtube-sentiment-analysis
description: Use when analyzing, debugging, evaluating, or changing sentiment classification for YouTube comments in this repository, including Indonesian or English preprocessing, transformer inference, lexicon fallback, spam or toxicity labels, mixed sentiment, Ollama verification, confidence, and benchmark accuracy.
---
```

The body must require:

- reading current code before changing behavior
- Bun-only commands and local inference
- tests before implementation changes
- optional, fail-open Ollama verification
- benchmark evidence before accuracy claims
- loading `references/pipeline.md` for taxonomy or data-flow changes

- [x] **Step 3: Add the implementation reference**

Document the current evidence paths, processing order, models, label taxonomy,
output fields, test commands, benchmark threshold, and known documentation
drift. Avoid claiming that cached model folder names match runtime model IDs.

### Task 3: Narrow the Scraper Skill

**Files:**
- Modify: `.agents/skills/youtube-comments-scraper/SKILL.md`
- Create: `.agents/skills/youtube-comments-scraper/agents/openai.yaml`

- [x] **Step 1: Replace the overlapping description and body**

Make the description trigger on fetching, pagination, replies, retries, quota,
disabled comments, API key safety, and CLI execution. Remove lexicon-only
sentiment instructions.

- [x] **Step 2: Add explicit delegation**

Require `$youtube-sentiment-analysis` whenever a task changes classification,
preprocessing, labels, models, confidence, Ollama, benchmark behavior, or
sentiment output fields.

- [x] **Step 3: Generate matching UI metadata**

Run:

```bash
python3 /home/belajarcarabelajar/.codex/skills/.system/skill-creator/scripts/generate_openai_yaml.py \
  .agents/skills/youtube-comments-scraper \
  --interface 'display_name=YouTube Comments Scraper' \
  --interface 'short_description=Fetch YouTube comments with the official API' \
  --interface 'default_prompt=Use $youtube-comments-scraper to fetch YouTube comments safely with the official Data API.'
```

Expected: `agents/openai.yaml` matches the narrowed skill.

### Task 4: Validate and Review

**Files:**
- Validate: `.agents/skills/youtube-sentiment-analysis/`
- Validate: `.agents/skills/youtube-comments-scraper/`
- Test: `src/index.test.ts`

- [x] **Step 1: Run structural validation**

```bash
python3 /home/belajarcarabelajar/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/youtube-sentiment-analysis
python3 /home/belajarcarabelajar/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/youtube-comments-scraper
```

Expected: both commands report valid skills.

- [x] **Step 2: Run the forward behavior contract**

Check that the new skill and reference identify transformer inference,
TOXIC-before-SPAM precedence, optional Ollama fallback, 100 benchmark examples,
the current macro-F1 threshold, and explicit scraper delegation.

- [x] **Step 3: Run repository tests**

```bash
bun test
```

Expected: all tests pass, including the macro-F1 assertion.

- [x] **Step 4: Review scope and stale guidance**

```bash
rg -n "lexicon-based JavaScript library|youtube-sentiment-analysis|allow_implicit_invocation" .agents/skills
git diff --check
git diff -- .agents/skills docs/superpowers
```

Expected: no stale lexicon-only mandate remains in the scraper skill; delegation,
metadata, design, and plan are present with no whitespace errors.
