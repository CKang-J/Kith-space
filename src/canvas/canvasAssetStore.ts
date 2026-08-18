import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, openSync } from "node:fs";
import path from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { SpaceDb } from "../db/index.js";
import { schema } from "../db/index.js";
import { CanvasNotFoundError } from "./canvasCore.js";
import { CanvasAssetFileBoundary } from "./canvasAssetFileBoundary.js";
import { CanvasAssetInUseError, CanvasAssetValidationError } from "./canvasAssetErrors.js";
export { CanvasAssetInUseError, CanvasAssetValidationError } from "./canvasAssetErrors.js";

const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const MIME_EXTENSIONS = new Map([
  ["image/png", ".png"], ["image/jpeg", ".jpg"], ["image/gif", ".gif"], ["image/webp", ".webp"],
  ["image/svg+xml", ".svg"], ["video/mp4", ".mp4"], ["video/webm", ".webm"],
  ["audio/mpeg", ".mp3"], ["audio/wav", ".wav"],
]);

function detectedMimeType(bytes: Buffer): string | null {
  const prefix = bytes.subarray(0, 16);
  if (prefix.length >= 8 && prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) return "image/jpeg";
  if (prefix.subarray(0, 6).toString("ascii") === "GIF87a" || prefix.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (prefix.subarray(0, 4).toString("ascii") === "RIFF" && prefix.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (/^\s*<svg[\s>]/i.test(bytes.subarray(0, 1024).toString("utf8"))) return "image/svg+xml";
  if (prefix.subarray(4, 8).toString("ascii") === "ftyp") return "video/mp4";
  if (prefix.length >= 4 && prefix[0] === 0x1a && prefix[1] === 0x45 && prefix[2] === 0xdf && prefix[3] === 0xa3) return "video/webm";
  if (prefix.subarray(0, 3).toString("ascii") === "ID3" || (prefix[0] === 0xff && (prefix[1]! & 0xe0) === 0xe0)) return "audio/mpeg";
  if (prefix.subarray(0, 4).toString("ascii") === "RIFF" && prefix.subarray(8, 12).toString("ascii") === "WAVE") return "audio/wav";
  return null;
}

export function sanitizeInlineSvgMarkup(markup: string): string {
  return sanitizeSvg(Buffer.from(markup, "utf8")).toString("utf8");
}

function sanitizeSvg(bytes: Buffer): Buffer {
  const source = bytes.toString("utf8");
  if (!/^\s*<svg[\s>]/i.test(source)
    || /<!DOCTYPE|<!ENTITY|<\?(?:xml-stylesheet)|<(?:script|foreignObject|iframe|object|embed|link|meta|style)\b|\son[a-z]+\s*=|javascript:|data\s*:\s*text\/html|@import/i.test(source)) {
    throw new CanvasAssetValidationError("SVG contains active or external content");
  }
  for (const match of source.matchAll(/\b(?:href|xlink:href)\s*=\s*(['"])(.*?)\1/gi)) {
    if (!match[2]!.trim().startsWith("#")) throw new CanvasAssetValidationError("SVG contains an external reference");
  }
  for (const match of source.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    if (!match[2]!.trim().startsWith("#")) throw new CanvasAssetValidationError("SVG contains an external reference");
  }
  return Buffer.from(source, "utf8");
}

function fsyncDirectory(directory: string): void {
  if (process.platform === "win32") return;
  const fd = openSync(directory, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

type CanvasAssetRow = typeof schema.canvasAssets.$inferSelect;

export class CanvasAssetStore {
  private readonly root: string;
  private readonly stagingRoot: string;
  private readonly files: CanvasAssetFileBoundary;

  constructor(private readonly db: SpaceDb, private readonly spaceId: string, spaceRoot: string) {
    this.files = new CanvasAssetFileBoundary(spaceRoot);
    this.root = this.files.root;
    this.stagingRoot = this.files.stagingRoot;
  }

  write(input: {
    canvasId: string;
    filename: string;
    mimeType: string;
    bytes: Buffer;
    failpoint?: "after-file" | "after-db" | "after-rename";
  }): CanvasAssetRow {
    this.assertCanvas(input.canvasId);
    const detected = detectedMimeType(input.bytes);
    const extension = MIME_EXTENSIONS.get(input.mimeType);
    if (!extension || detected !== input.mimeType || input.bytes.length === 0 || input.bytes.length > MAX_ASSET_BYTES) {
      throw new CanvasAssetValidationError("Canvas asset type or size is not allowed");
    }
    const bytes = input.mimeType === "image/svg+xml" ? sanitizeSvg(input.bytes) : input.bytes;
    const id = randomUUID();
    const storageKey = `${input.canvasId}/${id}${extension}`;
    const finalPath = this.resolveStorageKey(storageKey);
    this.files.ensureDirectory(this.stagingRoot);
    this.files.ensureDirectory(path.dirname(finalPath));
    const stagingPath = this.files.stagingPath(id);
    this.files.writeExclusive(stagingPath, bytes);
    if (input.failpoint === "after-file") throw new Error("canvas asset failpoint: after-file");
    const created = this.db.insert(schema.canvasAssets).values({
      id,
      canvasId: input.canvasId,
      storageKey,
      filename: path.basename(input.filename || `asset${extension}`).slice(0, 255),
      mimeType: input.mimeType,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: bytes.length,
      state: "staged",
    }).returning().get();
    if (input.failpoint === "after-db") throw new Error("canvas asset failpoint: after-db");
    this.files.rename(stagingPath, finalPath);
    fsyncDirectory(path.dirname(finalPath));
    if (input.failpoint === "after-rename") throw new Error("canvas asset failpoint: after-rename");
    return this.db.update(schema.canvasAssets).set({ state: "ready" }).where(eq(schema.canvasAssets.id, id)).returning().get();
  }

  list(canvasId: string): CanvasAssetRow[] {
    this.assertCanvas(canvasId);
    return this.db.select().from(schema.canvasAssets).where(and(
      eq(schema.canvasAssets.canvasId, canvasId), isNull(schema.canvasAssets.deletedAt),
    )).all();
  }

  has(canvasId: string, assetId: string): boolean {
    return this.list(canvasId).some((asset) => asset.id === assetId && asset.state === "ready");
  }

  read(canvasId: string, assetId: string): { asset: CanvasAssetRow; bytes: Buffer } {
    const asset = this.list(canvasId).find((candidate) => candidate.id === assetId && candidate.state === "ready");
    if (!asset) throw new CanvasAssetValidationError("Canvas asset not found");
    return { asset, bytes: this.readVerifiedFile(asset, this.filePath(asset)) };
  }

  filePath(asset: Pick<CanvasAssetRow, "storageKey">): string {
    return this.resolveStorageKey(asset.storageKey);
  }

  recover(): void {
    this.files.ensureDirectory(this.stagingRoot);
    const canvases = this.db.select({ id: schema.canvasDocuments.id }).from(schema.canvasDocuments)
      .where(eq(schema.canvasDocuments.spaceId, this.spaceId)).all().map((row) => row.id);
    const assets = canvases.length === 0 ? [] : this.db.select().from(schema.canvasAssets)
      .where(inArray(schema.canvasAssets.canvasId, canvases)).all();
    for (const asset of assets) {
      if (asset.state === "deleting") continue;
      const stagingPath = path.join(this.stagingRoot, `${asset.id}.tmp`);
      const finalPath = this.filePath(asset);
      const finalExists = existsSync(finalPath);
      const stagingExists = existsSync(stagingPath);
      const finalBytes = finalExists ? this.readCandidate(asset, finalPath) : null;
      const stagingBytes = stagingExists ? this.readCandidate(asset, stagingPath) : null;

      if (finalBytes) {
        if (asset.state === "staged") {
          this.commitRecovery(asset, asset.storageKey);
        }
        continue;
      }
      if (!stagingBytes) {
        throw new CanvasAssetValidationError(finalExists || stagingExists
          ? "Canvas asset integrity check failed"
          : "A Canvas asset file is missing");
      }

      if (!finalExists) {
        this.files.ensureDirectory(path.dirname(finalPath));
        this.files.writeExclusive(finalPath, stagingBytes);
        fsyncDirectory(path.dirname(finalPath));
        this.commitRecovery(asset, asset.storageKey);
        continue;
      }

      const extension = path.extname(asset.storageKey);
      const recoveredStorageKey = `${asset.canvasId}/${asset.id}.recovered-${randomUUID()}${extension}`;
      const recoveredPath = this.resolveStorageKey(recoveredStorageKey);
      this.files.ensureDirectory(path.dirname(recoveredPath));
      this.files.writeExclusive(recoveredPath, stagingBytes);
      fsyncDirectory(path.dirname(recoveredPath));
      this.readVerifiedFile(asset, recoveredPath);
      this.commitRecovery(asset, recoveredStorageKey);
    }
    // Unknown staging files are retained. A future platform adapter may GC
    // them only with proven handle-relative deletion semantics.
    this.files.assertDirectory(this.stagingRoot);
  }

  delete(canvasId: string, assetId: string): void {
    const asset = this.list(canvasId).find((candidate) => candidate.id === assetId);
    if (!asset) return;
    const documents = [
      ...this.db.select({ value: schema.canvasDocuments.document }).from(schema.canvasDocuments).where(eq(schema.canvasDocuments.id, canvasId)).all(),
      ...this.db.select({ value: schema.canvasMutations.beforeDocument }).from(schema.canvasMutations).where(eq(schema.canvasMutations.canvasId, canvasId)).all(),
      ...this.db.select({ value: schema.canvasMutations.afterDocument }).from(schema.canvasMutations).where(eq(schema.canvasMutations.canvasId, canvasId)).all(),
      ...this.db.select({ value: schema.canvasMutations.operation }).from(schema.canvasMutations).where(eq(schema.canvasMutations.canvasId, canvasId)).all(),
    ];
    if (documents.some(({ value }) => JSON.stringify(value).includes(assetId))) throw new CanvasAssetInUseError("Canvas asset remains reachable from document history");
    this.db.update(schema.canvasAssets).set({ state: "deleting", deletedAt: new Date() }).where(eq(schema.canvasAssets.id, assetId)).run();
  }

  private readVerifiedFile(asset: Pick<CanvasAssetRow, "sizeBytes" | "sha256">, target: string): Buffer {
    const bytes = this.readCandidate(asset, target);
    if (!bytes) {
      throw new CanvasAssetValidationError("Canvas asset integrity check failed");
    }
    return bytes;
  }

  private readCandidate(asset: Pick<CanvasAssetRow, "sizeBytes" | "sha256">, target: string): Buffer | null {
    const bytes = this.files.read(target);
    return bytes.length === asset.sizeBytes && createHash("sha256").update(bytes).digest("hex") === asset.sha256
      ? bytes
      : null;
  }

  private commitRecovery(asset: CanvasAssetRow, storageKey: string): void {
    const updated = this.db.update(schema.canvasAssets).set({ storageKey, state: "ready" }).where(and(
      eq(schema.canvasAssets.id, asset.id),
      eq(schema.canvasAssets.storageKey, asset.storageKey),
      eq(schema.canvasAssets.state, asset.state),
      isNull(schema.canvasAssets.deletedAt),
    )).run();
    if (updated.changes !== 1) {
      throw new CanvasAssetValidationError("Canvas asset changed during crash recovery");
    }
  }

  private assertCanvas(canvasId: string): void {
    const canvas = this.db.select({ id: schema.canvasDocuments.id }).from(schema.canvasDocuments).where(and(
      eq(schema.canvasDocuments.id, canvasId), eq(schema.canvasDocuments.spaceId, this.spaceId), isNull(schema.canvasDocuments.deletedAt),
    )).get();
    if (!canvas) throw new CanvasNotFoundError(`canvas not found: ${canvasId}`);
  }

  private resolveStorageKey(storageKey: string): string {
    return this.files.resolveStorageKey(storageKey);
  }
}
