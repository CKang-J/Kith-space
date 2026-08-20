import { dbForSpace, listSpaces, spaceRecord } from "../../db/index.js";
import { createLogger } from "../../log.js";
import { initializeGenerationProvidersFromStore } from "./generationProviders.js";
import { GenerationWorker } from "./generationWorker.js";

const log = createLogger("canvas-generation");
const SUPERVISOR_INTERVAL_MS = 5_000;

const workers = new Map<string, GenerationWorker>();

function ensureWorker(spaceId: string): GenerationWorker | null {
  const existing = workers.get(spaceId);
  if (existing) return existing;
  const record = spaceRecord(spaceId);
  if (!record) return null;
  try {
    const db = dbForSpace(spaceId);
    const worker = new GenerationWorker(db, spaceId, record.rootPath);
    worker.start();
    workers.set(spaceId, worker);
    return worker;
  } catch (error) {
    log.warn("generation worker skipped space", {
      spaceId,
      detail: String((error as Error)?.message ?? error),
    });
    return null;
  }
}

function reconcileWorkers(): void {
  let spaces;
  try {
    spaces = listSpaces();
  } catch (error) {
    log.warn("generation supervisor could not read the Space registry", {
      detail: String((error as Error)?.message ?? error),
    });
    return;
  }
  const live = new Set(spaces.map((space) => space.id));
  for (const [spaceId, worker] of workers) {
    if (live.has(spaceId)) continue;
    worker.stop();
    workers.delete(spaceId);
  }
  for (const space of spaces) ensureWorker(space.id);
}

export function kickGenerationWorker(spaceId: string): void {
  void ensureWorker(spaceId)?.pollOnce();
}

export function startGenerationSupervisor(): () => void {
  void initializeGenerationProvidersFromStore().catch((error) => {
    log.warn("generation providers were not initialized", {
      detail: String((error as Error)?.message ?? error),
    });
  });
  const timer = setInterval(reconcileWorkers, SUPERVISOR_INTERVAL_MS);
  timer.unref?.();
  reconcileWorkers();
  return () => {
    clearInterval(timer);
    for (const worker of workers.values()) worker.stop();
    workers.clear();
  };
}
