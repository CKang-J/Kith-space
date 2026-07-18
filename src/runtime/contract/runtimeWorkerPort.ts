export type AdmissionStatus = "admitted" | "queued" | "rejected";
export type WorkerCommandSource = "wake" | "manual" | "lifecycle";

export interface WorkerDelivery {
  seq: number;
  from: string;
  target: string;
  targetName: string;
  msgShort: string;
  isTask: boolean;
  mentioned: boolean;
  streamId?: string;
  responseDirective: "required" | "optional";
  responseReason: string;
}

interface WorkerCommandBase {
  spaceId: string;
  agentId: string;
}

export interface WakeStartCommand extends WorkerCommandBase {
  type: "agent:start";
  source: "wake";
  deliveryId: string;
  config: unknown;
  reason: "wake";
  delivery: WorkerDelivery;
}

export interface ManualStartCommand extends WorkerCommandBase {
  type: "agent:start";
  source: "manual";
  commandId: string;
  config: unknown;
  reason: "manual" | "create";
}

export interface WakeDeliveryCommand extends WorkerCommandBase, WorkerDelivery {
  type: "agent:deliver";
  source: "wake";
  deliveryId: string;
}

export interface StopCommand extends WorkerCommandBase {
  type: "agent:stop" | "agent:sleep";
  source: "lifecycle";
  commandId: string;
}

export interface ResetCommand extends WorkerCommandBase {
  type: "agent:reset";
  source: "lifecycle";
  commandId: string;
  workspaceRoot: string;
  clearAgentMemory: boolean;
}

export type RuntimeWorkerCommand =
  | WakeStartCommand
  | ManualStartCommand
  | WakeDeliveryCommand
  | StopCommand
  | ResetCommand;

export type WorkerAdmissionCommand = RuntimeWorkerCommand & { generation: number };

export interface AdmissionResult {
  status: AdmissionStatus;
  id: string;
  generation: number;
  reason?: string;
}

export type QueueTerminalStatus = "completed" | "cancelled" | "expired" | "failed";

export interface WorkerQueueOutcome {
  id: string;
  source: WorkerCommandSource;
  generation: number;
  spaceId: string;
  agentId: string;
  status: QueueTerminalStatus;
  queuedMs: number;
  reason?: string;
}

export interface RuntimeWorkerAvailability {
  connected: boolean;
  generation: number | null;
}

export interface RuntimeWorkerPort {
  start(command: WakeStartCommand | ManualStartCommand): Promise<AdmissionResult>;
  deliver(command: WakeDeliveryCommand): Promise<AdmissionResult>;
  stop(command: StopCommand): Promise<AdmissionResult>;
  reset(command: ResetCommand): Promise<AdmissionResult>;
  availability(): RuntimeWorkerAvailability;
}

export function workerCommandId(command: Pick<RuntimeWorkerCommand, "source"> & Partial<Pick<WakeStartCommand, "deliveryId"> & Pick<ManualStartCommand, "commandId">>): string {
  const id = command.source === "wake" ? command.deliveryId : command.commandId;
  if (!id) throw new Error(`${command.source} Worker command is missing its stable id`);
  return id;
}
