import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import crossSpawn from "cross-spawn";
import {
  expandHome,
  pnpmCommand,
  processExists,
  readEnvFile,
  runSync,
  startDetached,
  terminatePidTree,
  waitFor,
} from "./cross-platform-process.mjs";

const cwd = process.cwd();
const envFile = path.resolve(".env");
if (!existsSync(envFile)) throw new Error(`no .env in ${cwd}; run from a configured worktree`);
const configured = readEnvFile(envFile);
const port = Number(configured.PORT);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT missing or invalid in .env");
for (const key of ["KITH_SPACE_DESKTOP_TOKEN", "KITH_SPACE_WORKER_TOKEN"]) {
  if (!configured[key]) throw new Error(`${key} missing in .env`);
}
const runRoot = path.resolve(expandHome(configured.KITH_SPACE_HOME) || path.join(os.homedir(), ".kith-space"));
const env = { ...process.env, ...configured, KITH_SPACE_HOME: runRoot };
const logs = path.join(runRoot, "logs");
mkdirSync(logs, { recursive: true });

const claude = crossSpawn.sync("claude", ["--version"], { env, stdio: "ignore", windowsHide: true });
if (claude.error) throw new Error("claude CLI not found on PATH; install and authenticate it before dev:e2e");

const serverPidFile = path.join(runRoot, "dev-e2e-server.pid");
if (existsSync(serverPidFile)) {
  const existing = Number(readFileSync(serverPidFile, "utf8").trim());
  if (processExists(existing)) throw new Error(`dev E2E already running (server pid ${existing})`);
}

const started = [];
try {
  process.stdout.write("schema + bootstrap seed (idempotent)\n");
  runSync(pnpmCommand, ["run", "db:push"], { cwd, env, allowFailure: true });
  runSync(pnpmCommand, ["run", "seed"], { cwd, env, allowFailure: true });

  process.stdout.write("configuring local browser access\n");
  const access = runSync(pnpmCommand, ["--silent", "run", "browser-access:dev", "local", "--port", String(port), "--rotate-token"], {
    cwd, env, capture: true,
  });
  const accessToken = String(access.stdout).trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!accessToken) throw new Error("browser access command did not return a token");
  process.stdout.write(`  Access Token: ${accessToken}\n`);

  process.stdout.write("building web\n");
  runSync(pnpmCommand, ["run", "web:build"], { cwd, env });

  const serverPid = startDetached(pnpmCommand, ["exec", "tsx", "src/server/index.ts"], {
    cwd, env, logFile: path.join(logs, "dev-e2e-server.log"), label: "dev E2E server",
  });
  started.push(["server", serverPid]);
  writeFileSync(serverPidFile, String(serverPid));
  const healthUrl = `http://127.0.0.1:${port}/health`;
  const serverReady = await waitFor(async () => {
    try { return (await fetch(healthUrl)).ok; } catch { return false; }
  }, 30_000, 1_000);
  if (!serverReady) throw new Error(`server did not become healthy; see ${path.join(logs, "dev-e2e-server.log")}`);

  const daemonPid = startDetached(pnpmCommand, ["exec", "tsx", "src/daemon/index.ts"], {
    cwd, env, logFile: path.join(logs, "dev-e2e-daemon.log"), label: "dev E2E worker",
  });
  started.push(["daemon", daemonPid]);
  writeFileSync(path.join(runRoot, "dev-e2e-daemon.pid"), String(daemonPid));
  const workerReady = await waitFor(async () => {
    try {
      const response = await fetch(healthUrl);
      return response.ok && Boolean((await response.json()).workerConnected);
    } catch {
      return false;
    }
  }, 30_000, 1_000);
  if (!workerReady) throw new Error(`worker did not connect; see ${path.join(logs, "dev-e2e-daemon.log")}`);

  runSync(pnpmCommand, ["run", "seed:dev"], { cwd, env, allowFailure: true });
  process.stdout.write([
    "",
    "dev E2E up (worktree-isolated)",
    `  data dir: ${runRoot}`,
    `  app: http://127.0.0.1:${port}/`,
    "  access: enter the Access Token printed above",
    `  logs: ${logs}`,
    "  stop: pnpm run dev:e2e:down",
    "",
  ].join("\n"));
} catch (error) {
  for (const [label, pid] of started.reverse()) {
    await terminatePidTree(pid, `dev E2E ${label}`).catch(() => {});
  }
  throw error;
}
