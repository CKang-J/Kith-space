/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/utils/docsUrl.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
declare const __DOCS_URL__: string;

const PROD_DOCS = 'https://recombyn.github.io/recombyn';
const LOCAL_DOCS_PORT = 5175;

function bakedOrigin(): string {
  if (typeof __DOCS_URL__ === 'undefined' || !__DOCS_URL__) return '';
  return String(__DOCS_URL__).replace(/\/$/, '');
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function isLocalOrigin(origin: string): boolean {
  try {
    return isLocalHost(new URL(origin).hostname);
  } catch {
    return /localhost|127\.0\.0\.1/.test(origin);
  }
}

function isTauriShell(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__ || import.meta.env.TAURI_ENV_PLATFORM);
}

export function docsOrigin(): string {
  const baked = bakedOrigin();

  // Desktop: don't send users to :5175 (docs server usually not running).
  if (isTauriShell()) {
    if (baked && !isLocalOrigin(baked)) return baked;
    return PROD_DOCS;
  }

  if (typeof window !== 'undefined' && isLocalHost(window.location.hostname)) {
    // Explicit local override (e.g. http://127.0.0.1:5180) wins.
    if (baked && isLocalOrigin(baked)) return baked;
    return `${window.location.protocol}//${window.location.hostname}:${LOCAL_DOCS_PORT}`;
  }

  return baked || PROD_DOCS;
}

/** @deprecated Prefer docsOrigin() — kept for existing imports. */
export const DOCS_ORIGIN = bakedOrigin() || PROD_DOCS;

export function docsUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${docsOrigin()}${p}`;
}

/**
 * Open http(s)/mailto in the system browser (Tauri) or a new tab (web).
 * WebView `window.open` often no-ops on desktop.
 */
export async function openExternalUrl(url: string): Promise<void> {
  const href = String(url || '').trim();
  if (!href) return;

  if (isTauriShell()) {
    try {
      const { openUrl } = await import('@/features/canvas/adapters/recombynUnavailablePlatform');
      await openUrl(href);
      return;
    } catch {
      /* fall through to window.open */
    }
  }

  const win = window.open(href, '_blank', 'noopener,noreferrer');
  if (!win && href.startsWith('mailto:')) {
    window.location.href = href;
  }
}
