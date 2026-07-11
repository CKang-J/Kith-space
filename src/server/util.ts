import type { IncomingMessage, ServerResponse } from "node:http";

export function sendJson(res: ServerResponse, code: number, obj: unknown): void {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
export function sendErr(res: ServerResponse, code: number, error: string, extra: Record<string, unknown> = {}): void {
  sendJson(res, code, { error, ...extra });
}
export async function readJson<T = any>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => { try { resolve((d ? JSON.parse(d) : {}) as T); } catch { resolve({} as T); } });
  });
}
function header(req: IncomingMessage, name: string): string | null {
  const h = req.headers[name];
  return Array.isArray(h) ? (h[0] ?? null) : (h ?? null);
}
export interface SpaceIdHeaderResolution {
  spaceId: string | null;
  conflict: boolean;
}

export function resolveSpaceId(canonicalValue: string | null | undefined, legacyValue: string | null | undefined): SpaceIdHeaderResolution {
  const canonical = canonicalValue?.trim() || null;
  const legacy = legacyValue?.trim() || null;
  return {
    spaceId: canonical ?? legacy,
    conflict: !!canonical && !!legacy && canonical !== legacy,
  };
}

export const spaceRoom = (spaceId: string) => `space:${spaceId}`;

/** Canonical Space scope header with a temporary A2 compatibility fallback. */
export function spaceIdHeader(req: IncomingMessage): SpaceIdHeaderResolution {
  return resolveSpaceId(header(req, "x-space-id"), header(req, "x-server-id"));
}

/** @deprecated Use spaceIdHeader and handle conflicting dual headers explicitly. */
export const serverIdHeader = (req: IncomingMessage) => {
  const resolved = spaceIdHeader(req);
  return resolved.conflict ? null : resolved.spaceId;
};
export const agentIdHeader = (req: IncomingMessage) => header(req, "x-agent-id");
export function bearer(req: IncomingMessage): string | null {
  const v = header(req, "authorization");
  if (!v) return null;
  const m = /^Bearer\s+(.+)$/i.exec(v);
  return m ? m[1]!.trim() : null;
}
