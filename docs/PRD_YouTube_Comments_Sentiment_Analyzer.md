# Product Requirements Document (PRD): Rasalytics

## 1. Initial Request Analysis
**Weaknesses of the Initial Request:**
- **Focus:** "Collects complete comments" lacks bounds. A video can have millions of comments, leading to rate limits and out-of-memory errors. The relationship between top-level comments and replies needs strict definition based on the API docs.
- **Depth:** "Performs sentiment analysis" does not specify the mechanism. Since cloud deployment is prohibited and we are restricted to local WSL Bun, the sentiment engine must be a local, zero-external-dependency library (e.g., local JS lexicon-based analyzer).
- **Clarity:** Does not clarify how to handle API constraints, quota exhaustion, or edge cases like disabled/deleted comments. 
- **Relevance:** Does not specify the data export format or schemas, risking mismatched expectations on the final deliverables.
- **Measurability:** "Complete comments" is not measurable. We must replace this with "Retrieval of all paginated comments up to a configured threshold or until API completion."
- **Execution Risk:** High risk of quota exhaustion, failure on videos with disabled comments, and leaking API keys if `.env` rules are not strictly defined.

**Current Implementation State:**
- **Repository Path:** `/home/belajarcarabelajar/rasalytics`
- **Existing Scripts/Files:** The directory contains only reference documentation (`YouTube_Data_API_v3.md`, `YouTube_Data_API_v3_Docs.md`). No existing code.
- **Package Manager:** Not yet initialized (Must use Bun).
- **Environment Variables:** None currently (Will require `.env`).
- **Data Flow & Storage:** None currently (Will require local CSV/JSON export).
- **Entry Points:** None currently (Will be a CLI).
- **Deployment Assumptions:** Local WSL only.

---

## 2. Product Scope & Workflow
**Product Goal:** A local, WSL-only CLI tool running on Bun that collects YouTube comments (top-level and replies) for a target video using the official YouTube Data API v3, performs local sentiment analysis, and exports the aggregated data.

**User Persona:** Developer / Data Analyst working in WSL environment needing quick sentiment insights from YouTube videos without relying on heavy cloud infrastructure.

**Main Workflow:**
1. User provides a YouTube Video ID and max pagination limit via CLI arguments.
2. Application loads YouTube Data API key from local `.env`.
3. Application calls `commentThreads.list` to fetch top-level comments using pagination (`pageToken`).
4. Application calls `comments.list` with `parentId` to fetch replies for each thread.
5. Application processes each comment's text through a local sentiment analysis pipeline.
6. Application exports the final dataset (Comment ID, Author, Text, Like Count, Published At, Sentiment Score, Sentiment Label) to a CSV or JSON file.

**Non-Goals:**
- Scraping YouTube HTML DOM or using browser automation (e.g., Puppeteer, Playwright).
- Cloud deployment or Dockerization.
- Usage of external databases (PostgreSQL, MongoDB, etc.).
- UI or web interface expansion.
- Handling OAuth authentication (API Key only, as per documentation).
- Retrieving deleted, hidden, or private comments not returned by the API.

---

## 3. Data & API Requirements
### Complete Comment Collection Definition
- **Top-Level Comments:** Fetched using `commentThreads.list` with `maxResults` up to 100.
- **Replies:** Fetched using `comments.list` via `parentId`.
- **Pagination:** Managed via `pageToken` and `nextPageToken` loops. 
- **Disabled/Hidden/Deleted Comments:** Handled gracefully. If the API omits them, they are skipped. If comments are disabled for the video, the tool catches the API error and exits gracefully with a user-friendly message.
- **API Limits:** Must respect Google Data API quotas. Includes configurable `maxPages` to prevent accidental quota exhaustion. Must implement basic retry with exponential backoff only for safe, recoverable errors (e.g., 500, 503).

### Sentiment Analysis Pipeline
- **Input:** Cleaned plain text from `textDisplay` or `textOriginal` (API parameter `textFormat="plainText"`).
- **Processing:** Analyzed using a local Bun-compatible Node.js sentiment library. No external API calls for sentiment.
- **Output:** 
  - `score`: Numeric sentiment score.
  - `label`: Categorical label (e.g., "POSITIVE", "NEUTRAL", "NEGATIVE").
- **Aggregation:** Simple per-comment scoring. 

---

## 4. Technical Requirements
- **Environment:** WSL only.
- **Runtime & Package Manager:** Bun exclusively (`bun init`, `bun install`, `bun run`). No Node.js, npm, pnpm, or yarn.
- **API Communication:** Standard fetch/HTTP client utilizing the provided API endpoints (`https://www.googleapis.com/youtube/v3/...`).
- **Security & Constraints:**
  - `YOUTUBE_API_KEY` must be loaded from `.env`.
  - `.env` must be in `.gitignore`.
  - No hardcoded secrets in the repository.
  - No secrets logged to stdout/stderr.
- **Implementation Limits:**
  - No unrelated refactoring.
  - No unrelated dependencies (only essential API, CLI, and Sentiment packages).

---

## 5. Testing Requirements
Test coverage targets using `bun test`:
1. **API Client:** Mocked HTTP responses for `commentThreads.list` and `comments.list`.
2. **Pagination:** Ensures `nextPageToken` triggers the correct subsequent request.
3. **Parser:** Extracts correctly mapped properties (ID, Author, Text, Likes, Date).
4. **Sentiment Processor:** Validates that known positive/negative phrases return correct labels and scores.
5. **Exporter:** Verifies CSV/JSON formatting and file write success.
6. **Config Loader:** Ensures missing `.env` variables throw specific errors.
7. **Error Handling:** Validates graceful handling of 403 (Comments Disabled) and 404 (Video Not Found).

---

## 6. Acceptance Criteria Checklist

The following checklist must be executable item by item by the development agent.

### Phase 1: Setup & Configuration
- [ ] Initialize Bun project in /home/belajarcarabelajar/rasalytics.
- [ ] Create `.gitignore` including `node_modules`, `.env`, and output data files (`*.csv`, `*.json`).
- [ ] Implement environment variable loader ensuring `YOUTUBE_API_KEY` exists.

### Phase 2: API Client & Pagination
- [ ] Implement YouTube API client wrapper targeting `https://www.googleapis.com/youtube/v3/commentThreads`.
- [ ] Implement YouTube API client wrapper targeting `https://www.googleapis.com/youtube/v3/comments`.
- [ ] Implement pagination logic (`pageToken`) to collect top-level comments up to a configured limit.
- [ ] Implement reply fetching logic (`parentId`) for comment threads.
- [ ] Implement graceful error handling for HTTP 403 (Comments Disabled) and quota exceeded scenarios.

### Phase 3: Sentiment Analysis
- [ ] Integrate a local sentiment analysis library.
- [ ] Map API `textDisplay` strings to the sentiment processor.
- [ ] Attach `sentiment_score` and `sentiment_label` to the comment data object.

### Phase 4: Data Export
- [ ] Implement JSON export functionality saving to local disk.
- [ ] Implement CSV export functionality saving to local disk with headers: `comment_id`, `author`, `text`, `like_count`, `published_at`, `sentiment_score`, `sentiment_label`.

### Phase 5: CLI Entry Point
- [ ] Create CLI script parsing arguments (e.g., `--videoId`, `--maxPages`, `--format`).
- [ ] Ensure logging is informative but never leaks the API key.

### Phase 6: Testing
- [ ] Write tests for the API client (mocked).
- [ ] Write tests for the sentiment processor.
- [ ] Run `bun test` successfully.

---

## 7. Completion Definition
The project is complete when:
1. The CLI can be invoked via `bun run index.ts --videoId=<ID>`.
2. A public video's comments are successfully fetched, processed, and saved locally to a CSV/JSON file.
3. An inaccessible video (comments disabled) gracefully errors out without crashing.
4. All acceptance criteria checkboxes are fulfilled.
5. The deployment uses only local WSL resources with Bun.
