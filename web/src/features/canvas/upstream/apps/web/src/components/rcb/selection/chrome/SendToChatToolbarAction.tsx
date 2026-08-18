/*
 * Kith-space Stage 3: native selection-toolbar action that reuses the
 * existing kith:canvas-selection-to-chat seam. Not an upstream Recombyn file.
 */
import { useTranslation } from "react-i18next";
import { requestCanvasSelectionToChat } from "@/features/canvas/adapters/recombynSelectionToChat";
import { noteCanvasFlyOrigin } from "@/features/canvas/adapters/canvasFlyToChat";
import { useCanvasSelectionSourceId } from "@/features/canvas/host/canvasSelectionSource";
import { cn } from "@recombyn-native/utils/classnames";

export { canvasToolbarChatTargets } from "@/features/canvas/host/canvasChatBridge";

export function SendToChatToolbarAction({
  target,
}: {
  target: string | string[];
}) {
  const { t } = useTranslation();
  const canvasId = useCanvasSelectionSourceId();
  const label = t("chat.canvasSendToChat");
  const empty = Array.isArray(target) ? target.length === 0 : !target;

  return (
    <button
      type="button"
      data-canvas-send-to-chat
      aria-label={label}
      disabled={empty}
      className={cn(
        "inline-flex h-7 shrink-0 items-center rounded-full border border-[var(--line)] bg-transparent px-2.5 text-[12px] leading-none text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)]",
        empty && "pointer-events-none opacity-50",
      )}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (empty) return;
        if (!canvasId) return;
        noteCanvasFlyOrigin(event.clientX, event.clientY);
        requestCanvasSelectionToChat(target, t("chat.canvasFlyLabel"), { canvasId });
      }}
    >
      {label}
    </button>
  );
}
