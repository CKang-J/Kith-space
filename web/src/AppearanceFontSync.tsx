import { useEffect } from "react";
import {
  applyAppearanceColorMode,
  applyAppearanceFonts,
  isAppearanceSettings,
  readColorMode,
} from "./appearanceFonts.ts";
import { useStore } from "./store.tsx";

/** Loads installation appearance after authentication and keeps the document root in sync. */
export function AppearanceFontSync() {
  const { api, authState } = useStore();

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => applyAppearanceColorMode(
      { colorMode: readColorMode(document.documentElement.dataset.colorMode) },
      document.documentElement,
      media.matches,
    );
    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, []);

  useEffect(() => {
    if (authState !== "authed") return;
    let active = true;
    api("GET", "/api/settings/appearance")
      .then((result) => {
        if (active && isAppearanceSettings(result)) {
          applyAppearanceFonts(result);
          applyAppearanceColorMode(result);
        }
      })
      .catch(() => {
        // The CSS defaults are the supported fallback when the local settings endpoint is unavailable.
      });
    return () => { active = false; };
  }, [authState]); // `api` is recreated with Store state; authentication is the intended reload boundary.

  return null;
}
