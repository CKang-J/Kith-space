import { existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  expandHome,
  processExists,
  readEnvFile,
  terminatePidTree,
} from "./cross-platform-process.mjs";

const envFile = path.resolve(".env");
if (!existsSync(envFile)) throw new Error(`no .env in ${process.cwd()}`);
const configured = readEnvFile(envFile);
const runRoot = path.resolve(expandHome(configured.KITH_SPACE_HOME) || path.join(os.homedir(), ".kith-space"));

for (const service of ["server", "daemon"]) {
  const pidFile = path.join(runRoot, `dev-e2e-${service}.pid`);
  if (!existsSync(pidFile)) continue;
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  if (processExists(pid)) {
    await terminatePidTree(pid, `dev E2E ${service}`);
    process.stdout.write(`stopped ${service} (${pid})\n`);
  }
  rmSync(pidFile, { force: true });
}
process.stdout.write("dev E2E down\n");
