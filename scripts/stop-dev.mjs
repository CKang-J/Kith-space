import { spawnSync } from "node:child_process";
import { commandBelongsToRoot, terminatePidTree } from "./cross-platform-process.mjs";

const root = process.cwd();
const markers = ["/src/server/index.ts", "/src/daemon/index.ts", "/node_modules/vite/bin/vite"];

function processRows() {
  if (process.platform === "win32") {
    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
    ], { encoding: "utf8", windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(String(result.stderr || "unable to enumerate Windows processes"));
    const parsed = JSON.parse(result.stdout || "[]");
    return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({
      pid: Number(row.ProcessId),
      command: String(row.CommandLine ?? ""),
    }));
  }
  const result = spawnSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" });
  if (result.error) throw result.error;
  return String(result.stdout).split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    return match ? [{ pid: Number(match[1]), command: match[2] }] : [];
  });
}

const targets = processRows().filter(({ pid, command }) => {
  if (pid === process.pid) return false;
  const normalized = command.replaceAll("\\", "/").toLowerCase();
  return commandBelongsToRoot(command, root) && markers.some((marker) => normalized.includes(marker));
});

for (const target of targets) {
  await terminatePidTree(target.pid, "development service");
  process.stdout.write(`stopped ${target.pid}\n`);
}
if (!targets.length) process.stdout.write("no matching development services are running\n");
