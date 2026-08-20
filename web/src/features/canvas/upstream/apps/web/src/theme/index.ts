/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/theme/index.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme';

export function getStoredThemeMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    /* ignore */
  }
  return 'light';
}

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function isTauriShell(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__ || import.meta.env.TAURI_ENV_PLATFORM);
}

/** Match Windows/macOS title-bar chrome to the app theme (Tauri only). */
function syncDesktopWindowTheme(resolved: 'light' | 'dark') {
  if (!isTauriShell()) return;
  async function applyTauriWindowTheme() {
    try {
      const { getCurrentWindow } = await import('@/features/canvas/adapters/recombynUnavailablePlatform');
      await getCurrentWindow().setTheme(resolved);
    } catch {
      /* ignore */
    }
  }
  void applyTauriWindowTheme();
}

/** Apply resolved theme via data-theme (CSS files own the tokens). */
export function applyThemeColors(resolved: 'light' | 'dark') {
  const root = document.documentElement;
  const next = resolved;
  const prev = root.getAttribute('data-theme');
  const already =
    prev === next && root.classList.contains('dark') === (next === 'dark');

  if (!already) {
    // Suppress background/color transitions so CSS variable swaps don't interpolate/flash.
    root.classList.add('rcb-theme-switching');
    root.setAttribute('data-theme', next);
    root.classList.toggle('dark', next === 'dark');
    // Force style flush while transitions are disabled.
    void root.offsetHeight;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        root.classList.remove('rcb-theme-switching');
      });
    });
  }

  // Native scrollbars / form controls follow the app theme (esp. WebView / Tauri).
  root.style.colorScheme = next;
  // Desktop title bar stays OS-default unless we push the window theme.
  syncDesktopWindowTheme(next);
}

let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

export function applyTheme(mode: ThemeMode = getStoredThemeMode()) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }

  if (typeof window === 'undefined') return;

  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  if (mediaListener) {
    mq.removeEventListener('change', mediaListener);
    mediaListener = null;
  }
  if (mode === 'system') {
    mediaListener = () => applyThemeColors(resolveTheme('system'));
    mq.addEventListener('change', mediaListener);
  }

  applyThemeColors(resolveTheme(mode));
}
