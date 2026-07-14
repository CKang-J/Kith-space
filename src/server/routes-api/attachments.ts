// Auto-extracted from the former routes-api.ts monolith — bodies are verbatim.
import type { HumanCtx, SpaceCtx } from "./ctx.js";
import { and, eq } from "drizzle-orm";
import { dbForSpace, schema } from "../../db/index.js";
import { findAttachmentById } from "../../db/lookup.js";
import { parseUpload } from "../attachments.js";
import { assertChannelWritable } from "../../channels/channelLifecycle.js";
import { canHumanReadChannel } from "../channelAccess.js";
import { deleteObject, readObject } from "../storage.js";
import { sendErr, sendJson } from "../util.js";

/**
 * MIME types safe for inline display with no additional restrictions.
 * Raster images, audio, video, and PDF cannot execute scripts even when
 * navigated to directly — browsers parse them as media, not as documents.
 *
 * Intentional exclusions:
 *   - text/html, application/xhtml+xml → HTML execution.
 *   - image/svg+xml → handled separately in SAFE_INLINE_WITH_CSP_TYPES.
 *   - text/javascript, application/javascript → direct execution.
 *   - text/xml, application/xml → XSLT may load external resources.
 *   - Any unlisted type → attachment + octet-stream (defense-in-depth).
 */
const SAFE_INLINE_TYPES = new Set<string>([
  "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
  "image/bmp", "image/tiff", "image/avif", "image/ico", "image/x-icon",
  "application/pdf",
  "video/mp4", "video/webm", "video/ogg", "video/quicktime",
  "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm", "audio/aac",
]);

/**
 * MIME types that need inline display (e.g. for browser image-element rendering) but carry
 * script-execution risk when navigated to directly as a same-origin document.
 *
 * These are served inline with their declared content-type AND a hardened
 * Content-Security-Policy that sandboxes the browsing context:
 *   - `sandbox` → treats the document as a unique origin, blocks scripts,
 *     blocks form submission, blocks popups; the SVG renders as an image
 *     but cannot reach the parent page's localStorage or cookies.
 *   - `default-src 'none'` → no external resources loaded.
 *   - `style-src 'unsafe-inline'` → inline SVG styles still render correctly.
 *
 * When loaded via <img src="..."> the CSP of this response is irrelevant
 * (browsers already forbid scripts in SVG images), so the sandbox is the
 * backstop for direct URL navigation.
 */
const SAFE_INLINE_WITH_CSP_TYPES = new Set<string>([
  "image/svg+xml",
]);

const SVG_SANDBOX_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/**
 * Compute safe HTTP response headers for an attachment download.
 *
 * Three tiers:
 *  1. SAFE_INLINE_TYPES        → inline, declared MIME, nosniff.
 *  2. SAFE_INLINE_WITH_CSP_TYPES (SVG) → inline, declared MIME, nosniff +
 *     CSP sandbox (neutralises same-origin script execution on direct nav).
 *  3. Everything else          → application/octet-stream, attachment, nosniff.
 *
 * Tier 3 covers legacy DB records too (operates on stored value, not upload-time
 * declared value), so old records with dangerous MIMEs are also protected.
 */
export function safeDownloadHeaders(storedMime: string, filename: string): Record<string, string> {
  const encodedName = encodeURIComponent(filename);
  // nosniff: prevent browsers from sniffing the bytes and overriding the declared type.
  const nosniff = { "x-content-type-options": "nosniff" };
  if (storedMime && SAFE_INLINE_TYPES.has(storedMime)) {
    return {
      "content-type": storedMime,
      "content-disposition": `inline; filename*=UTF-8''${encodedName}`,
      ...nosniff,
    };
  }
  if (storedMime && SAFE_INLINE_WITH_CSP_TYPES.has(storedMime)) {
    return {
      "content-type": storedMime,
      "content-disposition": `inline; filename*=UTF-8''${encodedName}`,
      "content-security-policy": SVG_SANDBOX_CSP,
      ...nosniff,
    };
  }
  return {
    "content-type": "application/octet-stream",
    "content-disposition": `attachment; filename*=UTF-8''${encodedName}`,
    ...nosniff,
  };
}

export async function handleHumanAttachmentGet(ctx: HumanCtx): Promise<boolean> {
  const { res, method, p } = ctx;
  // Attachment download/preview uses the already-authorized Desktop or browser Cookie request.
  const adl = /^\/api\/attachments\/([^/]+?)(\/preview)?$/.exec(p);
  if (adl && adl[1] !== "upload" && method === "GET") {
    const found = await findAttachmentById(adl[1]!);
    const a = found?.value;
    if (!a) return (sendErr(res, 404, "attachment not found"), true);
    // Channel/Space access gate: direct attachment ids must not bypass channel visibility.
    // Use 404 (not 403) to avoid leaking whether the attachment exists at all.
    if (a.channelId) {
      // Attachment linked to a channel: apply the same channel-visibility logic as message reads.
      if (!(await canHumanReadChannel(a.spaceId, a.channelId))) return (sendErr(res, 404, "attachment not found"), true);
    }
    let data: Buffer;
    try { data = await readObject(a.spaceId, a.storageKey); } catch { return (sendErr(res, 404, "file missing"), true); }
    if (adl[2]) { // /preview: text preview
      if (data.includes(0) || (a.sizeBytes ?? 0) > 256 * 1024) return (sendJson(res, 200, { kind: "binary" }), true);
      return (sendJson(res, 200, { kind: "text", text: data.toString("utf8") }), true);
    }
    res.writeHead(200, safeDownloadHeaders(a.mimeType || "", a.filename));
    res.end(data); return true;
  }
  return false;
}

export async function handleAttachments(ctx: SpaceCtx): Promise<boolean> {
  const { req, res, method, p, humanId, spaceId } = ctx;
  const db = dbForSpace(spaceId);
  if (p === "/api/attachments/upload" && method === "POST") {
    const { fields, files } = await parseUpload(spaceId, req);
    if (fields.channelId) {
      try {
        await assertChannelWritable(spaceId, fields.channelId);
      } catch (error) {
        await Promise.allSettled(files.map((file) => deleteObject(spaceId, file.storageKey)));
        throw error;
      }
    }
    const out: any[] = [];
    for (const f of files) {
      const [a] = await db.insert(schema.attachments).values({ spaceId, channelId: fields.channelId || null, uploaderType: "human", uploaderId: humanId, filename: f.filename, mimeType: f.mimeType, sizeBytes: f.size, storageKey: f.storageKey }).returning();
      out.push({ attachmentId: a!.id, id: a!.id, filename: a!.filename, mimeType: a!.mimeType, sizeBytes: a!.sizeBytes });
    }
    return (sendJson(res, 200, { attachments: out, attachmentId: out[0]?.attachmentId }), true);
  }
  // Agent avatar upload → stored as attachment → agents.avatarUrl
  const agavatar = /^\/api\/agents\/([^/]+)\/avatar$/.exec(p);
  if (agavatar && method === "POST") {
    const agentId = agavatar[1]!;
    const { files } = await parseUpload(spaceId, req);
    const f = files[0];
    if (!f) return (sendErr(res, 400, "no file"), true);
    if (!(f.mimeType || "").startsWith("image/")) return (sendErr(res, 400, "avatar must be an image"), true);
    const [att] = await db.insert(schema.attachments).values({ spaceId, channelId: null, uploaderType: "human", uploaderId: humanId, filename: f.filename, mimeType: f.mimeType, sizeBytes: f.size, storageKey: f.storageKey }).returning();
    const avatarUrl = `/api/attachments/${att!.id}`;
    await db.update(schema.agents).set({ avatarUrl }).where(and(eq(schema.agents.id, agentId), eq(schema.agents.spaceId, spaceId)));
    return (sendJson(res, 200, { avatarUrl }), true);
  }
  // Space avatar upload → stored as attachment → spaces.avatarUrl
  const savatar = /^\/api\/spaces\/([^/]+)\/avatar$/.exec(p);
  if (savatar && method === "POST") {
    const sid = savatar[1]!;
    if (sid !== spaceId) return (sendErr(res, 404, "Space not found"), true);
    const { files } = await parseUpload(spaceId, req);
    const f = files[0];
    if (!f) return (sendErr(res, 400, "no file"), true);
    if (!(f.mimeType || "").startsWith("image/")) return (sendErr(res, 400, "avatar must be an image"), true);
    const [a] = await db.insert(schema.attachments).values({ spaceId: sid, channelId: null, uploaderType: "human", uploaderId: humanId, filename: f.filename, mimeType: f.mimeType, sizeBytes: f.size, storageKey: f.storageKey }).returning();
    const avatarUrl = `/api/attachments/${a!.id}`;
    await db.update(schema.spaces).set({ avatarUrl }).where(eq(schema.spaces.id, sid));
    return (sendJson(res, 200, { avatarUrl }), true);
  }
  // Channel file list (attachments linked to messages)
  return false;
}
