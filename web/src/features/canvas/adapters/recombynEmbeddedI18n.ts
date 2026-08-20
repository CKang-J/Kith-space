import i18n from "@/i18n";
import en from "@recombyn-native/i18n/locales/en";
import zh from "@recombyn-native/i18n/locales/zh-CN";

// Recombyn's standalone bootstrap owns the browser pathname and redirects it
// to a locale prefix. Embedded Canvas instead contributes its messages to the
// already-initialized Kith instance, leaving Kith routing canonical.
i18n.addResourceBundle("en", "translation", en, true, false);
i18n.addResourceBundle("zh", "translation", zh, true, false);

export const SUPPORTED_LANGS = [
  { code: "en", labelKey: "lang.en" },
  { code: "zh", labelKey: "lang.zh-CN" },
] as const;

export default i18n;
