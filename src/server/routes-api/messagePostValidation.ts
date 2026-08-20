import { normalizeTaskExecutionMode, type TaskExecutionMode } from "../dispatchGuard.js";

export const HUMAN_MESSAGE_CONTENT_REQUIRED =
  "channelId + content, attachmentIds, or canvas selection required";
export const TASK_EXECUTION_MODE_REQUIRED = "executionMode must be autopilot or plan-first";
export const CANVAS_TASK_FORBIDDEN = "Canvas context cannot be sent as a task";
export const EXECUTION_BINDING_REQUIRES_CANVAS =
  "executionBinding requires canvasSelection or canvasSelections";

export function inspectHumanMessagePost(body: Record<string, unknown>): {
  hasAtt: boolean;
  hasCanvas: boolean;
  hasBinding: boolean;
  mode: TaskExecutionMode | null;
} {
  const attachmentIds = body.attachmentIds;
  const canvasSelections = body.canvasSelections;
  return {
    hasAtt: Array.isArray(attachmentIds) && attachmentIds.length > 0,
    hasCanvas: Boolean(body.canvasSelection)
      || (Array.isArray(canvasSelections) && canvasSelections.length > 0),
    hasBinding: body.executionBinding != null,
    mode: normalizeTaskExecutionMode(body.taskExecutionMode ?? body.executionMode),
  };
}

export function validateHumanMessagePost(body: Record<string, unknown>): string | null {
  const { hasAtt, hasCanvas, hasBinding, mode } = inspectHumanMessagePost(body);
  if (!body.channelId || (!body.content && !hasAtt && !hasCanvas)) return HUMAN_MESSAGE_CONTENT_REQUIRED;
  if (body.asTask && !mode) return TASK_EXECUTION_MODE_REQUIRED;
  if (body.asTask && hasCanvas) return CANVAS_TASK_FORBIDDEN;
  if (hasBinding && !hasCanvas) return EXECUTION_BINDING_REQUIRES_CANVAS;
  if (body.memoryPolicy !== undefined && body.memoryPolicy !== "eligible" && body.memoryPolicy !== "exclude") {
    return "memoryPolicy must be eligible or exclude";
  }
  return null;
}
