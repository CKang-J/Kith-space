import { CanvasConflictError, CanvasCore, CanvasIdempotencyError, CanvasNotFoundError, CanvasValidationError } from "../../canvas/canvasCore.js";
import { CanvasAssetInUseError, CanvasAssetStore, CanvasAssetValidationError } from "../../canvas/canvasAssetStore.js";
import { normalizeCanvasSceneImport } from "../../canvas/canvasImportService.js";
import type { ApplyCanvasOperationInput } from "../../canvas/canvasTypes.js";
import { dbForSpace, spaceRecord } from "../../db/index.js";
import { publish } from "../realtime.js";
import { sendErr, sendJson } from "../util.js";
import type { HumanCtx, SpaceCtx } from "./ctx.js";

/**
 * Same-origin media resolver: Human session authenticates the request; path pins the Space and Canvas.
 * Range requests get a single 206 slice so <video> nodes can stream and seek Space-local assets.
 */
export function handleCanvasAssetResolver(ctx: HumanCtx): boolean {
  if (ctx.method !== "GET") return false;
  const match = /^\/api\/canvas-assets\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(ctx.p);
  if (!match) return false;
  try {
    const spaceId = decodeURIComponent(match[1]!);
    const canvasId = decodeURIComponent(match[2]!);
    const assetId = decodeURIComponent(match[3]!);
    const rootPath = spaceRecord(spaceId)?.rootPath;
    if (!rootPath) return (sendErr(ctx.res, 404, "Space not found"), true);
    const found = new CanvasAssetStore(dbForSpace(spaceId), spaceId, rootPath).read(canvasId, assetId);
    sendAssetBytes(ctx, found.bytes, found.asset.mimeType);
  } catch (error) {
    return sendCanvasError({ ...ctx, spaceId: "" }, error);
  }
  return true;
}

const BYTE_RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

function sendAssetBytes(
  ctx: Pick<HumanCtx, "req" | "res">,
  bytes: Buffer,
  mimeType: string,
): void {
  const svg = mimeType === "image/svg+xml";
  const headers = {
    "content-type": mimeType,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    ...(svg ? { "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'" } : {}),
  };
  const range = typeof ctx.req.headers.range === "string" ? BYTE_RANGE_PATTERN.exec(ctx.req.headers.range) : null;
  if (!range) {
    ctx.res.writeHead(200, { ...headers, "content-length": String(bytes.length) });
    ctx.res.end(bytes);
    return;
  }
  const total = bytes.length;
  let start = range[1] ? Number(range[1]) : 0;
  let end = range[2] ? Number(range[2]) : total - 1;
  if (!range[1] && range[2]) {
    start = Math.max(0, total - Number(range[2]));
    end = total - 1;
  }
  if (start > end || start >= total) {
    ctx.res.writeHead(416, { "content-range": `bytes */${total}` });
    ctx.res.end();
    return;
  }
  end = Math.min(end, total - 1);
  const slice = bytes.subarray(start, end + 1);
  ctx.res.writeHead(206, {
    ...headers,
    "content-range": `bytes ${start}-${end}/${total}`,
    "content-length": String(slice.length),
  });
  ctx.res.end(slice);
}

async function readCanvasJson<T>(ctx: SpaceCtx, maxBytes = 20 * 1024 * 1024): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    ctx.req.on("data", (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) {
        reject(new CanvasAssetValidationError("Canvas request body is too large"));
        ctx.req.destroy();
        return;
      }
      chunks.push(bytes);
    });
    ctx.req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T); }
      catch { reject(new CanvasAssetValidationError("Canvas request JSON is malformed")); }
    });
    ctx.req.on("error", reject);
  });
}

function requireMutationRequest(body: { operationId?: unknown; expectedRevision?: unknown }): asserts body is {
  operationId: string;
  expectedRevision: number;
} {
  if (typeof body.operationId !== "string" || body.operationId.length === 0 || body.operationId.length > 160
    || !Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) {
    throw new CanvasValidationError("operationId and a non-negative expectedRevision are required");
  }
}

function sendCanvasError(ctx: SpaceCtx, error: unknown): true {
  if (error instanceof CanvasNotFoundError) sendErr(ctx.res, 404, error.message);
  else if (error instanceof CanvasConflictError) sendErr(ctx.res, 409, error.message, { currentRevision: error.currentRevision });
  else if (error instanceof CanvasIdempotencyError) sendErr(ctx.res, 409, error.message);
  else if (error instanceof CanvasValidationError) sendErr(ctx.res, 400, error.message);
  else if (error instanceof CanvasAssetInUseError) sendErr(ctx.res, 409, error.message);
  else if (error instanceof CanvasAssetValidationError) sendErr(ctx.res, 400, error.message);
  else throw error;
  return true;
}

export async function handleCanvas(ctx: SpaceCtx): Promise<boolean> {
  if (!ctx.p.startsWith("/api/canvases")) return false;
  const core = new CanvasCore(dbForSpace(ctx.spaceId), ctx.spaceId);
  const rootPath = spaceRecord(ctx.spaceId)?.rootPath;
  if (!rootPath) return (sendErr(ctx.res, 404, "Space not found"), true);
  const assets = new CanvasAssetStore(dbForSpace(ctx.spaceId), ctx.spaceId, rootPath);
  try {
    assets.recover();
    if (ctx.p === "/api/canvases" && ctx.method === "GET") {
      return (sendJson(ctx.res, 200, { canvases: core.list() }), true);
    }
    if (ctx.p === "/api/canvases" && ctx.method === "POST") {
      const body = await readCanvasJson<{ title?: string; document?: unknown; canvasId?: string; operationId?: string }>(ctx);
      if (!body.canvasId || !body.operationId) throw new CanvasValidationError("canvasId and operationId are required");
      const canvas = core.create({ title: body.title ?? "Untitled Canvas", document: body.document ?? {}, canvasId: body.canvasId, operationId: body.operationId });
      await publish(ctx.spaceId, { type: "canvas:created", canvas });
      return (sendJson(ctx.res, 201, canvas), true);
    }
    if (ctx.p === "/api/canvases/import" && ctx.method === "POST") {
      const body = await readCanvasJson<{ title?: string; scene?: unknown; canvasId?: string; operationId?: string }>(ctx);
      if (!body.canvasId || !body.operationId) throw new CanvasValidationError("canvasId and operationId are required");
      const canvas = core.importScene({
        title: body.title ?? "Imported Canvas",
        document: normalizeCanvasSceneImport(body.scene, { spaceId: ctx.spaceId, assetExists: (canvasId, assetId) => assets.has(canvasId, assetId) }),
        canvasId: body.canvasId,
        operationId: body.operationId,
      });
      await publish(ctx.spaceId, { type: "canvas:created", canvas });
      return (sendJson(ctx.res, 201, canvas), true);
    }
    const assetMatch = /^\/api\/canvases\/([^/]+)\/assets(?:\/([^/]+))?$/.exec(ctx.p);
    if (assetMatch) {
      const canvasId = decodeURIComponent(assetMatch[1]!);
      const assetId = assetMatch[2] ? decodeURIComponent(assetMatch[2]) : null;
      if (!assetId && ctx.method === "GET") return (sendJson(ctx.res, 200, { assets: assets.list(canvasId) }), true);
      if (!assetId && ctx.method === "POST") {
        const body = await readCanvasJson<{ filename?: string; mimeType?: string; base64?: string }>(ctx, 44 * 1024 * 1024);
        if (!body.filename || !body.mimeType || !body.base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64)) {
          throw new CanvasAssetValidationError("filename, mimeType and base64 are required");
        }
        const asset = assets.write({ canvasId, filename: body.filename, mimeType: body.mimeType, bytes: Buffer.from(body.base64, "base64") });
        return (sendJson(ctx.res, 201, {
          ...asset,
          url: `/api/canvas-assets/${encodeURIComponent(ctx.spaceId)}/${encodeURIComponent(canvasId)}/${encodeURIComponent(asset.id)}`,
        }), true);
      }
      if (assetId && ctx.method === "GET") {
        const found = assets.read(canvasId, assetId);
        sendAssetBytes(ctx, found.bytes, found.asset.mimeType);
        return true;
      }
      if (assetId && ctx.method === "DELETE") {
        assets.delete(canvasId, assetId);
        return (sendJson(ctx.res, 200, { ok: true }), true);
      }
    }
    const match = /^\/api\/canvases\/([^/]+)(?:\/(operations|undo|redo|changes|export))?$/.exec(ctx.p);
    if (!match) return false;
    const canvasId = decodeURIComponent(match[1]!);
    const action = match[2];
    if (!action && ctx.method === "GET") return (sendJson(ctx.res, 200, core.read(canvasId)), true);
    if (!action && ctx.method === "DELETE") {
      const body = await readCanvasJson<{ operationId?: unknown; expectedRevision?: unknown }>(ctx);
      requireMutationRequest(body);
      const deleted = core.delete(canvasId, body.operationId, body.expectedRevision);
      await publish(ctx.spaceId, { type: "canvas:deleted", canvasId, sequence: deleted.sequence, revisions: deleted.revisions });
      return (sendJson(ctx.res, 200, { ok: true, deleted: true }), true);
    }
    if (action === "export" && ctx.method === "GET") return (sendJson(ctx.res, 200, core.exportScene(canvasId)), true);
    if (action === "changes" && ctx.method === "GET") {
      const after = Math.max(0, Number(ctx.url.searchParams.get("after")) || 0);
      return (sendJson(ctx.res, 200, core.recoverySince(canvasId, after)), true);
    }
    if (action === "operations" && ctx.method === "POST") {
      const body = await readCanvasJson<Omit<ApplyCanvasOperationInput, "canvasId"> & { operationId?: unknown; expectedRevision?: unknown }>(ctx);
      requireMutationRequest(body);
      if (!body.operation || typeof body.operation !== "object" || !("type" in body.operation)) {
        throw new CanvasValidationError("a Canvas operation is required");
      }
      const snapshot = core.apply({ ...body, canvasId });
      await publish(ctx.spaceId, { type: "canvas:changed", canvasId, sequence: snapshot.sequence, revisions: snapshot.revisions });
      return (sendJson(ctx.res, 200, snapshot), true);
    }
    if ((action === "undo" || action === "redo") && ctx.method === "POST") {
      const body = await readCanvasJson<{ operationId?: unknown; expectedRevision?: unknown }>(ctx);
      requireMutationRequest(body);
      const snapshot = core[action](canvasId, body.operationId, body.expectedRevision);
      await publish(ctx.spaceId, { type: "canvas:changed", canvasId, sequence: snapshot.sequence, revisions: snapshot.revisions });
      return (sendJson(ctx.res, 200, snapshot), true);
    }
    return false;
  } catch (error) {
    return sendCanvasError(ctx, error);
  }
}
