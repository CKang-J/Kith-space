/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/tooltip/TooltipManager.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
type CloseCallback = () => void;

class TooltipManager {
  private closeCallbacks: Set<CloseCallback> = new Set();

  register(close: CloseCallback) {
    this.closeCallbacks.add(close);
  }

  clear(close: CloseCallback) {
    this.closeCallbacks.delete(close);
  }

  closeAll() {
    this.closeCallbacks.forEach((close) => close());
    this.closeCallbacks.clear();
  }
}

export const tooltipManager = new TooltipManager();
