import { parseCanvasSelectionInput } from "../canvas/canvasSelectionSnapshot.js";
import type { CanvasSelectionInput } from "../canvas/canvasTypes.js";
import {
  MessageExecutionBindingError,
  parseExecutionBinding,
  type MessageExecutionBindingInput,
} from "./messageExecutionBinding.js";

export function parseRequiredCanvasSelection(value: unknown): CanvasSelectionInput | undefined {
  if (value == null) return undefined;
  const parsed = parseCanvasSelectionInput(value);
  if (!parsed) throw new MessageExecutionBindingError("INVALID_ARGUMENT", "canvas selection is invalid");
  return parsed;
}

export function parseOptionalExecutionBinding(value: unknown): MessageExecutionBindingInput | null {
  if (value == null) return null;
  const parsed = parseExecutionBinding(value);
  if (!parsed) throw new MessageExecutionBindingError("INVALID_ARGUMENT", "execution binding is invalid");
  return parsed;
}
