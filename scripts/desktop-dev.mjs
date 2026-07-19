import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try { process.loadEnvFile?.(path.join(root, ".env")); } catch { /* optional developer environment */ }

const child = spawn(electronPath, [root, ...process.argv.slice(2)], {
  cwd: root,
  env: {
    ...process.env,
    KITH_SPACE_DESKTOP_DEV: "1",
    KITH_SPACE_REPO_ROOT: root,
    KITH_SPACE_NODE_BINARY: process.execPath,
    KITH_SPACE_TSX_CLI: fileURLToPath(import.meta.resolve("tsx/cli")),
    KITH_SPACE_VITE_CLI: path.join(root, "web", "node_modules", "vite", "bin", "vite.js"),
  },
  stdio: ["inherit", "inherit", "inherit", "ipc"],
  windowsHide: false,
});

let shutdownTimer;
const requestChildShutdown = () => {
  if (shutdownTimer) return;
  if (child.connected) {
    child.send({ type: "kith:quit" }, (error) => {
      if (error && child.exitCode === null) child.kill();
    });
  } else if (child.exitCode === null) {
    child.kill();
  }
  shutdownTimer = setTimeout(() => {
    if (child.exitCode === null) child.kill();
  }, 10_000);
  shutdownTimer.unref();
};
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, requestChildShutdown);
}
child.on("exit", (code, signal) => {
  if (shutdownTimer) clearTimeout(shutdownTimer);
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
