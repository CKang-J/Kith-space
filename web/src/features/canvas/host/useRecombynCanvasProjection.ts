import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { applyCollabDocument, renameTemplate, setSelectedNodeIds } from "@recombyn-native/store/modules/editor";
import { store } from "@recombyn-native/store";
import { hydrateCanvasSnapshotMediaSrc, type CanvasCoreClient, type CanvasLibraryItem } from "@/features/canvas/adapters/canvasCoreApi";
import { connectRecombynCoreProjection, type RecombynCoreProjectionConnection } from "@/features/canvas/adapters/recombynCoreProjection";
import { survivingNodeSelection } from "@/features/canvas/adapters/recombynSelectionProjection";

export function useRecombynCanvasProjection(input: {
  canvasId: string;
  resourceKey: string;
  snapshot: CanvasLibraryItem;
  client: CanvasCoreClient;
  connectionRef: MutableRefObject<RecombynCoreProjectionConnection | null>;
}) {
  const { canvasId, resourceKey, snapshot, client, connectionRef } = input;
  const latestTitleRef = useRef(snapshot.title);
  latestTitleRef.current = snapshot.title;
  const connect = useCallback(() => {
    // Reconcile the shared upstream store as part of the resource-keyed Core
    // connection; the Stage1 harness can leave a template with the same id/name shape.
    store.dispatch(renameTemplate(snapshot.title));
    let pointerActive = false;
    const connection = connectRecombynCoreProjection(store, hydrateCanvasSnapshotMediaSrc(snapshot, snapshot.spaceId), {
      apply: async (operation) => hydrateCanvasSnapshotMediaSrc(await client.apply(canvasId, operation), snapshot.spaceId),
      reload: async () => hydrateCanvasSnapshotMediaSrc(await client.read(canvasId), snapshot.spaceId),
      history: async (kind, operationId, expectedRevision) => (
        hydrateCanvasSnapshotMediaSrc(await client[kind](canvasId, operationId, expectedRevision), snapshot.spaceId)
      ),
      project: (latest) => {
        const editor = (store.getState() as { editor?: { selectedNodeIds?: string[] } }).editor;
        const selectedNodeIds = survivingNodeSelection(editor?.selectedNodeIds ?? [], latest.document);
        store.dispatch(applyCollabDocument(latest.document));
        store.dispatch(renameTemplate(latest.title));
        if (selectedNodeIds.length !== (editor?.selectedNodeIds?.length ?? 0)) store.dispatch(setSelectedNodeIds(selectedNodeIds));
        if (latest.title !== latestTitleRef.current) {
          latestTitleRef.current = latest.title;
          window.dispatchEvent(new CustomEvent("kith:canvas-renamed", { detail: { canvasId, title: latest.title } }));
        }
      },
      reportError: (error) => console.error("Canvas Core projection recovered after an operation failure", error),
    }, { settleDelayMs: 120, interactionActive: () => pointerActive });
    const pointerDown = () => { pointerActive = true; };
    const pointerEnd = () => { pointerActive = false; connection.flush(); };
    window.addEventListener("pointerdown", pointerDown, true);
    window.addEventListener("pointerup", pointerEnd, true);
    window.addEventListener("pointercancel", pointerEnd, true);
    connectionRef.current = connection;
    return () => {
      if (connectionRef.current === connection) connectionRef.current = null;
      window.removeEventListener("pointerdown", pointerDown, true);
      window.removeEventListener("pointerup", pointerEnd, true);
      window.removeEventListener("pointercancel", pointerEnd, true);
      connection.disconnect();
    };
  }, [canvasId, client, connectionRef, resourceKey, snapshot]);
  const handleHistory = useCallback((kind: "undo" | "redo") => { void connectionRef.current?.history(kind); }, [connectionRef]);

  useEffect(() => {
    let renameTimer: number | null = null;
    const rename = (event: Event) => {
      const detail = (event as CustomEvent<{ title?: unknown; phase?: unknown }>).detail;
      if (typeof detail?.title !== "string") return;
      if (renameTimer !== null) window.clearTimeout(renameTimer);
      const commit = () => { void connectionRef.current?.rename(detail.title as string); };
      if (detail.phase === "commit") commit();
      else renameTimer = window.setTimeout(commit, 300);
    };
    const exportScene = (event: Event) => {
      const detail = (event as CustomEvent<{ complete?: Promise<"saved" | "cancelled" | "failed"> }>).detail;
      event.preventDefault();
      detail.complete = client.exportScene(canvasId).then((payload) => {
        const filename = `${payload.title.replace(/[\\/:*?"<>|]+/g, "_").trim() || "Canvas"}.canvas.json`;
        const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        return "saved" as const;
      }).catch((error) => {
        console.error("Canvas export failed", error);
        return "failed" as const;
      });
    };
    window.addEventListener("kith:canvas-title", rename);
    window.addEventListener("kith:canvas-export", exportScene);
    return () => {
      if (renameTimer !== null) window.clearTimeout(renameTimer);
      window.removeEventListener("kith:canvas-title", rename);
      window.removeEventListener("kith:canvas-export", exportScene);
    };
  }, [canvasId, client, connectionRef, resourceKey]);
  return { connect, handleHistory };
}
