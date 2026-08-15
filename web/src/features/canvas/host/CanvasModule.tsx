import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { FilePlus2, LayoutDashboard, Trash2, Upload } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import emptyScene from "@/features/canvas/fixtures/recombyn-empty-scene.json";
import { canvasCoreApi, type CanvasLibraryItem } from "@/features/canvas/adapters/canvasCoreApi";
import { Button } from "@/components/ui/button";
import { useStore } from "@/store";
import { workspaceLocationForModule } from "@/shell/workspaceRoute";

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
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to load Canvases"); });
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
      const created = await client.create("Untitled Canvas", emptyScene);
      openCanvas(created);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create Canvas");
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
      setError(reason instanceof Error ? reason.message : "Unable to delete Canvas");
    } finally {
      setDeletingId(null);
    }
  };

  if (canvasId) return (
    <Suspense fallback={<div className="grid h-full place-items-center text-sm text-muted-foreground">Loading Canvas editor…</div>}>
      <NativeRecombynCanvas canvasId={canvasId} api={api} spaceId={spaceId} />
    </Suspense>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-5">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Canvas Library</h1>
          <p className="text-sm text-muted-foreground">Local canvases stored in this Space.</p>
        </div>
        <div className="flex items-center gap-2">
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
              void file.text().then((text) => client.importScene(file.name.replace(/\.json$/i, "") || "Imported Canvas", JSON.parse(text))).then(openCanvas)
                .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to import Canvas JSON"));
            }}
          />
          <Button type="button" variant="outline" onClick={() => importRef.current?.click()}>
            <Upload data-icon="inline-start" /> Import JSON
          </Button>
          <Button type="button" onClick={() => void createCanvas()} disabled={creating}>
            <FilePlus2 data-icon="inline-start" />
            {creating ? "Creating…" : "New Canvas"}
          </Button>
        </div>
      </header>
      {error ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
      {canvases.length === 0 ? (
        <button
          type="button"
          className="grid min-h-56 place-items-center rounded-xl border border-dashed border-border bg-muted/20 text-sm text-muted-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => void createCanvas()}
        >
          Create your first local Canvas
        </button>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {canvases.map((canvas) => (
            <div key={canvas.id} className="relative rounded-xl border border-border bg-card transition-colors hover:bg-muted/30">
              <button type="button" className="w-full p-4 pr-12 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => openCanvas(canvas)}>
                <div className="flex items-center gap-3">
                  <div className="grid size-9 place-items-center rounded-md bg-muted"><LayoutDashboard className="size-4" /></div>
                  <div className="truncate text-sm font-semibold">{canvas.title}</div>
                </div>
                <div className="mt-4 text-xs text-muted-foreground">Updated {new Date(canvas.updatedAt).toLocaleString()}</div>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${canvas.title}`}
                disabled={deletingId === canvas.id}
                className="absolute right-3 top-3 text-muted-foreground hover:text-destructive"
                onClick={() => void deleteCanvas(canvas)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
