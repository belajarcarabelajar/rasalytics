import { expect, test, afterEach } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "fs";
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

function runCli(args: string[], extraEnv: Record<string, string> = {}) {
  const cwd = makeTempDir("rasalytics-cli-cwd-");
  const home = makeTempDir("rasalytics-cli-home-");
  const result = Bun.spawnSync({
    cmd: [process.execPath, CLI_PATH, ...args],
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
  };
}

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
