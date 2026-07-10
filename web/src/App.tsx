import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Layout } from "./Layout.tsx";
import { OverviewShell } from "./shell/OverviewShell.tsx";
import { SpaceShell } from "./shell/SpaceShell.tsx";
import { useShellStore } from "./shell/shellStore.ts";
import "./shell/shell.css";

export function App() {
  const location = useLocation();
  const { view } = useShellStore();
  const search = new URLSearchParams(location.search);
  const [useLegacyLayout] = useState(() => search.get("legacy") === "1");
  search.set("legacy", "1");
  const legacyHref = `${location.pathname}?${search.toString()}${location.hash}`;

  if (useLegacyLayout) return <Layout />;
  if (view === "overview") return <OverviewShell legacyHref={legacyHref} />;
  return <SpaceShell legacyHref={legacyHref} />;
}
