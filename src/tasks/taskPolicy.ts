import { TaskOperationError, type TaskStatus } from "./taskTypes.js";

export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  todo: ["in_progress", "closed"],
  in_progress: ["todo", "in_review", "closed"],
  in_review: ["in_progress", "done", "closed"],
  done: ["in_progress"],
  closed: ["todo"],
};

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || TASK_TRANSITIONS[from].includes(to);
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (canTransitionTask(from, to)) return;
  throw new TaskOperationError("INVALID_TRANSITION", `task cannot transition from ${from} to ${to}`);
}
