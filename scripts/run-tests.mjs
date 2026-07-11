import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));

function filesUnder(dir, accept) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full, accept));
    else if (accept(full)) out.push(full);
  }
  return out;
}

function testEnv() {
  const home = mkdtempSync(path.join(tmpdir(), "kith-space-test-"));
  return {
    home,
    env: {
      ...process.env,
      NODE_ENV: "test",
      KITH_SPACE_DESKTOP_TOKEN: process.env.KITH_SPACE_DESKTOP_TOKEN ?? "kith-space-test-desktop-token",
      KITH_SPACE_WORKER_TOKEN: process.env.KITH_SPACE_WORKER_TOKEN ?? "kith-space-test-worker-token",
      KITH_SPACE_HOME: home,
    },
  };
}

function run(label, args) {
  const { home, env } = testEnv();
  process.stdout.write(`\n[test] ${label}\n`);
  const result = spawnSync(process.execPath, [tsxCli, ...args], { cwd: root, env, stdio: "inherit" });
  rmSync(home, { recursive: true, force: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const mode = process.argv[2];
if (mode !== "--integration") {
  const unitTests = [
    ...filesUnder(path.join(root, "src"), (file) => file.endsWith(".test.ts")),
    ...filesUnder(path.join(root, "test"), (file) => file.endsWith(".unit.test.ts")),
    ...filesUnder(path.join(root, "web", "src"), (file) => file.endsWith(".test.ts")),
  ].sort();
  // Unit files share one isolated app-data root for the invocation. Run files serially so their
  // SQLite lifecycle tests cannot race WAL setup or cleanup in separate test workers.
  run("unit", ["--test", "--test-force-exit", "--test-concurrency=1", ...unitTests]);
}

if (mode !== "--unit") {
  const filter = process.argv[3];
  const integrationTests = filesUnder(path.join(root, "test"), (file) =>
    file.endsWith(".integration.ts") && (!filter || path.basename(file).includes(filter))).sort();
  for (const file of integrationTests) run(`integration ${path.basename(file)}`, [file]);
}
