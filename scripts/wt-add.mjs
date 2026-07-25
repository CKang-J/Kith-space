import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  findFreePort,
  pnpmCommand,
  runSync,
  validatedWorktreeName,
} from "./cross-platform-process.mjs";

const name = validatedWorktreeName(process.argv[2]);
const repoRoot = process.cwd();
const target = path.resolve(repoRoot, "..", `kith-space-${name}`);
if (existsSync(target)) throw new Error(`${target} already exists`);
const safe = name.replace(/[^A-Za-z0-9]/g, "_");
const serverPort = await findFreePort(7_801);
const vitePort = await findFreePort(5_301);
const base = process.env.WT_BASE || "origin/main";

process.stdout.write(`worktree=${target} server=${serverPort} vite=${vitePort} base=${base}\n`);
runSync("git", ["fetch", "origin", "main", "--quiet"], { cwd: repoRoot, allowFailure: true });
runSync("git", ["worktree", "add", target, "-b", `feature/${name}`, base], { cwd: repoRoot });

writeFileSync(path.join(target, ".env"), [
  `PORT=${serverPort}`,
  `VITE_PORT=${vitePort}`,
  `KITH_SPACE_DESKTOP_TOKEN=${randomBytes(32).toString("hex")}`,
  `KITH_SPACE_WORKER_TOKEN=${randomBytes(32).toString("hex")}`,
  `KITH_SPACE_HOME=${path.join(os.homedir(), `.kith-space-${safe}`)}`,
  "",
].join("\n"));

process.stdout.write("Installing dependencies and seeding the workspace database...\n");
runSync(pnpmCommand, ["install", "--silent"], { cwd: target });
runSync(pnpmCommand, ["run", "seed"], { cwd: target });
process.stdout.write([
  "",
  `worktree '${name}' ready (branch feature/${name})`,
  `  cd ${target}`,
  `  pnpm run server       # backend on ${serverPort}`,
  `  pnpm run daemon       # worker connects to ${serverPort}`,
  `  pnpm --dir web run dev # frontend on ${vitePort}`,
  `  remove with: pnpm run wt:rm ${name}`,
  "",
].join("\n"));
