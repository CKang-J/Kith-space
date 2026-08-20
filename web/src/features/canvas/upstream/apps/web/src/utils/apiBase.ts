/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/utils/apiBase.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Desktop build flavors bake API host at compile time.
 * Browser / self-host web keeps relative `/api/...` (Vite proxy or nginx).
 *
 * - local + prod Tauri → http://127.0.0.1:8000 (sidecar)
 * - local + dev Tauri → '' (Vite proxy on :3000)
 * - cloud desktop → VITE_API_BASE_URL if set; else '' (same as browser — Vite/nginx proxy)
 * - Never hardcode a public host; hosted API is opt-in via env when deployed
 */

export type DesktopMode = 'local' | 'cloud';

declare const __DESKTOP_MODE__: string;
declare const __API_BASE_URL__: string;

function readBaked(name: 'mode' | 'base'): string {
  try {
    if (name === 'mode') {
      return String(typeof __DESKTOP_MODE__ !== 'undefined' ? __DESKTOP_MODE__ : '').trim();
    }
    return String(typeof __API_BASE_URL__ !== 'undefined' ? __API_BASE_URL__ : '').trim();
  } catch {
    return '';
  }
}

/** `local` | `cloud` when this is a desktop flavor build; otherwise null (browser web). */
export function getDesktopMode(): DesktopMode | null {
  const raw = (
    import.meta.env.VITE_DESKTOP_MODE ||
    readBaked('mode') ||
    ''
  )
    .trim()
    .toLowerCase();
  if (raw === 'local' || raw === 'cloud') return raw;
  return null;
}

/** Local desktop: OS auto-login + SQLite — no cloud plans / redeem / billing UI. */
export function isDesktopLocal(): boolean {
  return getDesktopMode() === 'local';
}

/** Tauri desktop shell (local or cloud flavor) — can spawn OS coding CLIs. */
export function isDesktopShell(): boolean {
  return getDesktopMode() !== null;
}

/** Origin for API calls; empty string → same-origin relative paths. */
export function getApiBaseUrl(): string {
  const explicit = (
    import.meta.env.VITE_API_BASE_URL ||
    readBaked('base') ||
    ''
  )
    .trim()
    .replace(/\/$/, '');
  if (explicit) return explicit;

  const mode = getDesktopMode();
  // Only local desktop production uses the sidecar loopback (no Vite proxy).
  if (mode === 'local' && import.meta.env.PROD) {
    return 'http://127.0.0.1:8000';
  }
  // Browser + cloud desktop: relative `/api/...` (dev proxy or nginx).
  return '';
}

/** Turn `/api/v1/...` (or any absolute URL) into a fetchable URL for the active flavor. */
export function resolveApiUrl(pathOrUrl: string): string {
  const raw = (pathOrUrl || '').trim();
  if (!raw) return raw;
  if (/^(https?:|data:|blob:|tauri:)/i.test(raw)) return raw;
  const base = getApiBaseUrl();
  if (!base) return raw;
  if (raw.startsWith('/')) return `${base}${raw}`;
  return `${base}/${raw}`;
}
