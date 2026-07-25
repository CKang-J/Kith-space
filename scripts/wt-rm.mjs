import { existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pnpmCommand, runSync, validatedWorktreeName } from "./cross-platform-process.mjs";

const name = validatedWorktreeName(process.argv[2]);
const repoRoot = process.cwd();
const target = path.resolve(repoRoot, "..", `kith-space-${name}`);
if (!existsSync(target)) throw new Error(`${target} does not exist`);

runSync(pnpmCommand, ["run", "dev:e2e:down"], { cwd: target, allowFailure: true });
runSync("git", ["worktree", "remove", target, "--force"], { cwd: repoRoot });

const safe = name.replace(/[^A-Za-z0-9]/g, "_");
const dataRoot = path.resolve(os.homedir(), `.kith-space-${safe}`);
if (path.dirname(dataRoot) !== path.resolve(os.homedir())) {
  throw new Error("refusing to remove a data directory outside the user home");
}
rmSync(dataRoot, { recursive: true, force: true });
process.stdout.write(`worktree '${name}' removed; branch feature/${name} was kept\n`);
