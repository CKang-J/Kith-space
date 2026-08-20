/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/utils/uploadImage.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
type LocalMediaItem = {
  url: string;
  key?: string;
  name?: string;
  mime?: string;
  width?: number;
  height?: number;
};

const nodeUploadAborts = new Map<string, AbortController>();

export function beginNodeUpload(nodeId: string): AbortSignal {
  const id = String(nodeId || '').trim();
  if (!id) return new AbortController().signal;
  abortNodeUpload(id);
  const controller = new AbortController();
  nodeUploadAborts.set(id, controller);
  return controller.signal;
}

export function abortNodeUpload(nodeId: string | null | undefined): void {
  const id = String(nodeId || '').trim();
  const controller = id ? nodeUploadAborts.get(id) : undefined;
  if (!controller) return;
  nodeUploadAborts.delete(id);
  controller.abort();
}

export function finishNodeUpload(nodeId: string | null | undefined): void {
  nodeUploadAborts.delete(String(nodeId || '').trim());
}

export function isUploadAbortError(error: unknown): boolean {
  const value = error as { name?: string; code?: string; message?: string } | null;
  return Boolean(value && (value.name === 'AbortError' || value.code === 'ERR_CANCELED' || /abort|cancel/i.test(String(value.message || ''))));
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      if (result) resolve(result);
      else reject(new Error('empty file preview'));
    };
    reader.onerror = () => reject(new Error('failed to read local media'));
    reader.readAsDataURL(file);
  });
}

export async function uploadImageFile(file: File, opts?: { signal?: AbortSignal }): Promise<LocalMediaItem> {
  if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const url = await readFileAsDataUrl(file);
  if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return { url, name: file.name, mime: file.type };
}

export async function deleteUploadedFile(_key: string | null | undefined): Promise<void> {}

export async function uploadComposerAttachment(file: File, opts?: { previewDataUrl?: string }): Promise<{
  uploadKey: string;
  url: string;
  imageRef: string;
  previewDataUrl: string;
  name: string;
}> {
  const previewDataUrl = String(opts?.previewDataUrl || '').trim() || await readFileAsDataUrl(file);
  return { uploadKey: '', url: previewDataUrl, imageRef: previewDataUrl, previewDataUrl, name: file.name || 'media' };
}

export function waitForImageReady(src: string, opts?: { signal?: AbortSignal }): Promise<boolean> {
  if (opts?.signal?.aborted) return Promise.resolve(false);
  return Promise.resolve(/^data:|^blob:/.test(String(src || '').trim()));
}

export function isOurStoredImageUrl(_src: string): boolean { return false; }
export function toDisplayMediaUrl(src: string, _uploadKey?: string | null): string { return String(src || '').trim(); }
export function resolveUploadObjectKey(_src: string): string | null { return null; }

export async function imageSrcToFile(src: string, filename = 'image.png', opts?: { fallbackMime?: string }): Promise<File> {
  const value = String(src || '').trim();
  if (!/^data:|^blob:/.test(value)) throw new Error('Stage 1 accepts local media references only');
  const response = await fetch(value);
  if (!response.ok) throw new Error('failed to read local media');
  const blob = await response.blob();
  const mime = blob.type || opts?.fallbackMime || 'application/octet-stream';
  return new File([blob], filename, { type: mime });
}

export async function uploadImageFromSrc(src: string, filename = 'processed.png', opts?: { signal?: AbortSignal }): Promise<LocalMediaItem> {
  const file = await imageSrcToFile(src, filename);
  return uploadImageFile(file, { signal: opts?.signal });
}
