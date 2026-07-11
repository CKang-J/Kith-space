// Build-time SSR entry used only to give the Cookie-session bootstrap a non-empty, shift-free
// first paint. The browser replaces this snapshot with the live route after checking the session.
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { WorkspaceSkeleton } from "./views/Skeleton.tsx";
import "./i18n";

export function renderBootstrapShell(): string {
  return renderToString(
    <StaticRouter location="/">
      <WorkspaceSkeleton chat />
    </StaticRouter>,
  );
}
