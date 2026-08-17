import { X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CanvasLibraryThumbnail } from "@/features/canvas/host/CanvasLibraryThumbnail";
import { workspaceLocationForModule } from "@/shell/workspaceRoute";
import { cn } from "@/lib/utils";

export interface CanvasContextChipModel {
  canvasId: string;
  canvasTitle: string;
  summary: string;
  previewDocument?: unknown;
  projection?: {
    elements?: Array<Record<string, unknown>>;
    frames?: Array<Record<string, unknown>>;
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

export function CanvasContextChip({
  context,
  removable,
  onRemove,
}: {
  context: CanvasContextChipModel;
  removable?: boolean;
  onRemove?: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const available = context.canvasAvailable !== false;
  const preview = previewFrom(context);
  const openCanvas = () => {
    if (!available) return;
    navigate(workspaceLocationForModule(location.pathname, location.search, {
      moduleId: "canvas",
      canvas: context.canvasId,
      canvasTitle: context.canvasTitle,
    }));
  };

  return (
    <div className={cn(
      "relative flex max-w-64 min-w-40 items-stretch overflow-hidden rounded-[13px] border border-border bg-muted/40",
      !available && "opacity-70",
    )}>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-1.5 text-left text-foreground"
        onClick={openCanvas}
        aria-label={available ? `在画布中打开 ${context.canvasTitle}` : "画布不可用"}
      >
        <span className="size-11 shrink-0 overflow-hidden rounded-[10px]">
          {preview
            ? <CanvasLibraryThumbnail document={preview} title={context.canvasTitle} />
            : <span className="grid size-full place-items-center bg-muted text-[11px] text-muted-foreground">Canvas</span>}
        </span>
        <span className="min-w-0">
          <strong className="block truncate text-sm font-medium">{context.canvasTitle || "未命名画布"}</strong>
          <small className="block truncate text-[length:var(--font-size-meta)] text-muted-foreground">
            {available ? context.summary : "画布不可用"}
          </small>
        </span>
      </button>
      {removable ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute right-1 top-1 size-4 rounded-full bg-background/90 text-muted-foreground"
          aria-label={`移除 ${context.canvasTitle}`}
          onClick={onRemove}
        >
          <X className="size-2.5" />
        </Button>
      ) : null}
    </div>
  );
}
