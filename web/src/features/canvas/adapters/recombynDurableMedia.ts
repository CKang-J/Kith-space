type LocalMediaItem = {
  url: string;
  key?: string;
  name?: string;
  mime?: string;
  width?: number;
  height?: number;
};

interface DurableMediaBridge {
  upload(file: File): Promise<{ id: string; url: string; filename: string; mimeType: string }>;
  delete(assetId: string): Promise<void>;
}

let activeBridge: DurableMediaBridge | null = null;
const nodeUploadAborts = new Map<string, AbortController>();

export function configureRecombynDurableMediaBridge(bridge: DurableMediaBridge | null): () => void {
  activeBridge = bridge;
  return () => { if (activeBridge === bridge) activeBridge = null; };
}

export function beginNodeUpload(nodeId: string): AbortSignal {
  const id = String(nodeId || "").trim();
  if (!id) return new AbortController().signal;
  abortNodeUpload(id);
  const controller = new AbortController();
  nodeUploadAborts.set(id, controller);
  return controller.signal;
}

export function abortNodeUpload(nodeId: string | null | undefined): void {
  const id = String(nodeId || "").trim();
  const controller = id ? nodeUploadAborts.get(id) : undefined;
  if (!controller) return;
  nodeUploadAborts.delete(id);
  controller.abort();
}

export function finishNodeUpload(nodeId: string | null | undefined): void {
  nodeUploadAborts.delete(String(nodeId || "").trim());
}

export function isUploadAbortError(error: unknown): boolean {
  const value = error as { name?: string; code?: string; message?: string } | null;
  return Boolean(value && (value.name === "AbortError" || value.code === "ERR_CANCELED" || /abort|cancel/i.test(String(value.message || ""))));
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => String(reader.result || "") ? resolve(String(reader.result)) : reject(new Error("empty file preview"));
    reader.onerror = () => reject(new Error("failed to read local media"));
    reader.readAsDataURL(file);
  });
}

export async function uploadImageFile(file: File, opts?: { signal?: AbortSignal }): Promise<LocalMediaItem> {
  if (opts?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (!activeBridge) return { url: await readFileAsDataUrl(file), name: file.name, mime: file.type };
  const uploaded = await activeBridge.upload(file);
  if (opts?.signal?.aborted) {
    await activeBridge.delete(uploaded.id).catch(() => undefined);
    throw new DOMException("Aborted", "AbortError");
  }
  return { url: uploaded.url, key: uploaded.id, name: uploaded.filename, mime: uploaded.mimeType };
}

export async function deleteUploadedFile(key: string | null | undefined): Promise<void> {
  if (key && activeBridge) await activeBridge.delete(key);
}

export async function uploadComposerAttachment(file: File, opts?: { previewDataUrl?: string }) {
  const uploaded = await uploadImageFile(file);
  const previewDataUrl = opts?.previewDataUrl || uploaded.url;
  return { uploadKey: uploaded.key || "", url: uploaded.url, imageRef: uploaded.url, previewDataUrl, name: uploaded.name || file.name };
}

export async function waitForImageReady(src: string, opts?: { signal?: AbortSignal }): Promise<boolean> {
  if (opts?.signal?.aborted) return false;
  if (!src) return false;
  if (/^data:|^blob:/.test(src)) return true;
  try { return (await fetch(src, { signal: opts?.signal })).ok; } catch { return false; }
}

export function isOurStoredImageUrl(src: string): boolean { return /^\/api\/canvases\/[^/]+\/assets\/[^/]+$/.test(src); }
export function toDisplayMediaUrl(src: string): string { return String(src || "").trim(); }
export function resolveUploadObjectKey(src: string): string | null {
  const match = /^\/api\/canvases\/[^/]+\/assets\/([^/]+)$/.exec(src);
  return match ? decodeURIComponent(match[1]!) : null;
}

export async function imageSrcToFile(src: string, filename = "image.png", opts?: { fallbackMime?: string }): Promise<File> {
  const response = await fetch(String(src || "").trim());
  if (!response.ok) throw new Error("failed to read local media");
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || opts?.fallbackMime || "application/octet-stream" });
}

export async function uploadImageFromSrc(src: string, filename = "processed.png", opts?: { signal?: AbortSignal }): Promise<LocalMediaItem> {
  return uploadImageFile(await imageSrcToFile(src, filename), { signal: opts?.signal });
}
