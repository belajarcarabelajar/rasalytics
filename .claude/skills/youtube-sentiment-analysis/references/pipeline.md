# Current Sentiment Pipeline

Use this reference with the implementation. If code and prose disagree, verify
tests and update this reference to match the intended code.

## Evidence Map

| Concern | Source |
|---|---|
| Preprocessing and analysis | `src/index.ts` |
| Indonesian lexicon, slang, toxicity | `src/lexicons.ts` |
| Regression and benchmark tests | `src/index.test.ts` |
| Labeled evaluation data | `benchmark.json` |
| Runtime dependencies | `package.json` |

`docs/PRD_YouTube_Comments_Sentiment_Analyzer.md` and
`docs/SENTIMENT_AUDIT_CHECKLIST.md` contain historical requirements and stale
unchecked items. Do not use them alone to determine current behavior.

## Processing Order

1. `preprocess(text)` lowercases text, records and removes URLs, strips mentions
   and hashtags, converts known emoji to names, joins Indonesian negations,
   reduces repeated characters, removes punctuation, and maps slang.
2. `analyzeComment(text)` detects spam and toxic terms.
3. Toxicity is terminal before spam. Empty normalized text becomes `NEUTRAL`.
4. `franc-min` selects the English or multilingual transformer path.
5. Text is split into non-trivial period-delimited chunks and classified.
6. Confidence is the mean transformer confidence, expressed as `0..100`.
7. Below 60% confidence, the local `sentiment` package plus `idLexicon` may
   adjust the aggregate direction.
8. Positive and negative chunks together produce `MIXED`; otherwise aggregate
   direction produces `POSITIVE`, `NEGATIVE`, or `NEUTRAL`.
9. `processComment` optionally asks local Ollama `qwen2.5:1.5b` to verify
   non-spam, non-toxic, non-empty comments. Failure or unrecognized output keeps
   the existing label.

The Ollama verifier only returns `POSITIVE`, `NEGATIVE`, or `NEUTRAL`. Changing
how it interacts with `MIXED` is a taxonomy change and requires a regression
test.

## Runtime Models

- English: `Xenova/distilbert-base-uncased-finetuned-sst-2-english`
- Other detected languages: `Xenova/bert-base-multilingual-uncased-sentiment`
- Low-confidence fallback: `sentiment` with `idLexicon`
- Optional verifier: local Ollama `qwen2.5:1.5b`

Classifiers are lazily initialized and reused. `env.localModelPath` points at
`./local_models`, while `env.allowRemoteModels` is enabled. Do not assume a
folder name under `local_models/` proves which runtime model ID is loaded.

## Labels and Scores

| Label | Score | Meaning |
|---|---:|---|
| `POSITIVE` | `1` | Positive aggregate |
| `NEGATIVE` | `-1` | Negative aggregate |
| `NEUTRAL` | `0` | Neutral or empty aggregate |
| `MIXED` | `0` | Both positive and negative chunks |
| `SPAM` | `0` | URL or spam-keyword match |
| `TOXIC` | `0` | Toxic lexicon match |

Current precedence is `TOXIC` over `SPAM`. Preserve it unless a requested
taxonomy change explicitly specifies another order.

## Output Contract

`processComment` returns:

- `comment_id`
- `author`
- `raw_text`
- `normalized_text`
- `like_count`
- `published_at`
- `sentiment_score`
- `confidence_score`
- `sentiment_label`
- `spam_flag`
- `toxic_flag`
- `reasoning_summary`
- `model_version`
- `processed_at`

Keep `raw_text` and `normalized_text` distinct. Update report generation and
tests when changing this contract.

## Evaluation

`benchmark.json` currently contains 100 labeled examples across `POSITIVE`,
`NEGATIVE`, `NEUTRAL`, `MIXED`, `SPAM`, and `TOXIC`.

Run:

```bash
bun test src/index.test.ts
```

The current automated assertion requires macro F1 greater than `0.50`. Do not
claim an 85% requirement or result unless the benchmark assertion and fresh
test output support it.

For behavior changes:

1. Add a focused regression test and observe the expected failure.
2. Implement the smallest classification change.
3. Run the focused test.
4. Run the full benchmark and test suite.
5. Report per-class regressions when aggregate macro F1 hides them.
