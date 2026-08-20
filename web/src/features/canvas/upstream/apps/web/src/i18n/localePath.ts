/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/i18n/localePath.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Path-based locales (hreflang-friendly):
 * - English (default): `/home`, `/editor/...`  — no prefix
 * - 简体: `/zh/home`
 * - 繁體: `/zh-tw/home`
 * - 日本語: `/ja/home`
 *
 * Pair with React Router `basename` so in-app `navigate('/home')` stays prefix-aware.
 */

export const DEFAULT_I18N_LANG = 'en';

/** Matches i18next-browser-languagedetector `lookupLocalStorage`. */
export const LOCALE_STORAGE_KEY = 'language';

/** First URL segment → i18n language code. */
export const PREFIX_TO_I18N: Record<string, string> = {
  zh: 'zh-CN',
  'zh-tw': 'zh-TW',
  ja: 'ja',
};

/** i18n language → URL prefix (empty = default / English). */
export const I18N_TO_PREFIX: Record<string, string> = {
  en: '',
  'zh-CN': 'zh',
  'zh-TW': 'zh-tw',
  ja: 'ja',
};

export function normalizeI18nLang(raw: string | undefined | null): string {
  const s = String(raw || '');
  if (s.startsWith('zh-TW') || s === 'zh-Hant' || s.toLowerCase() === 'zh-tw') return 'zh-TW';
  if (s.startsWith('zh')) return 'zh-CN';
  if (s.startsWith('ja')) return 'ja';
  if (s.startsWith('en')) return 'en';
  if (s in I18N_TO_PREFIX) return s;
  return DEFAULT_I18N_LANG;
}

/** `/zh` | `/zh-tw` | `/ja` | `` — for BrowserRouter basename. */
export function getLocaleBasename(pathname?: string): string {
  const path =
    pathname ??
    (typeof window !== 'undefined' ? window.location.pathname : '/');
  const seg = path.split('/').filter(Boolean)[0]?.toLowerCase() || '';
  if (seg in PREFIX_TO_I18N) return `/${seg}`;
  return '';
}

export function basenameToI18nLang(basename: string): string {
  const seg = basename.replace(/^\//, '').toLowerCase();
  return PREFIX_TO_I18N[seg] || DEFAULT_I18N_LANG;
}

/** Strip `/zh` | `/zh-tw` | `/ja` from a full browser pathname. */
export function stripLocalePrefix(pathname: string): string {
  const parts = pathname.split('/');
  // ["", "zh", "home"] or ["", "home"]
  const seg = (parts[1] || '').toLowerCase();
  if (seg in PREFIX_TO_I18N) {
    const rest = '/' + parts.slice(2).join('/');
    return rest === '/' ? '/' : rest.replace(/\/$/, '') || '/';
  }
  return pathname || '/';
}

/** Build a full browser URL path for an i18n language + app path (no prefix in `appPath`). */
export function withLocalePrefix(appPath: string, i18nLang: string): string {
  const lang = normalizeI18nLang(i18nLang);
  const prefix = I18N_TO_PREFIX[lang] || '';
  const path = appPath.startsWith('/') ? appPath : `/${appPath}`;
  if (!prefix) return path === '' ? '/' : path;
  if (path === '/') return `/${prefix}`;
  return `/${prefix}${path}`;
}

/**
 * Absolute URL for switching language while staying on the same page.
 * Uses full browser pathname (includes current prefix).
 */
export function buildLocaleSwitchUrl(
  nextI18nLang: string,
  loc: { pathname: string; search?: string; hash?: string } = typeof window !==
  'undefined'
    ? window.location
    : { pathname: '/', search: '', hash: '' }
): string {
  const stripped = stripLocalePrefix(loc.pathname);
  const next = withLocalePrefix(stripped || '/', nextI18nLang);
  return `${next}${loc.search || ''}${loc.hash || ''}`;
}

/** Public absolute URL for SEO alternate links. */
export function absoluteLocaleUrl(origin: string, i18nLang: string, appPath = '/'): string {
  const path = withLocalePrefix(appPath, i18nLang);
  return `${origin.replace(/\/$/, '')}${path === '/' ? '/' : path}`;
}

export function readStoredI18nLang(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (!raw || !String(raw).trim()) return null;
    return normalizeI18nLang(raw);
  } catch {
    return null;
  }
}

export function writeStoredI18nLang(lang: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, normalizeI18nLang(lang));
  } catch {
    /* private mode / quota */
  }
}

/** Map browser `navigator.language(s)` → supported i18n code. */
export function detectNavigatorI18nLang(
  languages: readonly string[] | undefined = typeof navigator !== 'undefined'
    ? navigator.languages?.length
      ? navigator.languages
      : navigator.language
        ? [navigator.language]
        : []
    : []
): string {
  for (const raw of languages || []) {
    const s = String(raw || '').trim();
    if (!s) continue;
    if (s.startsWith('zh-TW') || s === 'zh-Hant' || /^zh-(tw|hk|mo)/i.test(s)) return 'zh-TW';
    if (s.startsWith('zh') || s === 'zh-Hans') return 'zh-CN';
    if (s.startsWith('ja')) return 'ja';
    if (s.startsWith('en')) return 'en';
  }
  return DEFAULT_I18N_LANG;
}

/**
 * Preferred UI language:
 * - explicit user choice in localStorage, else
 * - browser environment (first visit), else
 * - English default.
 */
export function resolvePreferredI18nLang(): string {
  return readStoredI18nLang() ?? detectNavigatorI18nLang();
}

/** OAuth redirect_uri is fixed without locale prefix — never auto-rewrite. */
export function shouldSkipLocaleAutoRedirect(pathname: string): boolean {
  const stripped = stripLocalePrefix(pathname).toLowerCase();
  return (
    stripped === '/login/google/callback' ||
    stripped.startsWith('/login/google/callback/')
  );
}

/**
 * First visit / unprefixed URL: send the user to their preferred locale prefix.
 * Returns true when a redirect was started (caller should stop boot work).
 */
export function redirectToPreferredLocaleIfNeeded(
  loc: { pathname: string; search?: string; hash?: string } = typeof window !==
  'undefined'
    ? window.location
    : { pathname: '/', search: '', hash: '' },
  assign: (url: string) => void = (url) => {
    if (typeof window !== 'undefined') window.location.replace(url);
  }
): boolean {
  const pathname = loc.pathname || '/';
  if (shouldSkipLocaleAutoRedirect(pathname)) return false;

  const urlBasename = getLocaleBasename(pathname);
  if (urlBasename) {
    // Explicit `/zh/...` etc. — respect URL and remember as preference.
    writeStoredI18nLang(basenameToI18nLang(urlBasename));
    return false;
  }

  const preferred = resolvePreferredI18nLang();
  writeStoredI18nLang(preferred);
  if (preferred === DEFAULT_I18N_LANG) return false;

  const stripped = stripLocalePrefix(pathname);
  const nextPath = withLocalePrefix(stripped || '/', preferred);
  const target = `${nextPath}${loc.search || ''}${loc.hash || ''}`;
  const current = `${pathname}${loc.search || ''}${loc.hash || ''}`;
  if (target === current) return false;
  assign(target);
  return true;
}
