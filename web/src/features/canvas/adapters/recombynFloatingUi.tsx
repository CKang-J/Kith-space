import type { ComponentProps } from "react";
import { FloatingPortal as NativeFloatingPortal } from "@floating-ui/react";

export * from "@floating-ui/react";

const portalRoot = document.createElement("div");
portalRoot.dataset.recombynNativePortalRoot = "";
// Above the scene HTML overlay (z-[1000001]) so Floating UI menus remain clickable.
Object.assign(portalRoot.style, {
  position: "absolute",
  inset: "0",
  zIndex: "1000010",
  pointerEvents: "none",
});
const ROOT_SELECTOR = "[data-kith-canvas-root][data-recombyn-native-editor]";

export function getRecombynIslandRoot(): HTMLElement {
  const root = document.querySelector<HTMLElement>(ROOT_SELECTOR);
  if (!root) throw new Error("Recombyn Stage 1 island root is unavailable");
  return root;
}

export function getRecombynPortalRoot(): HTMLElement {
  return portalRoot;
}

export function attachRecombynPortalRoot(islandRoot: HTMLElement): () => void {
  islandRoot.appendChild(portalRoot);
  return () => portalRoot.remove();
}

export function FloatingPortal({ root, ...props }: ComponentProps<typeof NativeFloatingPortal>) {
  return <NativeFloatingPortal {...props} root={root ?? getRecombynPortalRoot()} />;
}
