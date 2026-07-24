import { spawn, type ChildProcess } from "node:child_process";

/** Provider helpers have no reason to leave descendants behind after cancellation. */
export function terminateProviderProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return Promise.resolve();
  if (process.platform !== "win32") {
    return new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      let settled = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => { if (!settled) { settled = true; if (killTimer) clearTimeout(killTimer); resolve(); } };
      child.once("exit", finish);
      try { process.kill(-child.pid!, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch {} }
      killTimer = setTimeout(() => {
        try { process.kill(-child.pid!, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} }
        const reapTimer = setTimeout(finish, 1_000);
        reapTimer.unref?.();
      }, 2_000);
      killTimer.unref?.();
    });
  }
  return new Promise((resolve) => {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore", windowsHide: true,
    });
    killer.once("error", () => { try { child.kill("SIGTERM"); } catch {} resolve(); });
    killer.once("exit", () => resolve());
  });
}
