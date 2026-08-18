import { parseCanvasSelectionInput } from "../canvas/canvasSelectionSnapshot.js";
import type { CanvasSelectionInput } from "../canvas/canvasTypes.js";
import {
  MessageExecutionBindingError,
  parseExecutionBinding,
  type MessageExecutionBindingInput,
} from "./messageExecutionBinding.js";

export function parseRequiredCanvasSelections(value: unknown): CanvasSelectionInput[] | undefined {
  if (value == null) return undefined;
  const items = Array.isArray(value) ? value : [value];
  if (!items.length) return undefined;
  const parsed = items.map((item) => parseCanvasSelectionInput(item));
  if (parsed.some((item) => !item)) {
    throw new MessageExecutionBindingError("INVALID_ARGUMENT", "canvas selection is invalid");
  }
  return parsed as CanvasSelectionInput[];
}

export function parseRequiredCanvasSelection(value: unknown): CanvasSelectionInput | undefined {
  return parseRequiredCanvasSelections(value)?.[0];
}

export function parseOptionalExecutionBinding(value: unknown): MessageExecutionBindingInput | null {
  if (value == null) return null;
  const parsed = parseExecutionBinding(value);
  if (!parsed) throw new MessageExecutionBindingError("INVALID_ARGUMENT", "execution binding is invalid");
  return parsed;
}
