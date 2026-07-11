import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  DesktopProcessSupervisor,
  type DesktopChildProcess,
  type DesktopProcessDiagnostic,
  type DesktopSpawnRequest,
} from "./processSupervisor.js";

class FakeChild extends EventEmitter implements DesktopChildProcess {
  readonly pid: number;
  exitCode: number | null = null;
  killed = false;

  constructor(pid: number) {
    super();
    this.pid = pid;
  }

  kill(signal: NodeJS.Signals | number = "SIGTERM"): boolean {
    this.killed = true;
    this.exitCode = 0;
    this.emit("exit", 0, typeof signal === "string" ? signal : null);
    return true;
  }
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function createHarness(options: {
  vite?: boolean;
  timeoutMs?: number;
  failSpawnRole?: "core" | "worker" | "vite";
  failTerminateRole?: "core" | "worker" | "vite";
} = {}) {
  const requests: DesktopSpawnRequest[] = [];
  const children: FakeChild[] = [];
  const diagnostics: DesktopProcessDiagnostic[] = [];
  const terminated: string[] = [];
  let credentialGeneration = 0;

  const supervisor = new DesktopProcessSupervisor({
    kithSpaceHome: "D:\\KithHome",
    commands: {
      core: {
        command: "core",
        env: { KITH_SPACE_WORKER_TOKEN: "command-leak", PORT: "command-port-leak" },
      },
      worker: { command: "worker", env: { KITH_SPACE_DESKTOP_TOKEN: "command-leak" } },
      ...(options.vite === false
        ? {}
        : {
            vite: {
              command: "vite",
              env: {
                KITH_SPACE_DESKTOP_TOKEN: "command-leak",
                KITH_SPACE_WORKER_TOKEN: "command-leak",
              },
            },
          }),
    },
    parentEnv: {
      PATH: "test-path",
      PORT: "parent-port-leak",
      ENV_FILE: ".env.prod",
      KITH_SPACE_DESKTOP_TOKEN: "parent-leak",
      KITH_SPACE_WORKER_TOKEN: "parent-leak",
      kith_space_desktop_token: "lowercase-parent-leak",
      kith_space_worker_token: "lowercase-parent-leak",
    },
    coreReadyTimeoutMs: options.timeoutMs ?? 100,
    credentials: () => {
      credentialGeneration += 1;
      return {
        desktopTrustToken: `desktop-${credentialGeneration}`,
        workerToken: `worker-${credentialGeneration}`,
      };
    },
    spawn: (request) => {
      requests.push(request);
      if (request.role === options.failSpawnRole) throw new Error(`${request.role} command missing`);
      const child = new FakeChild(1000 + children.length);
      children.push(child);
      return child;
    },
    terminate: async (_child, role) => {
      terminated.push(role);
      if (role === options.failTerminateRole) throw new Error(`${role} would not stop`);
      _child.kill("SIGTERM");
    },
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });

  return { children, diagnostics, requests, supervisor, terminated };
}

test("Core ready gates dependants and each child receives only its required credentials", async () => {
  const harness = createHarness();
  const started = harness.supervisor.start();
  await Promise.resolve();

  assert.deepEqual(harness.requests.map(({ role }) => role), ["core"]);
  const coreRequest = harness.requests.at(0)!;
  assert.equal(coreRequest.ipc, true);
  assert.equal(coreRequest.env.KITH_SPACE_DESKTOP_MANAGED, "1");
  assert.equal(coreRequest.env.KITH_SPACE_HOME, "D:\\KithHome");
  assert.equal(coreRequest.env.KITH_SPACE_DESKTOP_TOKEN, "desktop-1");
  assert.equal(coreRequest.env.KITH_SPACE_WORKER_TOKEN, "worker-1");
  assert.equal(coreRequest.env.PORT, undefined);
  assert.notEqual(coreRequest.env.ENV_FILE, ".env.prod");

  harness.children.at(0)!.emit("message", {
    type: "kith:core-ready",
    host: "127.0.0.1",
    port: 8123,
    browserMode: "local",
  });
  const ready = await started;

  assert.deepEqual(ready, {
    host: "127.0.0.1",
    port: 8123,
    browserMode: "local",
  });
  assert.deepEqual(harness.requests.map(({ role }) => role), ["core", "worker", "vite"]);

  const workerEnv = harness.requests.at(1)!.env;
  assert.equal(harness.requests.at(1)!.ipc, true);
  assert.equal(workerEnv.KITH_SPACE_DESKTOP_MANAGED, "1");
  assert.equal(workerEnv.KITH_SPACE_HOME, "D:\\KithHome");
  assert.equal(workerEnv.PORT, "8123");
  assert.equal(workerEnv.KITH_SPACE_WORKER_TOKEN, "worker-1");
  assert.equal(workerEnv.KITH_SPACE_DESKTOP_TOKEN, undefined);
  assert.notEqual(workerEnv.ENV_FILE, ".env.prod");

  const viteEnv = harness.requests.at(2)!.env;
  assert.equal(viteEnv.KITH_SPACE_DESKTOP_MANAGED, "1");
  assert.equal(viteEnv.KITH_SPACE_HOME, "D:\\KithHome");
  assert.equal(viteEnv.PORT, "8123");
  assert.equal(viteEnv.KITH_SPACE_WORKER_TOKEN, undefined);
  assert.equal(viteEnv.KITH_SPACE_DESKTOP_TOKEN, undefined);
  assert.equal(viteEnv.kith_space_worker_token, undefined);
  assert.equal(viteEnv.kith_space_desktop_token, undefined);
  assert.deepEqual(harness.diagnostics, [{ type: "core-ready", ready }]);

  await harness.supervisor.stop();
  await nextTurn();
});

test("Core listen errors stop startup and retain a structured diagnostic", async () => {
  const harness = createHarness({ vite: false });
  const started = harness.supervisor.start();
  await Promise.resolve();

  harness.children.at(0)!.emit("message", {
    type: "kith:core-error",
    code: "EADDRINUSE",
    message: "port 7777 is already in use",
    port: 7777,
  });

  await assert.rejects(started, (error: unknown) => {
    assert.equal(error instanceof Error, true);
    const failure = (error as { failure?: Record<string, unknown> }).failure;
    assert.equal(failure?.code, "CORE_REPORTED_ERROR");
    assert.equal(failure?.reportedCode, "EADDRINUSE");
    assert.equal(failure?.port, 7777);
    return true;
  });
  assert.deepEqual(harness.requests.map(({ role }) => role), ["core"]);
  assert.equal(harness.supervisor.snapshot().state, "failed");
  assert.equal(harness.supervisor.snapshot().lastFailure?.code, "CORE_REPORTED_ERROR");
  assert.equal(harness.diagnostics.at(-1)?.type, "process-failure");
});

test("Core ready timeout is distinct from a child-reported listen error", async () => {
  const harness = createHarness({ vite: false, timeoutMs: 5 });

  await assert.rejects(harness.supervisor.start(), (error: unknown) => {
    const failure = (error as { failure?: Record<string, unknown> }).failure;
    assert.equal(failure?.code, "CORE_READY_TIMEOUT");
    return true;
  });
  assert.equal(harness.supervisor.snapshot().lastFailure?.code, "CORE_READY_TIMEOUT");
  assert.equal(harness.diagnostics.at(-1)?.type, "process-failure");
});

test("Unexpected child exit fails the process group and identifies the child", async () => {
  const harness = createHarness();
  const started = harness.supervisor.start();
  await Promise.resolve();
  harness.children.at(0)!.emit("message", {
    type: "kith:core-ready",
    host: "127.0.0.1",
    port: 7777,
    browserMode: "off",
  });
  await started;

  const worker = harness.children.at(1)!;
  worker.exitCode = 7;
  worker.emit("exit", 7, null);
  await nextTurn();

  const snapshot = harness.supervisor.snapshot();
  assert.equal(snapshot.state, "failed");
  assert.equal(snapshot.lastFailure?.code, "PROCESS_EXITED");
  assert.equal(snapshot.lastFailure?.role, "worker");
  assert.equal(snapshot.lastFailure?.exitCode, 7);
  assert.deepEqual(harness.terminated, ["vite", "core"]);
});

test("Explicit stop terminates dependants first without reporting their exits as failures", async () => {
  const harness = createHarness();
  const started = harness.supervisor.start();
  await Promise.resolve();
  harness.children.at(0)!.emit("message", {
    type: "kith:core-ready",
    host: "127.0.0.1",
    port: 7777,
    browserMode: "off",
  });
  await started;

  await harness.supervisor.stop();

  assert.equal(harness.supervisor.snapshot().state, "idle");
  assert.deepEqual(harness.terminated, ["vite", "worker", "core"]);
  assert.deepEqual(harness.diagnostics.map(({ type }) => type), ["core-ready"]);
});

test("Explicit stop during Core startup cancels readiness without a false failure", async () => {
  const harness = createHarness({ vite: false });
  const started = harness.supervisor.start();
  await Promise.resolve();

  const stopped = harness.supervisor.stop();
  await assert.rejects(started, /cancelled/);
  await stopped;

  assert.equal(harness.supervisor.snapshot().state, "idle");
  assert.equal(harness.supervisor.snapshot().lastFailure, null);
  assert.deepEqual(harness.diagnostics, []);
});

test("Restart replaces the whole group and rotates internal credentials", async () => {
  const harness = createHarness({ vite: false });
  const firstStart = harness.supervisor.start();
  await Promise.resolve();
  harness.children.at(0)!.emit("message", {
    type: "kith:core-ready",
    host: "127.0.0.1",
    port: 7001,
    browserMode: "local",
  });
  await firstStart;

  const restarted = harness.supervisor.restart();
  await nextTurn();
  assert.deepEqual(harness.requests.map(({ role }) => role), ["core", "worker", "core"]);
  const replacementCore = harness.children.at(2)!;
  assert.equal(harness.requests.at(2)!.env.KITH_SPACE_DESKTOP_TOKEN, "desktop-2");
  assert.equal(harness.requests.at(2)!.env.KITH_SPACE_WORKER_TOKEN, "worker-2");
  replacementCore.emit("message", {
    type: "kith:core-ready",
    host: "127.0.0.1",
    port: 7002,
    browserMode: "local",
  });

  assert.equal((await restarted).port, 7002);
  assert.equal(harness.requests.at(3)!.env.PORT, "7002");
  assert.equal(harness.requests.at(3)!.env.KITH_SPACE_WORKER_TOKEN, "worker-2");
  assert.equal(harness.requests.at(3)!.env.KITH_SPACE_DESKTOP_TOKEN, undefined);
  await harness.supervisor.stop();
});

test("A dependant spawn failure reports the dependant role and tears down Core", async () => {
  const harness = createHarness({ vite: false, failSpawnRole: "worker" });
  const started = harness.supervisor.start();
  await Promise.resolve();
  harness.children.at(0)!.emit("message", {
    type: "kith:core-ready",
    host: "127.0.0.1",
    port: 7777,
    browserMode: "off",
  });

  await assert.rejects(started, (error: unknown) => {
    const failure = (error as { failure?: Record<string, unknown> }).failure;
    assert.equal(failure?.code, "PROCESS_SPAWN_ERROR");
    assert.equal(failure?.role, "worker");
    return true;
  });
  assert.equal(harness.supervisor.snapshot().lastFailure?.role, "worker");
  assert.deepEqual(harness.terminated, ["core"]);
});

test("A termination failure is diagnosed while every child still receives a stop attempt", async () => {
  const harness = createHarness({ failTerminateRole: "worker" });
  const started = harness.supervisor.start();
  await Promise.resolve();
  harness.children.at(0)!.emit("message", {
    type: "kith:core-ready",
    host: "127.0.0.1",
    port: 7777,
    browserMode: "off",
  });
  await started;

  await assert.rejects(harness.supervisor.stop(), (error: unknown) => {
    const failure = (error as { failure?: Record<string, unknown> }).failure;
    assert.equal(failure?.code, "PROCESS_TERMINATION_ERROR");
    assert.equal(failure?.role, "worker");
    return true;
  });

  assert.deepEqual(harness.terminated, ["vite", "worker", "core"]);
  assert.equal(harness.supervisor.snapshot().state, "failed");
  assert.equal(harness.supervisor.snapshot().lastFailure?.role, "worker");
  assert.deepEqual(harness.supervisor.snapshot().running, ["worker"]);
});
