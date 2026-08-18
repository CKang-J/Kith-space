import { useLayoutEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { requestCanvasSelectionToChat } from "@/features/canvas/adapters/recombynSelectionToChat";
import {
  noteCanvasFlyOrigin,
} from "@recombyn-native/components/editor/panels/agent/flyToChat";
import { cn } from "@/lib/utils";

const EMPTY_IDS: string[] = [];

export function CanvasSendToChatHostAction({ canvasId }: { canvasId: string; canvasTitle?: string }) {
  const { t } = useTranslation();
  const selectedNodeIds = useSelector((state: { editor?: { selectedNodeIds?: string[] } }) => (
    state.editor?.selectedNodeIds ?? EMPTY_IDS
  ));
  const selectedFrameIds = useSelector((state: { editor?: { selectedFrameIds?: string[] } }) => (
    state.editor?.selectedFrameIds ?? EMPTY_IDS
  ));
  const hasSelection = selectedNodeIds.length > 0 || selectedFrameIds.length > 0;
  const hostRef = useRef<HTMLDivElement>(null);
  const [dock, setDock] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!hasSelection) {
      setDock(null);
      return;
    }
    const root = hostRef.current?.closest<HTMLElement>("[data-kith-canvas-root]");
    const sync = () => {
      const toolbar = root?.querySelector<HTMLElement>("[data-sel-toolbar]");
      if (!root || !toolbar) {
        setDock(null);
        return;
      }
      const toolbarBox = toolbar.getBoundingClientRect();
      const rootBox = root.getBoundingClientRect();
      // Measured overlay: sit just right of native SelectionContextToolbar / MultiSelectionToolbar.
      setDock({
        left: toolbarBox.right - rootBox.left + 8,
        top: toolbarBox.top - rootBox.top,
      });
    };
    sync();
    const resize = new ResizeObserver(sync);
    if (root) resize.observe(root);
    const mutation = new MutationObserver(sync);
    if (root) mutation.observe(root, { childList: true, subtree: true });
    window.addEventListener("resize", sync);
    return () => {
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [hasSelection, selectedFrameIds, selectedNodeIds]);

  if (!hasSelection) return null;

  const send = (event: { clientX: number; clientY: number }) => {
    noteCanvasFlyOrigin(event.clientX, event.clientY);
    const targets = [
      ...selectedNodeIds,
      ...selectedFrameIds.map((id) => `frame:${id}`),
    ];
    requestCanvasSelectionToChat(
      targets.length === 1 ? targets[0]! : targets,
      t("chat.canvasFlyLabel"),
    );
  };

  return (
    <div
      ref={hostRef}
      className={cn(
        "pointer-events-none absolute z-[80]",
        dock ? "left-0 top-0" : "inset-x-0 top-3 flex justify-center",
      )}
      style={dock ? { transform: `translate(${dock.left}px, ${dock.top}px)` } : undefined}
    >
      <button
        type="button"
        data-canvas-send-to-chat
        data-canvas-id={canvasId}
        className="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-full bg-background/95 px-3 text-sm text-foreground shadow-sm ring-1 ring-border hover:bg-muted"
        onClick={(event) => send(event)}
      >
        {t("chat.canvasSendToChat")}
      </button>
    </div>
  );
}
