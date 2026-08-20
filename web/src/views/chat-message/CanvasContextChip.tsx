import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CanvasSelectionThumbnail } from "@/features/canvas/host/CanvasSelectionThumbnail";
import { requestCanvasSelectionFocus } from "@/features/canvas/host/canvasSelectionFocus";
import { formatCanvasSelectionDetailI18n, type CanvasSelectionSummaryParts } from "@/features/canvas/host/canvasSelectionCopy";
import { previewDocumentFromCanvasSelection } from "@/features/canvas/host/canvasSelectionPreview";
import { workspaceLocationForModule } from "@/shell/workspaceRoute";
import { cn } from "@/lib/utils";

export type CanvasContextChipDensity = "full" | "medium" | "compact";

export interface CanvasContextChipModel {
  snapshotId?: string;
  canvasId: string;
  canvasTitle: string;
  summary?: string;
  summaryParts?: CanvasSelectionSummaryParts;
  documentRevision?: number;
  selectedIds?: string[];
  selectedElements?: Array<{ id: string; revision: number }>;
  selectedFrames?: Array<{ id: string; revision: number }>;
  previewDocument?: unknown;
  projection?: {
    elements?: Array<Record<string, unknown>>;
    frames?: Array<Record<string, unknown>>;
    wholeCanvas?: boolean;
    truncated?: boolean;
  } | unknown;
  canvasAvailable?: boolean;
}

function selectedIdsFrom(context: CanvasContextChipModel): { nodeIds: string[]; frameIds: string[] } {
  if (context.selectedIds?.length) {
    return {
      nodeIds: context.selectedIds.filter((id) => !id.startsWith("frame:")),
      frameIds: context.selectedIds.filter((id) => id.startsWith("frame:")).map((id) => id.slice("frame:".length)),
    };
  }
  return {
    nodeIds: (context.selectedElements ?? []).map((item) => item.id),
    frameIds: (context.selectedFrames ?? []).map((item) => item.id),
  };
}

function summaryPartsFrom(context: CanvasContextChipModel): CanvasSelectionSummaryParts {
  if (context.summaryParts) {
    return {
      ...context.summaryParts,
      documentRevision: context.documentRevision ?? context.summaryParts.documentRevision,
    };
  }
  const projection = context.projection && typeof context.projection === "object"
    ? context.projection as { elements?: unknown[]; frames?: unknown[]; wholeCanvas?: boolean; truncated?: boolean }
    : {};
  const selected = selectedIdsFrom(context);
  const frameCount = context.selectedFrames?.length ?? projection.frames?.length ?? selected.frameIds.length;
  const elementCount = context.selectedElements?.length ?? projection.elements?.length ?? selected.nodeIds.length;
  return {
    canvasTitle: context.canvasTitle,
    wholeCanvas: Boolean(projection.wholeCanvas) || (!elementCount && !frameCount),
    elementCount,
    frameCount,
    truncated: Boolean(projection.truncated),
    documentRevision: context.documentRevision ?? 0,
  };
}

export function canvasContextChipDensity(count: number): CanvasContextChipDensity {
  if (count <= 1) return "full";
  if (count === 2) return "medium";
  return "compact";
}

export function CanvasContextChip({
  context,
  removable,
  compact,
  density = "full",
  onRemove,
}: {
  context: CanvasContextChipModel;
  removable?: boolean;
  compact?: boolean;
  density?: CanvasContextChipDensity;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const available = context.canvasAvailable !== false;
  const preview = previewDocumentFromCanvasSelection(context);
  const selected = selectedIdsFrom(context);
  const selectionTokens = context.selectedIds?.length
    ? context.selectedIds
    : [
      ...selected.nodeIds,
      ...selected.frameIds.map((frameId) => `frame:${frameId}`),
    ];
  const title = context.canvasTitle?.trim() || t("chat.canvasUntitled");
  const parts = summaryPartsFrom(context);
  const selectionLabel = formatCanvasSelectionDetailI18n(parts, t);
  const revisionLabel = t("chat.canvasRevision", { revision: parts.documentRevision });
  const previewLabel = t("chat.canvasShowPreview");
  const viewLabel = available ? t("chat.canvasViewSelection") : t("chat.canvasViewSnapshot");
  const showRevision = Boolean(compact && !removable);
  const metaLine = available
    ? (showRevision ? `${selectionLabel} · ${revisionLabel}` : selectionLabel)
    : t("chat.canvasUnavailable");

  const openCanvas = () => {
    if (!available) return;
    const selected = selectedIdsFrom(context);
    requestCanvasSelectionFocus({
      canvasId: context.canvasId,
      nodeIds: selected.nodeIds,
      frameIds: selected.frameIds,
    });
    navigate(workspaceLocationForModule(location.pathname, location.search, {
      moduleId: "canvas",
      canvas: context.canvasId,
      canvasTitle: context.canvasTitle,
    }));
  };

  const previewNode = preview
    ? (
      <CanvasSelectionThumbnail
        document={preview}
        selectedIds={selectionTokens}
        title={title}
        maxEdge={density === "compact" ? 96 : density === "medium" ? 112 : 128}
      />
    )
    : <span className="canvas-context-chip__fallback">{t("chat.canvasName")}</span>;

  return (
    <div
      data-canvas-context-chip
      data-canvas-available={available ? "true" : "false"}
      data-canvas-density={density}
      className={cn(
        "attachment-card is-file is-canvas-context",
        density !== "full" && `is-density-${density}`,
        removable && "has-remove",
        !available && "is-unavailable",
      )}
      title={title}
    >
      <div className="attachment-card__body">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="canvas-context-chip__thumb-btn"
              aria-label={previewLabel}
              title={previewLabel}
            >
              {previewNode}
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            className="w-56 gap-2 border border-border/60 bg-card p-2 shadow-none ring-0"
          >
            <div className="canvas-context-chip__popover-preview">
              {previewNode}
            </div>
            <p className="truncate text-[length:var(--font-size-meta)] text-muted-foreground">{metaLine}</p>
          </PopoverContent>
        </Popover>
        <button
          type="button"
          className="canvas-context-chip__open"
          disabled={!available}
          aria-label={available ? t("chat.canvasOpenInCanvas", { title }) : viewLabel}
          onClick={openCanvas}
        >
          <strong>{title}</strong>
          <small>{metaLine}</small>
        </button>
      </div>
      {removable ? (
        <button
          type="button"
          className="attachment-card__remove"
          aria-label={t("chat.canvasRemoveContext", { title })}
          title={t("chat.canvasRemoveContext", { title })}
          onClick={(event) => {
            event.stopPropagation();
            onRemove?.();
          }}
        >
          <X size={10} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
