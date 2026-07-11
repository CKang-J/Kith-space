import type { InternalProcessCredentials } from "../local-runtime/internalCredentials.js";

export type DesktopProcessRole = "core" | "worker" | "vite";
export type BrowserMode = "off" | "local" | "lan";

export type DesktopProcessCommand = Readonly<{
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: Readonly<NodeJS.ProcessEnv>;
}>;

export type DesktopProcessCommands = Readonly<{
  core: DesktopProcessCommand;
  worker: DesktopProcessCommand;
  vite?: DesktopProcessCommand;
}>;

export type CoreReadyInfo = Readonly<{
  host: string;
  port: number;
  browserMode: BrowserMode;
}>;

export type DesktopSpawnRequest = Readonly<{
  role: DesktopProcessRole;
  command: string;
  args: readonly string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
  ipc: boolean;
}>;

export interface DesktopChildProcess {
  readonly pid?: number;
  readonly exitCode: number | null;
  readonly killed: boolean;
  on(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  removeListener(event: string, listener: (...args: any[]) => void): this;
  send?(message: unknown, callback?: (error: Error | null) => void): boolean;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export type DesktopChildSpawner = (request: DesktopSpawnRequest) => DesktopChildProcess;
export type DesktopChildTerminator = (
  child: DesktopChildProcess,
  role: DesktopProcessRole,
) => Promise<void>;

export type SupervisorFailureCode =
  | "CORE_READY_TIMEOUT"
  | "CORE_READY_INVALID"
  | "CORE_REPORTED_ERROR"
  | "PROCESS_SPAWN_ERROR"
  | "PROCESS_EXITED"
  | "PROCESS_TERMINATION_ERROR";

export type ProcessFailure = Readonly<{
  code: SupervisorFailureCode;
  role: DesktopProcessRole;
  message: string;
  reportedCode?: string;
  port?: number;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
}>;

export type DesktopProcessDiagnostic =
  | Readonly<{ type: "core-ready"; ready: CoreReadyInfo }>
  | Readonly<{ type: "process-failure"; failure: ProcessFailure }>;

export type SupervisorState = "idle" | "starting" | "running" | "stopping" | "failed";

export type SupervisorSnapshot = Readonly<{
  state: SupervisorState;
  core: CoreReadyInfo | null;
  running: readonly DesktopProcessRole[];
  lastFailure: ProcessFailure | null;
}>;

export class DesktopProcessError extends Error {
  constructor(readonly failure: ProcessFailure) {
    super(failure.message);
    this.name = "DesktopProcessError";
  }
}

export type DesktopProcessSupervisorOptions = Readonly<{
  kithSpaceHome: string;
  commands: DesktopProcessCommands;
  spawn?: DesktopChildSpawner;
  terminate?: DesktopChildTerminator;
  parentEnv?: Readonly<NodeJS.ProcessEnv>;
  credentials?: () => InternalProcessCredentials;
  coreReadyTimeoutMs?: number;
  onDiagnostic?: (diagnostic: DesktopProcessDiagnostic) => void;
}>;
