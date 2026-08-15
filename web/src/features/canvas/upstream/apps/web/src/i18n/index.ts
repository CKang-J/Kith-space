/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/i18n/index.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en';
import zhCN from './locales/zh-CN';
import zhTW from './locales/zh-TW';
import ja from './locales/ja';
import {
  DEFAULT_I18N_LANG,
  LOCALE_STORAGE_KEY,
  basenameToI18nLang,
  getLocaleBasename,
  redirectToPreferredLocaleIfNeeded,
  resolvePreferredI18nLang,
} from './localePath';

const resources = {
  en: { common: en },
  'zh-CN': { common: zhCN },
  'zh-TW': { common: zhTW },
  ja: { common: ja },
};

/**
 * Boot language:
 * - URL prefix (`/zh/...`) wins when present
 * - otherwise preferred = stored choice or browser locale (first visit)
 */
function detectBootLng(): string {
  if (typeof window === 'undefined') return DEFAULT_I18N_LANG;
  const basename = getLocaleBasename(window.location.pathname);
  if (basename) return basenameToI18nLang(basename);
  return resolvePreferredI18nLang();
}

async function initI18n() {
  // Unprefixed first visit → `/zh/...` etc. before React paints.
  if (typeof window !== 'undefined' && redirectToPreferredLocaleIfNeeded()) {
    return;
  }

  await i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources,
      fallbackLng: DEFAULT_I18N_LANG,
      lng: detectBootLng(),
      defaultNS: 'common',
      detection: {
        order: ['localStorage', 'navigator'],
        lookupLocalStorage: LOCALE_STORAGE_KEY,
        caches: ['localStorage'],
      },
      interpolation: { escapeValue: false },
    });
  const boot = detectBootLng();
  if (boot && i18n.language !== boot) {
    void i18n.changeLanguage(boot);
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang =
      i18n.resolvedLanguage || i18n.language || DEFAULT_I18N_LANG;
  }
}
void initI18n();

i18n.on('languageChanged', (lng) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lng;
  }
});

export default i18n;

export const SUPPORTED_LANGS = [
  { code: 'en', labelKey: 'lang.en' },
  { code: 'zh-CN', labelKey: 'lang.zh-CN' },
  { code: 'zh-TW', labelKey: 'lang.zh-TW' },
  { code: 'ja', labelKey: 'lang.ja' },
] as const;

export {
  DEFAULT_I18N_LANG,
  I18N_TO_PREFIX,
  LOCALE_STORAGE_KEY,
  PREFIX_TO_I18N,
  absoluteLocaleUrl,
  basenameToI18nLang,
  buildLocaleSwitchUrl,
  detectNavigatorI18nLang,
  getLocaleBasename,
  normalizeI18nLang,
  redirectToPreferredLocaleIfNeeded,
  resolvePreferredI18nLang,
  stripLocalePrefix,
  withLocalePrefix,
  writeStoredI18nLang,
} from './localePath';
