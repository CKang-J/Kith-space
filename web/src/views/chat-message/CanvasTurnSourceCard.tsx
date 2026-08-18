import { workspaceLocationForModule } from "@/shell/workspaceRoute";
import { CanvasLibraryThumbnail } from "@/features/canvas/host/CanvasLibraryThumbnail";
import { requestCanvasSelectionFocus } from "@/features/canvas/host/canvasSelectionFocus";
import { formatCanvasSelectionSummaryI18n } from "@/features/canvas/host/canvasSelectionCopy";

type Translate = (key: string, options?: Record<string, unknown>) => string;

function previewFrom(projection: unknown): unknown {
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

export function CanvasTurnSourceCard({
  source,
  t,
  onOpen,
}: {
  source: {
    sourceKind: string;
    sourceId: string;
    snapshotId?: string | null;
    content?: unknown;
    state: string;
    reason: string;
    injectionMode: string;
    projection: string;
    estimatedTokens: number;
  };
  t: Translate;
  onOpen: (canvasId: string, canvasTitle: string) => void;
}) {
  const payload = source.content && typeof source.content === "object"
    ? source.content as {
      snapshotId?: string;
      canvasId?: string;
      canvasTitle?: string;
      documentRevision?: number;
      selectedElementCount?: number;
      selectedFrameCount?: number;
      selectedElements?: Array<{ id: string }>;
      selectedFrames?: Array<{ id: string }>;
      summary?: string;
      projection?: { wholeCanvas?: boolean; truncated?: boolean; elements?: unknown[]; frames?: unknown[] };
      canvasAvailable?: boolean;
      liveReadWrite?: string;
      deepLink?: { canvas?: string };
    }
    : {};
  const available = payload.canvasAvailable !== false && payload.liveReadWrite !== "fail_closed";
  const title = payload.canvasTitle?.trim() || t("chat.canvasUntitled");
  const summary = formatCanvasSelectionSummaryI18n({
    canvasTitle: title,
    wholeCanvas: Boolean(payload.projection?.wholeCanvas),
    elementCount: payload.selectedElementCount ?? payload.selectedElements?.length ?? payload.projection?.elements?.length ?? 0,
    frameCount: payload.selectedFrameCount ?? payload.selectedFrames?.length ?? payload.projection?.frames?.length ?? 0,
    truncated: Boolean(payload.projection?.truncated),
    documentRevision: payload.documentRevision ?? 0,
  }, t);
  const canvasId = payload.canvasId || payload.deepLink?.canvas;
  const preview = previewFrom(payload.projection);
  const open = () => {
    if (!available || !canvasId) return;
    requestCanvasSelectionFocus({
      canvasId,
      nodeIds: (payload.selectedElements ?? []).map((item) => item.id),
      frameIds: (payload.selectedFrames ?? []).map((item) => item.id),
    });
    onOpen(canvasId, title);
  };

  return (
    <section className="turn-details-card" data-canvas-turn-source data-canvas-available={available ? "true" : "false"}>
      <div className="turn-details-card-head">
        <strong>{t("chat.canvasContextSource")}</strong>
        <span className={`turn-source-state is-${source.state}`}>{source.state}</span>
      </div>
      <div className="turn-details-meta">{source.reason} · {source.injectionMode} · {source.projection} · ~{source.estimatedTokens} tokens</div>
      <dl className="mt-2 grid gap-1 text-[length:var(--font-size-meta)] text-muted-foreground">
        <div>{t("chat.canvasSnapshotId")}: <code>{payload.snapshotId || source.snapshotId || source.sourceId}</code></div>
        <div>{t("chat.canvasName")}: {title}</div>
        <div>{summary}</div>
        <div>{t("chat.canvasRevision", { revision: payload.documentRevision ?? "—" })}</div>
        <div>{t("chat.canvasLiveLink")}: {available ? t("chat.canvasLiveSnapshotOnly") : t("chat.canvasUnavailable")}</div>
        {payload.liveReadWrite ? <div>{t("chat.canvasLiveMode", { mode: payload.liveReadWrite })}</div> : null}
      </dl>
      {preview ? (
        <div className="mt-2 h-24 overflow-hidden rounded-[10px] bg-muted">
          <CanvasLibraryThumbnail document={preview} title={title} />
        </div>
      ) : null}
      {canvasId ? (
        <button
          type="button"
          className="mt-2 rounded-md px-1.5 py-0.5 text-[length:var(--font-size-meta)] text-muted-foreground hover:bg-muted disabled:opacity-50"
          disabled={!available}
          onClick={open}
        >
          {available ? t("chat.canvasViewSelection") : t("chat.canvasUnavailable")}
        </button>
      ) : null}
    </section>
  );
}

export function canvasTurnOpenLocation(pathname: string, search: string, canvasId: string, canvasTitle: string) {
  return workspaceLocationForModule(pathname, search, { moduleId: "canvas", canvas: canvasId, canvasTitle });
}
