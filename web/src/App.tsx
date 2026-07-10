import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Layout } from "./Layout.tsx";
import { WorkspaceFrame } from "./shell/WorkspaceFrame.tsx";
import "./shell/shell.css";

export function App() {
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const [useLegacyLayout] = useState(() => search.get("legacy") === "1");
  search.set("legacy", "1");
  const legacyHref = `${location.pathname}?${search.toString()}${location.hash}`;

  if (useLegacyLayout) return <Layout />;
  return <WorkspaceFrame legacyHref={legacyHref} />;
}
