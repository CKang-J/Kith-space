import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Layout } from "./Layout.tsx";
import { OverviewShell } from "./shell/OverviewShell.tsx";
import { SpaceShell } from "./shell/SpaceShell.tsx";
import { shellActions, useShellStore, type MiddleView } from "./shell/shellStore.ts";
import "./shell/shell.css";

function middleViewFromPathname(pathname: string): MiddleView {
  if (/\/s\/[^/]+\/(?:agent|human)(?:\/|$)/.test(pathname)) return "members";
  if (/\/s\/[^/]+\/computer(?:\/|$)/.test(pathname)) return "machines";
  if (/\/s\/[^/]+\/inbox(?:\/|$)/.test(pathname)) return "inbox";
  if (/\/s\/[^/]+\/search(?:\/|$)/.test(pathname)) return "search";
  return "chat";
}

export function App() {
  const location = useLocation();
  const { view } = useShellStore();
  const search = new URLSearchParams(location.search);
  const [useLegacyLayout] = useState(() => search.get("legacy") === "1");
  search.set("legacy", "1");
  const legacyHref = `${location.pathname}?${search.toString()}${location.hash}`;

  useEffect(() => {
    if (!useLegacyLayout && view === "space") {
      shellActions.setMiddleView(middleViewFromPathname(location.pathname));
    }
  }, [location.pathname, useLegacyLayout, view]);

  if (useLegacyLayout) return <Layout />;
  if (view === "overview") return <OverviewShell legacyHref={legacyHref} />;
  return <SpaceShell legacyHref={legacyHref} />;
}
