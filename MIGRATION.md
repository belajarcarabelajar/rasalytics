# Monorepo Restructuring Migration Mapping

This document provides a mapping of all source files and directories to their new target locations as part of the transition of `rasalytics` into a Bun workspace monorepo.

| Source Path | Target Path | Description |
|---|---|---|
| `src/index.ts` | `packages/sentiment-core/src/index.ts` | Main sentiment core entry |
| `src/shared-sentiment.ts` | `packages/sentiment-core/src/shared-sentiment.ts` | Shared sentiment engine utilities |
| `src/lexicons.ts` | `packages/sentiment-core/src/lexicons.ts` | Sentiment dictionary lexicons |
| `src/forensics.ts` | `packages/sentiment-core/src/forensics.ts` | Shingle & forensics comparisons |
| `src/index.test.ts` | `packages/sentiment-core/src/index.test.ts` | Core index tests |
| `src/eval.test.ts` | `packages/sentiment-core/src/eval.test.ts` | F1 benchmark evaluation tests |
| `src/eval-holdout.test.ts` | `packages/sentiment-core/src/eval-holdout.test.ts` | Holdout set evaluation tests |
| `src/export.test.ts` | `packages/sentiment-core/src/export.test.ts` | Export helper tests |
| `src/forensics.test.ts` | `packages/sentiment-core/src/forensics.test.ts` | Forensics logic tests |
| `src/regression.test.ts` | `packages/sentiment-core/src/regression.test.ts` | Sentiment regression tests |
| `src/worker.ts` | `apps/worker/worker.ts` | Worker app API entry |
| `src/worker.test.ts` | `apps/worker/worker.test.ts` | Worker test suite |
| `wrangler.toml` | `apps/worker/wrangler.toml` | Wrangler deployment configuration |
| `src/cli.ts` | `apps/cli/src/cli.ts` | Command-line interface entry |
| `public/` | `apps/web/public/` | Static website frontend files |
| `scripts/add_css.js` | `apps/web/add_css.js` | Web styling helper script |
| `scripts/refactor_css.js` | `apps/web/refactor_css.js` | CSS design token refactor script |
| `scripts/seo-lint.js` | `apps/web/seo-lint.js` | SEO tags validator script |
| `scripts/deploy-website.sh` | `apps/web/deploy-website.sh` | Cloudflare Workers & Pages deploy script |
| `.markuplintrc` | `apps/web/.markuplintrc` | HTML markup linter config |
| `local_models/indonesian-roberta/` | `models/indonesian-roberta/` | Local transformer model binaries |
| `scripts/setup-skills.ts` | `tools/scripts/setup-skills.ts` | AI agent skills initializer |
| `scripts/update_package.js` | `tools/scripts/update_package.js` | Package.json editor script |
| `analyze_offline.ts` | `tools/scripts/analyze_offline.ts` | Offline comment thread parser |
| `evaluate_baseline.ts` | `tools/scripts/evaluate_baseline.ts` | Baseline metrics validator |
| `fix_benchmark.ts` | `tools/scripts/fix_benchmark.ts` | Benchmark test modifier |
| `preload_mock_sharp.ts` | `tools/scripts/preload_mock_sharp.ts` | Sharp library mock wrapper |
| `test-api.ts` | `tools/scripts/test-api.ts` | Video API mock validator |
| `test-api2.ts` | `tools/scripts/test-api2.ts` | Video API mock validator |
| `test-api3.ts` | `tools/scripts/test-api3.ts` | Video API mock validator |
| `test-worker.ts` | `tools/scripts/test-worker.ts` | Offline worker local runner |
| `test_distribution.js` | `tools/scripts/test_distribution.js` | Expected label balance analyzer |
| `test_svg.js` | `tools/scripts/test_svg.js` | Visualizer svg generator |
| `comments_5bKxkW_z408.csv` | `data/fixtures/comments_5bKxkW_z408.csv` | Comment dataset (CSV) |
| `comments_5bKxkW_z408_clean.csv` | `data/fixtures/comments_5bKxkW_z408_clean.csv` | Preprocessed comments (CSV) |
| `benchmark.json` | `data/fixtures/benchmark.json` | Manual ground-truth validation set |
| `disagreements.json` | `data/fixtures/disagreements.json` | Baseline prediction disagreements |
| `held_out_test.json` | `data/fixtures/held_out_test.json` | Holdout evaluation dataset |
| `comments_5bKxkW_z408.md` | `data/samples/comments_5bKxkW_z408.md` | Labeled sample comments output |
| `Presiden Prabowo Bertolak ... .info.json` | `data/samples/Presiden Prabowo Bertolak ... .info.json` | Sample video metadata and threads |
| `test_chart.html` | `.artifacts/test_chart.html` | Generated test chart page |
| `test_chart.png` | `.artifacts/test_chart.png` | Generated test chart chart |
| `test_cloud.png` | `.artifacts/test_cloud.png` | Generated test cloud image |
| `test_image.png` | `.artifacts/test_image.png` | Generated test image |
| `test.html` | `.artifacts/test.html` | Local tester page |
| `wordcloud_5bKxkW_z408.png` | `.artifacts/wordcloud_5bKxkW_z408.png` | Generated wordcloud layout |
| `demo_summary.jpg` | `.artifacts/demo_summary.jpg` | Visualizer demo summary |
| `dirtree-report.md` | `.artifacts/dirtree-report.md` | Previous directory tree report |
| `TECHNICAL_DEBT_AUDIT.md` | `docs/audits/TECHNICAL_DEBT_AUDIT.md` | Tech debt review report |
| `audit-reports/` | `docs/audits/audit-reports/` | Historical benchmark metrics reviews |
