import type { Store } from "@reduxjs/toolkit";

export interface RecombynNativeDocumentAdapter {
  read(): unknown;
  replace(document: unknown): void;
  connectProjection(store: Store): () => void;
}

export interface RecombynNativeDocumentAdapterOptions {
  onDocumentChange?(document: unknown): void;
}

/** Canonical Stage 1 document lives here; native Redux remains an interaction/projection cache. */
export function createRecombynNativeDocumentAdapter(
  initialDocument: unknown,
  options: RecombynNativeDocumentAdapterOptions = {},
): RecombynNativeDocumentAdapter {
  let canonicalDocument = structuredClone(initialDocument);
  let lastProjection: unknown;
  const replaceCanonical = (document: unknown) => {
    canonicalDocument = structuredClone(document);
    options.onDocumentChange?.(structuredClone(canonicalDocument));
  };
  return {
    read: () => structuredClone(canonicalDocument),
    replace: replaceCanonical,
    connectProjection: (store) => store.subscribe(() => {
      const projected = (store.getState() as { editor?: { document?: unknown } }).editor?.document;
      if (projected === undefined || projected === lastProjection) return;
      lastProjection = projected;
      replaceCanonical(projected);
    }),
  };
}
