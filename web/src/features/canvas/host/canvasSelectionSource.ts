import { createContext, createElement, useContext, type ReactNode } from "react";

const CanvasSelectionSourceContext = createContext<string | null>(null);

export function CanvasSelectionSourceProvider({
  canvasId,
  children,
}: {
  canvasId: string;
  children: ReactNode;
}) {
  return createElement(CanvasSelectionSourceContext.Provider, { value: canvasId }, children);
}

export function useCanvasSelectionSourceId(): string {
  return useContext(CanvasSelectionSourceContext)?.trim() || "";
}
