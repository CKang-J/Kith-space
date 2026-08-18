import { useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CanvasLibraryThumbnail } from "@/features/canvas/host/CanvasLibraryThumbnail";
import { requestCanvasSelectionFocus } from "@/features/canvas/host/canvasSelectionFocus";
import { formatCanvasSelectionSummaryI18n, type CanvasSelectionSummaryParts } from "@/features/canvas/host/canvasSelectionCopy";
import { workspaceLocationForModule } from "@/shell/workspaceRoute";
import { cn } from "@/lib/utils";

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

function previewFrom(context: CanvasContextChipModel): unknown {
  if (context.previewDocument) return context.previewDocument;
  const projection = context.projection;
  if (!projection || typeof projection !== "object") return null;
  const record = projection as { elements?: Array<Record<string, unknown>>; frames?: Array<Record<string, unknown>> };
  if (!Array.isArray(record.elements) && !Array.isArray(record.frames)) return projection;
  const elements = record.elements ?? [];
  const deltaSetLike: Record<string, unknown> = {
    ROOT: { children: elements.map((element) => element.id).filter((id): id is string => typeof id === "string") },
  };
  for (const element of elements) {
    if (typeof element.id === "string") deltaSetLike[element.id] = element;
  }
  return { deltaSetLike, frames: record.frames ?? [] };
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

export function CanvasContextChip({
  context,
  removable,
  onRemove,
}: {
  context: CanvasContextChipModel;
  removable?: boolean;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [expanded, setExpanded] = useState(false);
  const available = context.canvasAvailable !== false;
  const preview = previewFrom(context);
  const title = context.canvasTitle?.trim() || t("chat.canvasUntitled");
  const summary = formatCanvasSelectionSummaryI18n(summaryPartsFrom(context), t);
  const openCanvas = () => {
    const selected = selectedIdsFrom(context);
    if (available) {
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
      return;
    }
    setExpanded(true);
  };

  return (
    <div
      data-canvas-context-chip
      data-canvas-available={available ? "true" : "false"}
      className={cn(
        "relative flex max-w-72 min-w-44 flex-col overflow-hidden rounded-[13px] border border-border bg-muted/40",
        !available && "opacity-80",
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-1.5 text-left text-foreground"
        onClick={openCanvas}
        aria-label={available ? t("chat.canvasOpenInCanvas", { title }) : t("chat.canvasUnavailable")}
      >
        <span className="size-11 shrink-0 overflow-hidden rounded-[10px]">
          {preview
            ? <CanvasLibraryThumbnail document={preview} title={title} />
            : <span className="grid size-full place-items-center bg-muted text-[11px] text-muted-foreground">{t("chat.canvasName")}</span>}
        </span>
        <span className="min-w-0">
          <strong className="block truncate text-sm font-medium">{title}</strong>
          <small className="block truncate text-[length:var(--font-size-meta)] text-muted-foreground">
            {available ? summary : t("chat.canvasUnavailable")}
          </small>
        </span>
      </button>
      <div className="flex items-center gap-1 px-1.5 pb-1.5">
        <button
          type="button"
          className="rounded-md px-1.5 py-0.5 text-[length:var(--font-size-meta)] text-muted-foreground hover:bg-muted"
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? t("chat.canvasHidePreview") : t("chat.canvasShowPreview")}
        </button>
        <button
          type="button"
          className="rounded-md px-1.5 py-0.5 text-[length:var(--font-size-meta)] text-muted-foreground hover:bg-muted"
          onClick={openCanvas}
        >
          {available ? t("chat.canvasViewSelection") : t("chat.canvasViewSnapshot")}
        </button>
      </div>
      {expanded ? (
        <div className="border-t border-border p-1.5">
          <div className="h-28 overflow-hidden rounded-[10px] bg-muted">
            {preview
              ? <CanvasLibraryThumbnail document={preview} title={title} />
              : <span className="grid size-full place-items-center text-[11px] text-muted-foreground">{t("chat.canvasName")}</span>}
          </div>
        </div>
      ) : null}
      {removable ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute right-1 top-1 size-4 rounded-full bg-background/90 text-muted-foreground"
          aria-label={t("chat.canvasRemoveContext", { title })}
          onClick={onRemove}
        >
          <X className="size-2.5" />
        </Button>
      ) : null}
    </div>
  );
}
