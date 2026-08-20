import { MessageContextSnapshotSchema, type MessageContextSnapshot } from "./contracts.js";

const SAFE_MODULES = new Set(["chat", "tasks", "agents", "settings", "spaces", "canvas"]);
const SAFE_TOKEN = /^[A-Za-z0-9._:-]+$/;

function safeToken(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  return token.length > 0 && token.length <= max && SAFE_TOKEN.test(token) ? token : null;
}

/**
 * Treats the renderer payload as an untrusted hint. Only product route identifiers and
 * canonical object references survive; URLs, queries, fragments and local paths cannot.
 */
export function normalizeMessageContextSnapshot(
  value: unknown,
  authoritativeSpaceId: string,
  now = Date.now(),
): MessageContextSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const moduleName = safeToken(raw.module, 64);
  const routeId = safeToken(raw.routeId, 128);
  if (!moduleName || !routeId || !SAFE_MODULES.has(moduleName)) return null;
  const rawRefs = Array.isArray(raw.openObjectRefs) ? raw.openObjectRefs.slice(0, 16) : [];
  const openObjectRefs = rawRefs.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const ref = entry as Record<string, unknown>;
    const type = safeToken(ref.type, 64);
    const id = safeToken(ref.id, 256);
    if (!type || !id) return [];
    const revision = typeof ref.revision === "number" && Number.isInteger(ref.revision) && ref.revision >= 0
      ? ref.revision
      : undefined;
    return [{ type, id, ...(revision === undefined ? {} : { revision }) }];
  });
  let focusedRef: MessageContextSnapshot["focusedRef"];
  if (raw.focusedRef && typeof raw.focusedRef === "object" && !Array.isArray(raw.focusedRef)) {
    const ref = raw.focusedRef as Record<string, unknown>;
    const type = safeToken(ref.type, 64);
    const id = safeToken(ref.id, 256);
    const field = ref.field === undefined ? undefined : safeToken(ref.field, 64);
    if (type && id && (ref.field === undefined || field)) focusedRef = { type, id, ...(field ? { field } : {}) };
  }
  const capturedAt = typeof raw.capturedAt === "number" && Number.isInteger(raw.capturedAt)
    && raw.capturedAt >= 0 && raw.capturedAt <= now + 60_000
    ? raw.capturedAt
    : now;
  return MessageContextSnapshotSchema.parse({
    spaceId: authoritativeSpaceId,
    module: moduleName,
    routeId,
    openObjectRefs,
    ...(focusedRef ? { focusedRef } : {}),
    capturedAt,
  });
}
