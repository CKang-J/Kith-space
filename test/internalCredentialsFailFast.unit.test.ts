import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSX_CLI = fileURLToPath(import.meta.resolve("tsx/cli"));
const CREDENTIALS_PATH = path.join(ROOT, "src/local-runtime/internalCredentials.ts");
const ASSERT_CONFIGURED = `
  const { assertInternalCredentialsConfigured } = await import(${JSON.stringify(pathToFileURL(CREDENTIALS_PATH).href)});
  assertInternalCredentialsConfigured();
`;

function run(extraEnv: NodeJS.ProcessEnv): { status: number | null; stderr: string } {
  const result = spawnSync(process.execPath, [TSX_CLI, "--input-type=module", "--eval", ASSERT_CONFIGURED], {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    timeout: 15_000,
  });
  return { status: result.status, stderr: result.stderr ?? "" };
}

test("internal credentials fail fast when the Desktop token is missing", () => {
  const { status, stderr } = run({
    KITH_SPACE_DESKTOP_TOKEN: "",
    KITH_SPACE_WORKER_TOKEN: "worker-test-token",
  });
  assert.notEqual(status, 0);
  assert.match(stderr, /KITH_SPACE_DESKTOP_TOKEN/);
});

test("internal credentials fail fast when the Worker token is missing", () => {
  const { status, stderr } = run({
    KITH_SPACE_DESKTOP_TOKEN: "desktop-test-token",
    KITH_SPACE_WORKER_TOKEN: "",
  });
  assert.notEqual(status, 0);
  assert.match(stderr, /KITH_SPACE_WORKER_TOKEN/);
});

test("internal credentials accept both explicitly injected tokens", () => {
  const { status, stderr } = run({
    KITH_SPACE_DESKTOP_TOKEN: "desktop-test-token",
    KITH_SPACE_WORKER_TOKEN: "worker-test-token",
  });
  assert.equal(status, 0, stderr);
});
