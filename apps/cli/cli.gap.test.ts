import { expect, test, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// cli.ts is a script without exports: run() executes on load, so it is tested
// through a child process with a temporary cwd and a fully controlled env.
const CLI_PATH = join(import.meta.dir, "src", "cli.ts");
const VALID_VIDEO_ID = "abcDEF_12-x"; // 11 chars, uses '_' and '-'
const SPAWN_TIMEOUT_MS = 30_000;

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function runCli(
  args: string[],
  extraEnv: Record<string, string> = {},
  opts: { cwd?: string; preload?: string } = {},
) {
  const cwd = opts.cwd ?? makeTempDir("rasalytics-cli-cwd-");
  const home = makeTempDir("rasalytics-cli-home-");
  const preload = opts.preload ? ["--preload", opts.preload] : [];
  const result = Bun.spawnSync({
    cmd: [process.execPath, ...preload, CLI_PATH, ...args],
    cwd,
    // Full replacement of the env: no real YOUTUBE_API_KEY leaks in, and the
    // child never touches the real home directory.
    env: {
      HOME: home,
      NODE_ENV: "production",
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const artifacts = readdirSync(cwd).filter(
    (f) => f.startsWith("temp_") || f.startsWith("comments_"),
  );
  return {
    exitCode: result.exitCode,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
    artifacts,
    cwd,
  };
}

// Fake network for the child process. The fixture is passed as a path only and
// never imported here, so the per-file coverage threshold does not apply to it.
const MOCK_FETCH_PATH = join(import.meta.dir, "test-fixtures", "mock-fetch.ts");
const DB_FILE = `temp_${VALID_VIDEO_ID}.sqlite`;
const CSV_FILE = `comments_${VALID_VIDEO_ID}.csv`;
const MD_FILE = `comments_${VALID_VIDEO_ID}.md`;

function runMockedCli(mode: string, extraArgs: string[] = [], cwd?: string) {
  return runCli(
    ["--videoId", VALID_VIDEO_ID, ...extraArgs],
    { YOUTUBE_API_KEY: "dummy-key", MOCK_MODE: mode },
    { cwd, preload: MOCK_FETCH_PATH },
  );
}

function readArtifact(cwd: string, name: string): string {
  return readFileSync(join(cwd, name), "utf-8");
}

test(
  "CLI removes the temporary database and exits 0 after a complete run",
  () => {
    const res = runMockedCli("single-page");
    expect(res.stdout).toContain("=== SENTIMENT RECAP ===");
    expect(res.stdout).toContain("Total Comments: 4");
    expect(res.exitCode).toBe(0);
    expect(res.artifacts).toContain(CSV_FILE);
    expect(res.artifacts).not.toContain(DB_FILE);
  },
  SPAWN_TIMEOUT_MS,
);

test(
  "CLI keeps the temporary database and exits 1 when a later page fails",
  () => {
    const res = runMockedCli("page2-403");
    expect(res.stderr).toContain("Execution stopped: API Error 403");
    // The partial data is still exported.
    expect(res.stdout).toContain("Total Comments: 1");
    expect(res.artifacts).toContain(CSV_FILE);
    expect(res.artifacts).toContain(DB_FILE);
    expect(res.exitCode).toBe(1);
  },
  SPAWN_TIMEOUT_MS,
);

test.each([["abc"], ["5abc"], ["0"], ["-2"], ["1.5"], [""]])(
  "CLI rejects --maxPages %p with code 1 before creating a database",
  (maxPages: string) => {
    const res = runMockedCli("single-page", [`--maxPages=${maxPages}`]);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("--maxPages must be a positive integer");
    expect(res.stdout).not.toContain("Starting comment collection");
    expect(res.artifacts).toEqual([]);
  },
  SPAWN_TIMEOUT_MS,
);

test(
  "CSV export neutralises a formula hidden behind a leading tab or carriage return",
  () => {
    const res = runMockedCli("single-page");
    expect(res.exitCode).toBe(0);
    const csv = readArtifact(res.cwd, CSV_FILE);
    expect(csv).toContain(`"'\t=HYPERLINK(""x"")"`);
    expect(csv).toContain(`"'\r=1+1"`);
    // Control: an ordinary comment gets no leading quote.
    expect(csv).toContain(`"komentar biasa tanpa rumus"`);
    const cleanCsv = readArtifact(res.cwd, `comments_${VALID_VIDEO_ID}_clean.csv`);
    expect(cleanCsv).not.toContain(`"\t=`);
    expect(cleanCsv).not.toContain(`"\r=`);
  },
  SPAWN_TIMEOUT_MS,
);

test(
  "report time series skips comments without a publish date",
  () => {
    const res = runMockedCli("single-page");
    expect(res.exitCode).toBe(0);
    // Control: the undated comment was collected.
    expect(readArtifact(res.cwd, CSV_FILE)).toContain(`"undated"`);
    const xAxis = readArtifact(res.cwd, MD_FILE)
      .split("\n")
      .filter((line) => line.includes("x-axis"));
    expect(xAxis.map((line) => line.trim())).toEqual([`x-axis ["2026-01-02"]`]);
  },
  SPAWN_TIMEOUT_MS,
);

test(
  "video details failure is logged without the API key from the URL",
  () => {
    const res = runMockedCli("videos-throw");
    // Control: the mocked failure was reached and logged.
    expect(res.stderr).toContain("Failed to fetch video details");
    expect(res.stderr).toContain("Unable to connect");
    expect(res.stderr).not.toContain("SECRET123");
    expect(res.exitCode).toBe(0);
  },
  SPAWN_TIMEOUT_MS,
);

test(
  "resumed run flags a comment that duplicates one stored by the failed run",
  () => {
    const first = runMockedCli("page2-403");
    expect(first.artifacts).toContain(DB_FILE);
    const second = runMockedCli("page2-duplicate", [], first.cwd);
    expect(second.stdout).toContain("Resuming from saved pageToken: PAGE2");
    expect(second.stdout).toContain("Total Comments: 2");
    expect(second.exitCode).toBe(0);
    const rows = readArtifact(first.cwd, CSV_FILE).split("\n");
    const duplicate = rows.find((row) => row.startsWith(`"c2",`)) ?? "";
    // Columns after the label: is_spam, is_toxic, is_buzzer, buzzer_group_id.
    expect(duplicate).toMatch(/^"c2","author-c2","[A-Z]+",0,0,1,"c1",/);
    expect(second.artifacts).not.toContain(DB_FILE);
  },
  SPAWN_TIMEOUT_MS * 2,
);

test(
  "CLI with NODE_ENV=test skips run() entirely and exits cleanly without arguments",
  () => {
    const res = runCli([], { NODE_ENV: "test" });
    expect(res.exitCode).toBe(0);
    expect(res.stderr).not.toContain("--videoId is required");
    expect(res.stdout).not.toContain("Starting comment collection");
    expect(res.artifacts).toEqual([]);
  },
  SPAWN_TIMEOUT_MS,
);

test(
  "CLI without --videoId exits with code 1 and a required-argument error",
  () => {
    const res = runCli([], { YOUTUBE_API_KEY: "dummy-key" });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("Error: --videoId is required.");
    expect(res.stdout).not.toContain("Starting comment collection");
    expect(res.artifacts).toEqual([]);
  },
  SPAWN_TIMEOUT_MS,
);

test(
  "CLI with an empty --videoId value is treated as missing",
  () => {
    const res = runCli(["--videoId="], { YOUTUBE_API_KEY: "dummy-key" });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("Error: --videoId is required.");
    expect(res.artifacts).toEqual([]);
  },
  SPAWN_TIMEOUT_MS,
);

test.each([
  ["abcDEF_12x"], // 10 chars: one below the required length
  ["abcDEF_12-xy"], // 12 chars: one above the required length
  ["abc$EF_12-x"], // 11 chars but contains a forbidden character
  ["abcDEF 12-x"], // 11 chars but contains a space
])(
  "CLI rejects malformed videoId %p with code 1 before doing any work",
  (videoId: string) => {
    const res = runCli(["--videoId", videoId], { YOUTUBE_API_KEY: "dummy-key" });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("Invalid videoId");
    expect(res.stdout).not.toContain("Starting comment collection");
    expect(res.artifacts).toEqual([]);
  },
  SPAWN_TIMEOUT_MS,
);

test(
  "CLI validates videoId format before checking YOUTUBE_API_KEY",
  () => {
    const res = runCli(["--videoId", "short"]);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("Invalid videoId");
    expect(res.stderr).not.toContain("YOUTUBE_API_KEY");
  },
  SPAWN_TIMEOUT_MS,
);

test(
  "CLI with a valid videoId but no YOUTUBE_API_KEY exits with code 1 and creates no database",
  () => {
    const res = runCli(["--videoId", VALID_VIDEO_ID]);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("Error: YOUTUBE_API_KEY is not set in .env");
    expect(res.stderr).not.toContain("Invalid videoId");
    expect(res.stdout).not.toContain("Starting comment collection");
    expect(res.artifacts).toEqual([]);
  },
  SPAWN_TIMEOUT_MS,
);

test(
  "CLI treats an empty YOUTUBE_API_KEY as not set",
  () => {
    const res = runCli(["--videoId", VALID_VIDEO_ID], { YOUTUBE_API_KEY: "" });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("Error: YOUTUBE_API_KEY is not set in .env");
    expect(res.artifacts).toEqual([]);
  },
  SPAWN_TIMEOUT_MS,
);

test(
  "CLI with an unknown option fails at argument parsing even when NODE_ENV=test",
  () => {
    // parseArgs runs at module load (outside run()), so the NODE_ENV guard does not apply.
    const res = runCli(["--unknownFlag", "x"], { NODE_ENV: "test" });
    expect(res.exitCode).not.toBe(0);
    expect(res.stdout).not.toContain("Starting comment collection");
    expect(res.artifacts).toEqual([]);
  },
  SPAWN_TIMEOUT_MS,
);
