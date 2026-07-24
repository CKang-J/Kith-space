import { useEffect } from "react";
import { applyAppearanceFonts, isAppearanceSettings } from "./appearanceFonts.ts";
import { useStore } from "./store.tsx";

/** Loads installation typography after authentication and keeps the document root in sync. */
export function AppearanceFontSync() {
  const { api, authState } = useStore();

  useEffect(() => {
    if (authState !== "authed") return;
    let active = true;
    api("GET", "/api/settings/appearance")
      .then((result) => {
        if (active && isAppearanceSettings(result)) applyAppearanceFonts(result);
      })
      .catch(() => {
        // The CSS defaults are the supported fallback when the local settings endpoint is unavailable.
      });
    return () => { active = false; };
  }, [authState]); // `api` is recreated with Store state; authentication is the intended reload boundary.

  return null;
}
