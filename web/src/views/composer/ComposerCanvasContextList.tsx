import { type WheelEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  CanvasContextChip,
  canvasContextChipDensity,
  type CanvasContextChipModel,
} from "../chat-message/CanvasContextChip.tsx";

export interface ComposerCanvasContextItem extends CanvasContextChipModel {
  id: string;
}

interface ComposerCanvasContextListProps {
  contexts: ComposerCanvasContextItem[];
  onRemove(id: string): void;
}

function scrollStripHorizontally(event: WheelEvent<HTMLDivElement>) {
  const element = event.currentTarget;
  if (element.scrollWidth <= element.clientWidth + 1) return;
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
  event.preventDefault();
  element.scrollLeft += event.deltaY;
}

export function ComposerCanvasContextList({ contexts, onRemove }: ComposerCanvasContextListProps) {
  const { t } = useTranslation();
  if (!contexts.length) return null;

  const density = canvasContextChipDensity(contexts.length);

  return (
    <div
      className="composer-canvas-context-scroll"
      data-canvas-context-list
      data-canvas-count={contexts.length}
      aria-label={t("chat.canvasPendingSelections", { count: contexts.length })}
      onWheel={scrollStripHorizontally}
    >
      {contexts.map((item) => (
        <CanvasContextChip
          key={item.id}
          compact
          density={density}
          context={{
            canvasId: item.canvasId,
            canvasTitle: item.canvasTitle,
            summaryParts: item.summaryParts,
            documentRevision: item.documentRevision,
            selectedIds: item.selectedIds,
            previewDocument: item.previewDocument,
            canvasAvailable: true,
          }}
          removable
          onRemove={() => onRemove(item.id)}
        />
      ))}
    </div>
  );
}
