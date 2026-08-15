import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { io } from "socket.io-client";
import { canvasCoreApi, type CanvasLibraryItem, type KithApi } from "@/features/canvas/adapters/canvasCoreApi";
import { isDeletedCanvasRecovery } from "@/features/canvas/adapters/canvasRecovery";
import type { RecombynCoreProjectionConnection } from "@/features/canvas/adapters/recombynCoreProjection";

export function useCanvasCoreResource(canvasId: string, spaceId: string, api: KithApi) {
  const apiRef = useRef(api);
  apiRef.current = api;
  const client = useMemo(() => canvasCoreApi((method, requestPath, body) => apiRef.current(method, requestPath, body)), []);
  const resourceKey = `${spaceId}:${canvasId}`;
  const generationRef = useRef(0);
  const connectionRef = useRef<RecombynCoreProjectionConnection | null>(null);
  const [loaded, setLoaded] = useState<{ resourceKey: string; snapshot: CanvasLibraryItem } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const generation = ++generationRef.current;
    setLoaded(null);
    setLoadError(null);
    void client.read(canvasId).then((next) => {
      if (generationRef.current === generation) setLoaded({ resourceKey, snapshot: next });
    }).catch((reason) => {
      if (generationRef.current === generation) setLoadError(reason instanceof Error ? reason.message : "Unable to load Canvas");
    });
    return () => { generationRef.current += 1; };
  }, [canvasId, client, resourceKey]);

  useCanvasRealtimeRecovery({ canvasId, spaceId, resourceKey, loaded, client, generationRef, connectionRef });
  return { client, resourceKey, loaded, loadError, connectionRef };
}

function useCanvasRealtimeRecovery(input: {
  canvasId: string;
  spaceId: string;
  resourceKey: string;
  loaded: { resourceKey: string; snapshot: CanvasLibraryItem } | null;
  client: ReturnType<typeof canvasCoreApi>;
  generationRef: MutableRefObject<number>;
  connectionRef: MutableRefObject<RecombynCoreProjectionConnection | null>;
}) {
  const { canvasId, spaceId, resourceKey, loaded, client, generationRef, connectionRef } = input;
  useEffect(() => {
    if (!loaded || loaded.resourceKey !== resourceKey) return undefined;
    let lastAppliedSequence = loaded.snapshot.sequence;
    const generation = generationRef.current;
    let recoveryQueue = Promise.resolve();
    let recoveryTimer: number | null = null;
    const socket = io("/", { auth: { spaceId }, transports: ["websocket"], withCredentials: true });
    const recover = (event?: { canvasId?: string; sequence?: number }) => {
      if (event?.canvasId && event.canvasId !== canvasId) return;
      if (event?.sequence && event.sequence <= lastAppliedSequence) return;
      if (recoveryTimer !== null) window.clearTimeout(recoveryTimer);
      recoveryTimer = window.setTimeout(() => {
        recoveryQueue = recoveryQueue.catch(() => undefined).then(async () => {
          const recovered = await client.changes(canvasId, lastAppliedSequence);
          if (generationRef.current !== generation) return;
          if (isDeletedCanvasRecovery(recovered, { canvasId, spaceId })) {
            window.dispatchEvent(new CustomEvent("kith:canvas-deleted", { detail: { canvasId } }));
            return;
          }
          if (recovered.deleted || recovered.snapshot.sequence <= lastAppliedSequence) return;
          lastAppliedSequence = recovered.snapshot.sequence;
          connectionRef.current?.replaceFromCore(recovered.snapshot);
        }).catch((error) => { console.error("Canvas realtime recovery will retry on the next signal", error); });
      }, 150);
    };
    const recoverOnline = () => recover();
    socket.on("canvas:changed", recover);
    socket.on("canvas:deleted", (event: { canvasId?: string }) => {
      if (event.canvasId === canvasId) window.dispatchEvent(new CustomEvent("kith:canvas-deleted", { detail: { canvasId } }));
    });
    socket.on("connect", recover);
    window.addEventListener("online", recoverOnline);
    return () => {
      socket.close();
      if (recoveryTimer !== null) window.clearTimeout(recoveryTimer);
      window.removeEventListener("online", recoverOnline);
    };
  }, [canvasId, client, connectionRef, generationRef, loaded, resourceKey, spaceId]);
}
