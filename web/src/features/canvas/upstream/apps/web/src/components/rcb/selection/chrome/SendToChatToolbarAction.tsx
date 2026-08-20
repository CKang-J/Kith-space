/*
 * Kith-space Stage 3: native selection-toolbar action that reuses the
 * existing kith:canvas-selection-to-chat seam. Not an upstream Recombyn file.
 */
import { MessageCircleMore } from "lucide-react";
import { useTranslation } from "react-i18next";
import Tooltip from "@recombyn-native/components/base/tooltip";
import { requestCanvasSelectionToChat } from "@/features/canvas/adapters/recombynSelectionToChat";
import { useCanvasSelectionSourceId } from "@/features/canvas/host/canvasSelectionSource";
import { SEL_TOOL_BTN } from "./ToolbarValueSlider";
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
    <Tooltip tip={label} placement="top">
      <button
        type="button"
        data-canvas-send-to-chat
        aria-label={label}
        disabled={empty}
        className={cn(
          SEL_TOOL_BTN,
          "h-7 gap-1.5 rounded-full px-2.5 font-medium",
          "bg-[var(--accent-soft)]/55 hover:bg-[var(--accent-soft)]",
          empty && "pointer-events-none opacity-50",
        )}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (empty) return;
          if (!canvasId) return;
          requestCanvasSelectionToChat(target, { canvasId });
        }}
      >
        <MessageCircleMore className="size-3.5 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden />
        <span>{label}</span>
      </button>
    </Tooltip>
  );
}
