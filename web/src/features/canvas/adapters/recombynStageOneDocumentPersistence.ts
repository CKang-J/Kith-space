const STAGE_ONE_DOCUMENT_KEY = "kith:canvas-stage-one:document:v1";
const STAGE_ONE_DOCUMENT_VERSION = 1;

type StageOneDocumentEnvelope = {
  version: typeof STAGE_ONE_DOCUMENT_VERSION;
  document: unknown;
};

type StoragePort = Pick<Storage, "getItem" | "setItem">;

export function loadStageOneDocument(storage: StoragePort, fallback: unknown): unknown {
  try {
    const raw = storage.getItem(STAGE_ONE_DOCUMENT_KEY);
    if (!raw) return structuredClone(fallback);
    const parsed = JSON.parse(raw) as Partial<StageOneDocumentEnvelope>;
    if (parsed.version !== STAGE_ONE_DOCUMENT_VERSION || parsed.document == null) {
      return structuredClone(fallback);
    }
    return structuredClone(parsed.document);
  } catch {
    return structuredClone(fallback);
  }
}

export function persistStageOneDocument(storage: StoragePort, document: unknown): void {
  try {
    const envelope: StageOneDocumentEnvelope = {
      version: STAGE_ONE_DOCUMENT_VERSION,
      document,
    };
    storage.setItem(STAGE_ONE_DOCUMENT_KEY, JSON.stringify(envelope));
  } catch {
    // Stage 1 remains usable when browser storage is unavailable or full.
  }
}
