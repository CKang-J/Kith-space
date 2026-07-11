export const TASK_STATUS_OPTIONS = ["todo", "in_progress", "in_review", "done", "closed"] as const;

export function taskStatusOptions(): string[] {
  return [...TASK_STATUS_OPTIONS];
}
