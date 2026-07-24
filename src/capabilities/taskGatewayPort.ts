import type { schema } from "../db/index.js";
import type { TaskArtifactRef, TaskReportKind, TaskStatus } from "../tasks/taskTypes.js";
import type { SpaceTransaction } from "../counters.js";

type Message = typeof schema.messages.$inferSelect;
type Actor = { type: "agent"; id: string; name: string };
export type TaskWritePrecondition = (tx: SpaceTransaction, channelId: string) => void;

export interface TaskGatewayPort {
  create(input: {
    messageId: string;
    spaceId: string;
    channelId: string;
    actor: Actor;
    title: string;
    executionMode: "autopilot" | "plan-first";
    parentTaskId: string | null;
    writePrecondition: TaskWritePrecondition;
  }): Promise<Message>;
  claim(spaceId: string, taskId: string, agentId: string, expectedRevision: number | undefined, writePrecondition: TaskWritePrecondition): Promise<Message | null>;
  update(spaceId: string, taskId: string, status: TaskStatus, agentId: string, input: { from?: TaskStatus; expectedRevision?: number }, writePrecondition: TaskWritePrecondition): Promise<Message | null>;
  assign(spaceId: string, taskId: string, targetAgentId: string, agentId: string, expectedRevision: number | undefined, writePrecondition: TaskWritePrecondition): Promise<Message | null>;
  unclaim(spaceId: string, taskId: string, agentId: string, expectedRevision: number | undefined, writePrecondition: TaskWritePrecondition): Promise<Message | null>;
  details(spaceId: string, taskId: string): Promise<{ task: Message; parent: Message | null; children: Message[]; reports: Message[]; deliveries: Message[] } | null>;
  report(input: {
    messageId: string;
    spaceId: string;
    taskId: string;
    actor: Actor;
    kind: TaskReportKind;
    content: string;
    artifactRefs?: TaskArtifactRef[];
    writePrecondition: TaskWritePrecondition;
  }): Promise<{ task: Message; report: Message }>;
  deliver(input: {
    messageId: string;
    spaceId: string;
    taskId: string;
    actor: Actor;
    expectedRevision: number;
    summary: string;
    childTaskIds: string[];
    artifactRefs?: TaskArtifactRef[];
    writePrecondition: TaskWritePrecondition;
  }): Promise<{ task: Message; delivery: Message; children: Message[]; reportMessageIds: string[] }>;
}

let configured: TaskGatewayPort | null = null;

export function configureTaskGatewayPort(port: TaskGatewayPort): void {
  configured = port;
}

export function taskGatewayPort(): TaskGatewayPort {
  if (!configured) throw new Error("Task Gateway port is not configured");
  return configured;
}
