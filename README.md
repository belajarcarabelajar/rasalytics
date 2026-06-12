# Rasalytics
A powerful YouTube comments scraper and hybrid sentiment analyzer specifically tuned for English and Indonesian languages.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Bun Version](https://img.shields.io/badge/Bun-v1.3.14-black?logo=bun)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Demo / Screenshot**
> ![Analysis Summary Demo](./demo_summary.jpg)

## Description
Analyzing YouTube comments manually can be overwhelming, especially for videos with thousands of interactions. This tool automates the extraction and analysis of YouTube comments, providing deep, actionable insights into audience sentiment. It combines a lexicon-based approach, localized HuggingFace transformer models (SST-2 for English, BERT for Indonesian), and local Ollama Qwen2.5 for accuracy verification. Built-in spam and toxicity filters ensure the resulting data is clean and highly relevant.

## 🌍 Philosophy, Mission, & Societal Impact

*“Technology without philosophy is just a tool; but technology driven by a profound mission is a catalyst for societal change.”*

While sentiment analysis is heavily utilized in the corporate world for brand monitoring and market research, **this repository is built upon a radically different philosophy: democratizing data for political transparency and social accountability.** 

In the modern digital era—where algorithms curate echo chambers and public opinion is easily manipulated—open-source analytical tools must step up to serve the broader society. Our mission focuses on the following pillars:

1. **Defending Digital Democracy & Transparency**
   Political discourse on platforms like YouTube is often obscured by algorithmic bias, making it difficult to gauge true public sentiment. This tool empowers citizens, independent journalists, and researchers to bypass "filter bubbles" and transparently audit how political campaigns, policies, or figures are actually being received by the public.
   
2. **Combatting Astroturfing & Organized Manipulation (Buzzers)**
   Political propaganda frequently relies on engineered toxicity and inorganic spam (e.g., coordinated *buzzer* attacks or bot farms) to drown out genuine debate. By integrating rigorous spam and toxicity detection, this tool aims to separate organic citizen feedback from paid manipulation, providing a clearer picture of authentic public discourse.

3. **Mitigating Societal Polarization**
   Echo chambers thrive on extreme sentiments. By openly mapping and quantifying the spectrum of opinions (Positive, Negative, Mixed, Neutral), we aim to provide objective data that cools down hyper-polarized debates. When society can see the *data-driven reality* of a discussion, it prevents the loudest, most toxic voices from dictating the political narrative.

Ultimately, this project is not just a technological achievement in machine learning; it is a **grassroots, open-source movement**. We aim to equip society with the same powerful analytical capabilities once reserved for massive tech conglomerates and political elites, ensuring that the digital public square remains accountable, transparent, and democratic.

## Features
- **Data Scraping**: Fetches top-level comments and replies using the official YouTube Data API v3.
- **Hybrid Sentiment Analysis**: Uses HuggingFace Transformers (SST-2 for English, BERT-multilingual for Indonesian), Lexicon-based fallbacks, and Ollama Qwen2.5 for accuracy verification.
- **Spam & Toxicity Detection**: Built-in detection for spam URLs/keywords and toxic vocabulary.
- **Rich Markdown Reports**: Generates a detailed report with actionable insights, summary metrics, and full data export to markdown.

## Tech Stack
- **Runtime**: [Bun](https://bun.sh) & TypeScript
- **Machine Learning**: `@xenova/transformers`, `sentiment` (Lexicon), Local Ollama (qwen2.5:1.5b)
- **Language Detection & Preprocessing**: `franc-min`, `emoji-emotion`

## Prerequisites
- **Bun**: v1.0 or higher.
- **Ollama**: Running locally with the `qwen2.5:1.5b` model (`ollama run qwen2.5:1.5b`).
- **YouTube Data API Key**: A valid API key from Google Cloud Console.

## Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/belajarcarabelajar/rasalytics.git
   cd rasalytics
   ```
2. Install dependencies:
   ```bash
   bun install
   ```

## Configuration
Create a `.env` file in the root directory and add your YouTube API Key. You can use the `.env.example` file as a template:
```env
YOUTUBE_API_KEY=YOUR_YOUTUBE_API_KEY_HERE
```
> **Warning**: Do not commit the `.env` file or any real API keys. It is already added to `.gitignore`. Users should create and configure their own YouTube API key via the Google Cloud Console.

## AI Agents / Skills Setup
If you are using AI coding assistants (like Cursor, Cline, Claude Code, or Antigravity), this repository contains a unified Single Source of Truth (SSOT) for agent skills. To automatically set up the rules and symlinks for your AI providers, run:

```bash
bun run setup:skills
```
This will automatically configure `.cursorrules`, `.clinerules`, and the necessary `.agents` and `.claude` directories.

## Cloudflare Website Deployment
The project includes a deployable website version using **Cloudflare Pages** (frontend) and **Cloudflare Workers** (backend API). 
**Note:** The Cloudflare API uses an *edge-safe* shared sentiment module that relies exclusively on deterministic lexicon-based and statistical checks (no heavy generative AI or Ollama dependencies) to ensure fast cold starts and security.

### Environment Setup
Update your `.env` (or set via `wrangler` and Cloudflare Dashboard):
- **Local:** `YOUTUBE_API_KEY` for CLI.
- **Worker (Backend):** No API keys required for the edge-safe sentiment API. 
- **Pages (Frontend):** Set public variables like `VITE_API_URL` if building a complex frontend framework. The current vanilla HTML setup connects to the API automatically.

### Manual Deployment Steps
1. Login to Cloudflare:
   ```bash
   bunx wrangler login
   ```
2. Run the deployment script:
   ```bash
   bun run deploy:website
   # or manually: bash scripts/deploy-website.sh
   ```
   
This script will:
- Validate `bun` and `wrangler` installation.
- Deploy the Worker API (`rasalytics-api`) to Cloudflare Workers.
- Deploy the static frontend to Cloudflare Pages (`rasalytics-web`).

### Security Notes & Limitations
- **ML-Only Limitation:** The Cloudflare Worker API does NOT use `@xenova/transformers` or `Ollama` generative AI due to edge limits and cold starts. It uses a lightweight, deterministic lexicon and rule-based approach.
- Do NOT commit real secrets to the repository. Use `wrangler secret put <NAME>` for backend secrets.
- `local_models/` and other offline artifacts are safely excluded from the website deployment.

## Usage
Run the script by providing a YouTube Video ID. You can also specify the maximum number of comment pages to fetch (default is 5).

```bash
bun run src/index.ts --videoId=5bKxkW_z408 --maxPages=2
```

### Example Output (Terminal)
```text
Starting comment collection for Video ID: 5bKxkW_z408...

=== SENTIMENT RECAP ===
Macro F1 requirement: Check test suite (rtk bun test)
Total Comments: 125
Positive: 80
Negative: 15
Neutral: 20
Mixed: 0
Spam: 8
Toxic: 2
=======================
Full markdown report saved to: /mnt/c/Users/Tedi Rahmat/Downloads/comments_5bKxkW_z408.md
```

## Project Structure
```text
rasalytics/
├── src/
│   ├── index.ts                 # Main scraper and analyzer CLI script
│   ├── index.test.ts            # Test suite for sentiment and scraping logic
│   ├── eval.test.ts             # Evaluation tests for sentiment accuracy
│   ├── lexicons.ts              # Indonesian slang, toxic, and positive/negative lexicons
│   ├── worker.ts                # Cloudflare Worker backend API
│   └── shared-sentiment.ts      # Edge-safe sentiment logic for the backend
├── scripts/
│   ├── deploy-website.sh        # Deployment script for Cloudflare Worker and Pages
│   └── setup-skills.ts          # Setup script for AI agents skills
├── public/                      # Static frontend assets for Cloudflare Pages
├── docs/                        # API, architecture, and Claude documentation
├── audit-reports/               # Production-readiness audit reports and findings
├── package.json                 # Dependencies and scripts
├── tsconfig.json                # TypeScript configuration
├── bun.lock                     # Bun lockfile
├── .env                         # Environment variables (API Key)
├── local_models/                # Cached transformer models
├── analyze_offline.ts           # Offline comment analysis tool
├── evaluate_baseline.ts         # Sentiment baseline evaluator
└── fix_benchmark.ts             # Benchmark data fixer
```

## Contributing
Contributions are welcome! Please open an issue or submit a Pull Request if you'd like to improve the sentiment accuracy, add support for more languages, or optimize the scraping process.

## API Reference / Internal Methods
While primarily a CLI tool, the core logic is structured to be modular. Key components inside `src/index.ts` such as sentiment analysis pipelines and markdown report generators can potentially be exported. 

### `preprocess(text: string)`
Cleans and normalizes the input text by stripping URLs, converting emojis to text labels, and handling repeating characters.
- **Returns**: `{ normalized: string, urls: string[] }`

### `analyzeComment(text: string)`
Performs hybrid sentiment analysis (Transformers, Lexicon, and Ollama verification) as well as spam and toxicity checks.
- **Returns**: `Promise<{ score: number, confidence: number, label: string, isSpam: boolean, isToxic: boolean, reasoning: string }>`

### `fetchWithRetry(url: string, retries?: number, backoff?: number)`
A robust internal network fetch handler that automatically retries API requests on network errors or 500-level HTTP responses with exponential backoff.
- **Returns**: `Promise<any>`

### `processComment(id: string, snippet: any)`
Processes a raw YouTube comment snippet, invokes the preprocessing and analyzer pipelines, and formats the result into a clean `CommentData` object.
- **Returns**: `Promise<CommentData>`

## Limitations & Compliance
- **YouTube Terms of Service**: Users must comply with the [YouTube API Terms of Service](https://developers.google.com/youtube/terms/api-services-terms-of-service) when using this tool.
- **Quota Limits**: The YouTube Data API v3 has strict quota limits (default 10,000 units per day). Fetching comments consumes quota (e.g., 1 unit per page of comments). Be mindful of your usage to avoid exhaustion.
- **Privacy Risks**: Storing and redistributing scraped YouTube user comments presents privacy and copyright risks. Do not distribute or publish raw user data sets without verifying compliance obligations and redistribution rights under the YouTube ToS.

## Acknowledgements
- [Bun](https://bun.sh) for the incredibly fast TS runtime.
- [Ollama](https://ollama.com/) & [Qwen2.5](https://qwenlm.github.io/) for advanced NLP sentiment verification.
- [HuggingFace Transformers](https://huggingface.co/docs/transformers/index) via `@xenova/transformers` for local ML inference.
- YouTube Data API v3 for the data infrastructure.

## License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
