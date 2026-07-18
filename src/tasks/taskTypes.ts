export const TASK_STATUSES = ["todo", "in_progress", "in_review", "done", "closed"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskReportKind = "progress" | "blocker" | "question" | "result";

export interface TaskArtifactRef {
  kind: "file" | "url" | "message";
  ref: string;
  label?: string;
}

export type TaskActionMetadata =
  | {
      kind: "task-report";
      taskId: string;
      reportKind: TaskReportKind;
      artifactRefs: TaskArtifactRef[];
    }
  | {
      kind: "task-delivery";
      taskId: string;
      childTaskIds: string[];
      sourceThreadIds: string[];
      reportMessageIds: string[];
      artifactRefs: TaskArtifactRef[];
    };

export type TaskErrorCode = "INVALID_ARGUMENT" | "NOT_FOUND" | "CONFLICT" | "INVALID_TRANSITION";

export class TaskOperationError extends Error {
  constructor(
    readonly code: TaskErrorCode,
    message: string,
    readonly current?: { id: string; status: string | null; revision: number; assigneeId: string | null },
  ) {
    super(message);
    this.name = "TaskOperationError";
  }
}

export function isTaskOperationError(error: unknown): error is TaskOperationError {
  return error instanceof TaskOperationError;
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return (TASK_STATUSES as readonly unknown[]).includes(value);
}

export function parseTaskActionMetadata(value: unknown): TaskActionMetadata | null {
  if (!value || typeof value !== "object") return null;
  const metadata = value as { kind?: unknown; taskId?: unknown };
  if ((metadata.kind === "task-report" || metadata.kind === "task-delivery") && typeof metadata.taskId === "string") {
    return value as TaskActionMetadata;
  }
  return null;
}
