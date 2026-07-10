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
      JWT_SECRET: process.env.JWT_SECRET ?? "kith-space-test-jwt-secret",
      DAEMON_BOOTSTRAP_KEY: process.env.DAEMON_BOOTSTRAP_KEY ?? "kith-space-test-daemon-key",
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
  run("unit", ["--test", "--test-force-exit", ...unitTests]);
}

if (mode !== "--unit") {
  const filter = process.argv[3];
  const integrationTests = filesUnder(path.join(root, "test"), (file) =>
    file.endsWith(".integration.ts") && (!filter || path.basename(file).includes(filter))).sort();
  for (const file of integrationTests) run(`integration ${path.basename(file)}`, [file]);
}
