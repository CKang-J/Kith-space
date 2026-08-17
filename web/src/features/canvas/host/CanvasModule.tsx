import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import emptyScene from "@/features/canvas/fixtures/recombyn-empty-scene.json";
import { canvasCoreApi, type CanvasLibraryItem } from "@/features/canvas/adapters/canvasCoreApi";
import { Button } from "@/components/ui/button";
import { useStore } from "@/store";
import { workspaceLocationForModule } from "@/shell/workspaceRoute";
import { CanvasLibraryThumbnail } from "./CanvasLibraryThumbnail";
import { formatCanvasUpdatedAt } from "./canvasLibraryPresentation";

const NativeRecombynCanvas = lazy(() => import("./NativeRecombynCanvasHarness").then((module) => ({ default: module.NativeRecombynCanvas })));

export function CanvasModule({ canvasId }: { canvasId: string | null }) {
  const { api, spaceId } = useStore();
  const location = useLocation();
  const navigate = useNavigate();
  const client = canvasCoreApi(api);
  const [canvases, setCanvases] = useState<CanvasLibraryItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (canvasId) return;
    let cancelled = false;
    void client.list().then((items) => { if (!cancelled) { setCanvases(items); setError(null); } })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "无法加载画布"); });
    return () => { cancelled = true; };
  }, [canvasId, spaceId]);

  const openCanvas = (canvas: Pick<CanvasLibraryItem, "id" | "title">) => {
    navigate(workspaceLocationForModule(location.pathname, location.search, {
      moduleId: "canvas",
      canvas: canvas.id,
      canvasTitle: canvas.title,
    }));
  };

  const createCanvas = async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await client.create("未命名画布", emptyScene);
      openCanvas(created);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法新建画布");
    } finally {
      setCreating(false);
    }
  };

  const deleteCanvas = async (canvas: CanvasLibraryItem) => {
    if (deletingId) return;
    setDeletingId(canvas.id);
    setError(null);
    try {
      await client.deleteCanvas(canvas.id, canvas.revisions.revision);
      setCanvases((items) => items.filter((item) => item.id !== canvas.id));
      window.dispatchEvent(new CustomEvent("kith:canvas-deleted", { detail: { canvasId: canvas.id } }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法删除画布");
    } finally {
      setDeletingId(null);
    }
  };

  if (canvasId) return (
    <Suspense fallback={<div className="grid h-full place-items-center text-sm text-muted-foreground">正在加载画布编辑器…</div>}>
      <NativeRecombynCanvas canvasId={canvasId} api={api} spaceId={spaceId} />
    </Suspense>
  );

  return (
    <div className="h-full min-h-0 w-full flex-1 overflow-auto bg-white px-6 py-7 dark:bg-background sm:px-8 lg:px-10">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-7">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">我的画布</h1>
            <p className="mt-1 text-sm text-muted-foreground">保存在当前空间中的本地画布</p>
          </div>
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!file) return;
              setError(null);
              void file.text().then((text) => client.importScene(file.name.replace(/\.json$/i, "") || "导入的画布", JSON.parse(text))).then(openCanvas)
                .catch((reason) => setError(reason instanceof Error ? reason.message : "无法导入画布 JSON"));
            }}
          />
          <Button type="button" variant="outline" onClick={() => importRef.current?.click()} className="rounded-lg">
            <Upload data-icon="inline-start" /> 导入 JSON
          </Button>
        </header>
        {error ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-x-5 gap-y-8">
          <button
            type="button"
            disabled={creating}
            className="group block w-full min-w-0 self-start border-0 bg-transparent p-0 text-left text-foreground focus-visible:outline-none"
            onClick={() => void createCanvas()}
          >
            <span className="grid aspect-video place-items-center rounded-xl border border-dashed border-border bg-muted/30 text-muted-foreground transition-colors group-hover:border-foreground/30 group-hover:bg-muted/50 group-hover:text-foreground group-focus-visible:ring-2 group-focus-visible:ring-ring">
              <Plus aria-hidden className="size-11 stroke-[1.25]" />
            </span>
            <span className="mt-3 block text-base font-semibold text-foreground">{creating ? "正在新建…" : "新建画布"}</span>
          </button>
          {canvases.map((canvas) => (
            <article key={canvas.id} className="group relative min-w-0 self-start">
              <button type="button" className="block w-full border-0 bg-transparent p-0 text-left text-foreground focus-visible:outline-none" onClick={() => openCanvas(canvas)}>
                <span className="block aspect-video rounded-xl group-focus-within:ring-2 group-focus-within:ring-ring">
                  <CanvasLibraryThumbnail document={canvas.document} title={canvas.title || "未命名画布"} />
                </span>
                <span className="mt-3 block truncate text-base font-semibold text-foreground">{canvas.title || "未命名画布"}</span>
                <span className="mt-1 block !text-[12px] leading-4 text-muted-foreground">{formatCanvasUpdatedAt(canvas.updatedAt)}</span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`删除${canvas.title || "未命名画布"}`}
                disabled={deletingId === canvas.id}
                className="absolute right-2 top-2 bg-background/85 text-muted-foreground opacity-0 shadow-sm backdrop-blur-sm transition-opacity hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100"
                onClick={() => void deleteCanvas(canvas)}
              >
                <Trash2 />
              </Button>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
