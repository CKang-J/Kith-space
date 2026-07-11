import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createNodeChildTerminator } from "./nodeChildProcess.js";
import type { DesktopChildProcess } from "./processSupervisorContract.js";

class LifecycleChild extends EventEmitter implements DesktopChildProcess {
  readonly pid = undefined;
  exitCode: number | null = null;
  killed = false;
  sent: unknown[] = [];
  signals: Array<NodeJS.Signals | number | undefined> = [];

  send(message: unknown, callback?: (error: Error | null) => void): boolean {
    this.sent.push(message);
    callback?.(null);
    setImmediate(() => {
      this.exitCode = 0;
      this.emit("exit", 0, null);
    });
    return true;
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    this.signals.push(signal);
    this.exitCode = 0;
    this.emit("exit", 0, signal ?? null);
    return true;
  }
}

test("managed Core and Worker receive graceful lifecycle IPC before any signal", async () => {
  const child = new LifecycleChild();
  await createNodeChildTerminator({ gracefulTimeoutMs: 50, forcedTimeoutMs: 10 })(child, "worker");
  assert.deepEqual(child.sent, [{ type: "kith:shutdown" }]);
  assert.deepEqual(child.signals, []);
});

test("Vite is terminated as an ordinary direct child", async () => {
  const child = new LifecycleChild();
  child.send = undefined as never;
  await createNodeChildTerminator({ gracefulTimeoutMs: 50, forcedTimeoutMs: 10 })(child, "vite");
  assert.deepEqual(child.signals, [process.platform === "win32" ? "SIGKILL" : "SIGTERM"]);
});

test("a broken lifecycle IPC channel falls through to forced tree cleanup", async () => {
  const child = new LifecycleChild();
  child.send = () => { throw new Error("IPC closed"); };
  await createNodeChildTerminator({ gracefulTimeoutMs: 1, forcedTimeoutMs: 20 })(child, "worker");
  assert.deepEqual(child.signals, ["SIGKILL"]);
});
