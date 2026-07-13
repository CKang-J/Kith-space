import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { StoreProvider, useStore } from "./store.tsx";
import { WorkspaceSkeleton } from "./views/Skeleton.tsx";
import { ConfirmProvider } from "./ConfirmModal.tsx";
import { ToastProvider } from "./toast.tsx";
import { App } from "./App.tsx";
import { AccessTokenGate } from "./views/AccessTokenGate.tsx";
import { DesktopSetupBoundary } from "./personalSetupBoundary.tsx";
import { homeRoute } from "./routing.ts";
import { parseWorkspaceRoute, SPACE_ROUTE_PATTERN } from "./shell/workspaceRoute.ts";
import { readySpace, routeSpaceAvailability } from "./spaces/spaceAvailability.ts";
import { SpaceRecovery } from "./spaces/SpaceRecovery.tsx";
import "./i18n";
import "./styles.css";
import "./scrollbar";

// Home waits for the HttpOnly Cookie session bootstrap. Anonymous browser clients see the Access
// Token gate; authenticated clients go straight to their Space without flashing the gate.
function ProductEntry() {
  const { slug, ready, authState, spaces } = useStore();
  if (ready && authState === "authed" && !readySpace(spaces)) return <SpaceRecovery />;
  switch (homeRoute({ authState, ready })) {
    case "redirect": return <Navigate to={`/s/${slug}/channel`} replace />;
    case "skeleton": return <WorkspaceSkeleton chat />; // bootstrap → we'll land on /channel, so render the 4-col chat skeleton now (shift-free)
    default: return <AccessTokenGate />;
  }
}

// Root / unmatched path: wait for bootstrap, then redirect to the local workspace or the Token Gate.
function RootRedirect() {
  const { slug, ready, authState, spaces } = useStore();
  if (!ready) return <WorkspaceSkeleton />; // bootstrap in flight: show the workspace skeleton, not a blank screen
  if (authState !== "authed") return <Navigate to="/" replace />;
  if (!readySpace(spaces)) return <SpaceRecovery />;
  return <Navigate to={`/s/${slug}/channel`} replace />;
}

// Auth guard + Space activation for /s/:slug/*. The URL is the source of truth for the active Space: if it
// names a known Space that isn't active yet, switch to it client-side (no full-page reload) and show the skeleton
// while it loads. The auth check runs before the workspace shell renders, so an unauthenticated visitor returns home
// without the workspace ever painting (no flash of protected UI).
function WorkspaceRoute() {
  const { slug: activeSlug, ready, authState, spaces, switchSpace } = useStore();
  const { slug: routeSlug } = useParams();
  const loc = useLocation();
  const { routeSpace, routeReady, fallback } = routeSpaceAvailability(spaces, routeSlug, activeSlug);
  // URL → store: a known-but-not-active slug (Space switcher, deep link, browser back/forward) drives a client-side switch.
  useEffect(() => { if (ready && authState === "authed" && routeReady && routeSlug !== activeSlug) switchSpace(routeSlug!); }, [ready, authState, routeReady, routeSlug, activeSlug, switchSpace]);
  if (!ready || (routeReady && routeSlug !== activeSlug)) return <WorkspaceSkeleton />; // bootstrap or a switch in flight → skeleton (do NOT bounce the URL while slug catches up)
  if (authState !== "authed") return <Navigate to="/" replace />;
  if (!fallback) return <SpaceRecovery />;
  if (routeSpace && !routeReady) {
    const pathname = loc.pathname.replace(/^\/s\/[^/]+/, `/s/${fallback.slug}`);
    return <Navigate to={`${pathname}${loc.search}${loc.hash}`} replace />;
  }
  if (routeSlug !== activeSlug) { // unknown / stale slug → canonicalize to a usable Space
    const pathname = loc.pathname.replace(/^\/s\/[^/]+/, `/s/${fallback.slug}`);
    return <Navigate to={`${pathname}${loc.search}${loc.hash}`} replace />;
  }
  if (parseWorkspaceRoute(loc.pathname).section === null) {
    return <Navigate to={`/s/${activeSlug}/channel${loc.search}${loc.hash}`} replace />;
  }
  return <App />;
}

function ProductRoot() {
  return (
    <StoreProvider>
      <ConfirmProvider>
      <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ProductEntry />} />
          <Route path={SPACE_ROUTE_PATTERN} element={<WorkspaceRoute />} />
          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </BrowserRouter>
      </ToastProvider>
      </ConfirmProvider>
    </StoreProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DesktopSetupBoundary>
      <ProductRoot />
    </DesktopSetupBoundary>
  </React.StrictMode>,
);
