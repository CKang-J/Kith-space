// Attachment multipart upload parser: streams via busboy into the local attachment object store.
import Busboy from "busboy";
import type { IncomingMessage } from "node:http";
import type { Readable } from "node:stream";
import { deleteObject, saveObject } from "../files/localObjectStorage.js";

export interface UploadedFile { filename: string; mimeType: string; size: number; storageKey: string }

/**
 * Normalise a client-declared MIME type before storage.
 *
 * Browsers control the Content-Type of each multipart part, so we never trust
 * it at face value. This function:
 *   - Extracts only the base type (strips "; charset=utf-8" etc. to prevent
 *     header-injection via stored parameters).
 *   - Normalises to lowercase.
 *   - Rejects malformed or injection-looking strings, falling back to
 *     "application/octet-stream".
 *
 * Note: this does NOT filter out dangerous types like text/html — that
 * responsibility belongs to safeDownloadHeaders() in routes-api/attachments.ts,
 * which enforces a safe-inline whitelist at serve time and covers both new
 * uploads and any legacy records already in the database.
 */
export function sanitizeMimeType(declared: string): string {
  // Extract the base type (before the first ";")
  const base = declared.split(";")[0]?.trim().toLowerCase() ?? "";
  // A valid MIME type is "type/subtype" where both parts are non-empty tokens.
  // RFC 2045 tokens: printable ASCII excluding specials. We use a conservative
  // subset that covers all real-world types while rejecting injection attempts.
  if (/^[a-z0-9][a-z0-9!#$&\-^_.+]*\/[a-z0-9][a-z0-9!#$&\-^_.+]*$/.test(base)) {
    return base;
  }
  return "application/octet-stream";
}

export function parseUpload(spaceId: string, req: IncomingMessage): Promise<{ fields: Record<string, string>; files: UploadedFile[] }> {
  return new Promise((resolve, reject) => {
    let bb: ReturnType<typeof Busboy>;
    try {
      bb = Busboy({
        headers: req.headers,
        // Browsers encode non-ASCII multipart filename parameters as UTF-8 bytes.
        // Busboy otherwise defaults these parameters to latin1, producing mojibake.
        defParamCharset: "utf8",
        limits: { fileSize: 25 * 1024 * 1024, files: 10 },
      });
    }
    catch (e) { return reject(e); }
    const fields: Record<string, string> = {};
    const files: UploadedFile[] = [];
    const pending: Promise<void>[] = [];
    const activeStreams = new Set<Readable>();
    let fileOrdinal = 0;
    let firstError: unknown = null;
    let settled = false;
    const finish = async (error?: unknown) => {
      firstError ??= error ?? null;
      await Promise.all(pending);
      if (settled) return;
      settled = true;
      req.off("aborted", onAborted);
      req.off("error", onRequestError);
      if (!firstError) return resolve({ fields, files });
      await Promise.allSettled(files.map((file) => deleteObject(spaceId, file.storageKey)));
      reject(firstError);
    };
    const failRequest = (error: Error) => {
      firstError ??= error;
      req.unpipe(bb);
      for (const stream of activeStreams) stream.destroy(error);
      bb.destroy(error);
      req.resume();
      void finish(error).catch(reject);
    };
    const onAborted = () => failRequest(new Error("attachment upload request was aborted"));
    const onRequestError = (error: Error) => failRequest(error);
    req.once("aborted", onAborted);
    req.once("error", onRequestError);
    bb.on("field", (name, val) => { fields[name] = val; });
    bb.on("file", (_name, stream, info) => {
      const ordinal = fileOrdinal++;
      // Each per-file task self-catches: a save that fails before the stream is consumed
      // must still drain the stream so busboy emits
      // "close", and must never surface as an unhandledRejection (which crashes the process
      // on Node ≥15). The error is remembered and surfaced once, after close.
      activeStreams.add(stream);
      // saveObject may still be awaiting directory creation when the request aborts;
      // keep an early source error handled until pipeline installs its listeners.
      const onEarlyStreamError = () => {};
      stream.on("error", onEarlyStreamError);
      pending.push((async () => {
        let truncated = false;
        stream.once("limit", () => { truncated = true; });
        try {
          const { key, size } = await saveObject(spaceId, info.filename || "file", stream);
          if (truncated) {
            await deleteObject(spaceId, key);
            firstError ??= new Error("attachment exceeds the 25 MiB upload limit");
            return;
          }
          files[ordinal] = { filename: info.filename || "file", mimeType: sanitizeMimeType(info.mimeType || "application/octet-stream"), size, storageKey: key };
        } catch (e) {
          stream.resume(); // drain any unconsumed bytes so busboy can finish and emit "close"
          firstError ??= e;
        } finally {
          stream.off("error", onEarlyStreamError);
          activeStreams.delete(stream);
        }
      })());
    });
    bb.on("filesLimit", () => failRequest(new Error("attachment upload exceeds the 10 file limit")));
    bb.on("close", () => { void finish().catch(reject); });
    bb.on("error", (error) => { void finish(error).catch(reject); });
    req.pipe(bb);
  });
}
