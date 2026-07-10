// i18n bootstrap (react-i18next). Default English, switchable to Chinese; choice persisted in localStorage "open-tag.lang".
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

const saved = (typeof localStorage !== "undefined" && localStorage.getItem("open-tag.lang")) || "en";

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, zh: { translation: zh } },
  lng: saved,
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React already escapes
});

export default i18n;
