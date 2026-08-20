import type { ReactNode } from "react";
import { createPortal as nativeCreatePortal } from "react-dom";
import { getRecombynPortalRoot } from "@/features/canvas/adapters/recombynFloatingUi";

export * from "react-dom";

export function createPortal(children: ReactNode, container: Element | DocumentFragment, key?: null | string) {
  const target = container === document.body ? getRecombynPortalRoot() : container;
  return nativeCreatePortal(children, target, key);
}
