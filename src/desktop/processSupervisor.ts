import { generateInternalProcessCredentials } from "../local-runtime/internalCredentials.js";
import { parseCoreErrorMessage, parseCoreReadyMessage } from "./coreProcessMessage.js";
import {
  buildManagedChildEnv,
  DESKTOP_TOKEN_ENV,
  removeEnvKey,
  WORKER_TOKEN_ENV,
} from "./managedChildEnv.js";
import { spawnNodeChild, terminateNodeChild } from "./nodeChildProcess.js";
import {
  DesktopProcessError,
  type CoreReadyInfo,
  type DesktopChildProcess,
  type DesktopChildSpawner,
  type DesktopChildTerminator,
  type DesktopProcessCommand,
  type DesktopProcessDiagnostic,
  type DesktopProcessRole,
  type DesktopProcessSupervisorOptions,
  type ProcessFailure,
  type SupervisorSnapshot,
  type SupervisorState,
} from "./processSupervisorContract.js";

export * from "./processSupervisorContract.js";

class DesktopStartCancelledError extends Error {
  constructor() {
    super("Desktop process startup was cancelled");
    this.name = "DesktopStartCancelledError";
  }
}

export class DesktopProcessSupervisor {
  private readonly options: DesktopProcessSupervisorOptions & {
    spawn: DesktopChildSpawner;
    terminate: DesktopChildTerminator;
  };
  private readonly children = new Map<DesktopProcessRole, DesktopChildProcess>();
  private readonly expectedExits = new WeakSet<DesktopChildProcess>();
  private state: SupervisorState = "idle";
  private core: CoreReadyInfo | null = null;
  private lastFailure: ProcessFailure | null = null;
  private cancelCoreReady: (() => void) | null = null;
  private stopRequested = false;

  constructor(options: DesktopProcessSupervisorOptions) {
    if (!options.kithSpaceHome.trim()) throw new Error("kithSpaceHome is required");
    if (!Number.isFinite(options.coreReadyTimeoutMs ?? 15_000) || (options.coreReadyTimeoutMs ?? 15_000) <= 0) {
      throw new Error("coreReadyTimeoutMs must be a positive number");
    }
    this.options = {
      ...options,
      spawn: options.spawn ?? spawnNodeChild,
      terminate: options.terminate ?? terminateNodeChild,
    };
  }

  snapshot(): SupervisorSnapshot {
    return {
      state: this.state,
      core: this.core,
      running: [...this.children.keys()],
      lastFailure: this.lastFailure,
    };
  }

  async start(): Promise<CoreReadyInfo> {
    if (this.state !== "idle") throw new Error(`cannot start Desktop processes while ${this.state}`);
    this.state = "starting";
    this.stopRequested = false;
    this.lastFailure = null;
    const credentials = (this.options.credentials ?? generateInternalProcessCredentials)();

    try {
      const coreEnv = buildManagedChildEnv(
        this.options.parentEnv ?? process.env,
        this.options.commands.core.env,
        this.options.kithSpaceHome,
      );
      removeEnvKey(coreEnv, "PORT");
      coreEnv[DESKTOP_TOKEN_ENV] = credentials.desktopTrustToken;
      coreEnv[WORKER_TOKEN_ENV] = credentials.workerToken;
      const coreChild = this.spawn("core", this.options.commands.core, coreEnv, true, false);
      const ready = await this.waitForCoreReady(coreChild);
      if (this.stopRequested) throw new DesktopStartCancelledError();
      this.monitorChild("core", coreChild);
      this.core = ready;
      this.emitDiagnostic({ type: "core-ready", ready });

      const workerEnv = buildManagedChildEnv(
        this.options.parentEnv ?? process.env,
        this.options.commands.worker.env,
        this.options.kithSpaceHome,
      );
      removeEnvKey(workerEnv, "PORT");
      workerEnv.PORT = String(ready.port);
      workerEnv[WORKER_TOKEN_ENV] = credentials.workerToken;
      this.spawn("worker", this.options.commands.worker, workerEnv, true);

      const vite = this.options.commands.vite;
      if (vite) {
        const viteEnv = buildManagedChildEnv(this.options.parentEnv ?? process.env, vite.env, this.options.kithSpaceHome);
        removeEnvKey(viteEnv, "PORT");
        viteEnv.PORT = String(ready.port);
        this.spawn("vite", vite, viteEnv, false);
      }

      this.state = "running";
      return ready;
    } catch (error) {
      if (error instanceof DesktopStartCancelledError) {
        try {
          await this.terminateAll();
        } catch {
          // stop() owns explicit-stop diagnostics; startup cancellation itself is not a failure.
        }
        this.core = null;
        throw error;
      }
      const failureError = error instanceof DesktopProcessError
        ? error
        : new DesktopProcessError({
            code: "PROCESS_SPAWN_ERROR",
            role: "core",
            message: `Desktop process startup failed: ${error instanceof Error ? error.message : String(error)}`,
          });
      this.recordFailure(failureError.failure);
      try {
        await this.terminateAll();
      } catch {
        // Preserve the startup diagnosis; a failed cleanup cannot make it more actionable.
      }
      this.core = null;
      this.state = "failed";
      throw failureError;
    }
  }

  async restart(): Promise<CoreReadyInfo> {
    await this.stop();
    return this.start();
  }

  async stop(): Promise<void> {
    if (this.state === "idle") return;
    this.stopRequested = true;
    this.state = "stopping";
    this.cancelCoreReady?.();
    try {
      await this.terminateAll();
      this.core = null;
      this.state = "idle";
    } catch (error) {
      const failureError = error instanceof DesktopProcessError
        ? error
        : new DesktopProcessError({
            code: "PROCESS_TERMINATION_ERROR",
            role: "core",
            message: `Desktop process termination failed: ${error instanceof Error ? error.message : String(error)}`,
          });
      this.state = "failed";
      this.recordFailure(failureError.failure);
      throw failureError;
    }
  }

  private spawn(
    role: DesktopProcessRole,
    command: DesktopProcessCommand,
    env: NodeJS.ProcessEnv,
    ipc: boolean,
    monitor = true,
  ): DesktopChildProcess {
    let child: DesktopChildProcess;
    try {
      child = this.options.spawn({
        role,
        command: command.command,
        args: command.args ?? [],
        ...(command.cwd ? { cwd: command.cwd } : {}),
        env,
        ipc,
      });
    } catch (error) {
      throw new DesktopProcessError({
        code: "PROCESS_SPAWN_ERROR",
        role,
        message: `${role} failed to spawn: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    this.children.set(role, child);
    if (monitor) this.monitorChild(role, child);
    return child;
  }

  private monitorChild(role: DesktopProcessRole, child: DesktopChildProcess): void {
    child.on("error", (error: Error) => {
      this.handleUnexpectedFailure(role, child, {
        code: "PROCESS_SPAWN_ERROR",
        role,
        message: `${role} process error: ${error.message}`,
      });
    });
    child.on("exit", (exitCode: number | null, signal: NodeJS.Signals | null) => {
      this.handleUnexpectedFailure(role, child, {
        code: "PROCESS_EXITED",
        role,
        message: `${role} exited unexpectedly (code=${exitCode ?? "null"}, signal=${signal ?? "none"})`,
        exitCode,
        signal,
      });
    });
  }

  private handleUnexpectedFailure(
    role: DesktopProcessRole,
    child: DesktopChildProcess,
    failure: ProcessFailure,
  ): void {
    if (this.children.get(role) !== child || this.expectedExits.has(child)) return;
    if (this.state === "idle" || this.state === "stopping" || this.state === "failed") return;
    this.children.delete(role);
    this.state = "failed";
    this.recordFailure(failure);
    void this.terminateAll().catch(() => {
      // The original child failure remains the useful diagnosis. A platform terminator may report separately.
    });
  }

  private waitForCoreReady(child: DesktopChildProcess): Promise<CoreReadyInfo> {
    return new Promise((resolve, reject) => {
      let cancel = () => {};
      const timeout = setTimeout(() => {
        cleanup();
        reject(new DesktopProcessError({
          code: "CORE_READY_TIMEOUT",
          role: "core",
          message: `Core did not report ready within ${this.options.coreReadyTimeoutMs ?? 15_000}ms`,
        }));
      }, this.options.coreReadyTimeoutMs ?? 15_000);

      const cleanup = () => {
        clearTimeout(timeout);
        child.removeListener("message", onMessage);
        child.removeListener("error", onError);
        child.removeListener("exit", onExit);
        if (this.cancelCoreReady === cancel) this.cancelCoreReady = null;
      };
      const onMessage = (message: unknown) => {
        if (!message || typeof message !== "object") return;
        const type = (message as { type?: unknown }).type;
        if (type === "kith:core-error") {
          const failure = parseCoreErrorMessage(message) ?? {
            code: "CORE_REPORTED_ERROR" as const,
            role: "core" as const,
            message: "Core reported an invalid error payload",
          };
          cleanup();
          reject(new DesktopProcessError(failure));
          return;
        }
        if (type !== "kith:core-ready") return;
        const ready = parseCoreReadyMessage(message);
        cleanup();
        if (ready) resolve(ready);
        else reject(new DesktopProcessError({
          code: "CORE_READY_INVALID",
          role: "core",
          message: "Core reported an invalid ready payload",
        }));
      };
      const onError = (error: Error) => {
        cleanup();
        reject(new DesktopProcessError({
          code: "PROCESS_SPAWN_ERROR",
          role: "core",
          message: `Core failed to start: ${error.message}`,
        }));
      };
      const onExit = (exitCode: number | null, signal: NodeJS.Signals | null) => {
        cleanup();
        reject(new DesktopProcessError({
          code: "PROCESS_EXITED",
          role: "core",
          message: `Core exited before reporting ready (code=${exitCode ?? "null"}, signal=${signal ?? "none"})`,
          exitCode,
          signal,
        }));
      };
      cancel = () => {
        cleanup();
        reject(new DesktopStartCancelledError());
      };

      child.on("message", onMessage);
      child.on("error", onError);
      child.on("exit", onExit);
      this.cancelCoreReady = cancel;
    });
  }

  private recordFailure(failure: ProcessFailure): void {
    this.lastFailure = failure;
    this.emitDiagnostic({ type: "process-failure", failure });
  }

  private emitDiagnostic(diagnostic: DesktopProcessDiagnostic): void {
    try {
      this.options.onDiagnostic?.(diagnostic);
    } catch {
      // Observers must not be able to change the supervised process lifecycle.
    }
  }

  private async terminateAll(): Promise<void> {
    const targets: Array<readonly [DesktopProcessRole, DesktopChildProcess]> = [];
    for (const role of ["vite", "worker", "core"] as const) {
      const child = this.children.get(role);
      if (!child) continue;
      this.expectedExits.add(child);
      targets.push([role, child]);
    }
    let firstFailure: DesktopProcessError | null = null;
    for (const [role, child] of targets) {
      try {
        await this.options.terminate(child, role);
        if (this.children.get(role) === child) this.children.delete(role);
      } catch (error) {
        firstFailure ??= new DesktopProcessError({
          code: "PROCESS_TERMINATION_ERROR",
          role,
          message: `${role} failed to terminate: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    if (firstFailure) throw firstFailure;
  }
}
