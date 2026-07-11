import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { StoreProvider, useStore } from "./store.tsx";
import { WorkspaceSkeleton } from "./views/Skeleton.tsx";
import { ConfirmProvider } from "./ConfirmModal.tsx";
import { ToastProvider } from "./toast.tsx";
import { App } from "./App.tsx";
import { Chat } from "./views/Chat.tsx";
import { Showcase } from "./views/Showcase.tsx";
import { Agents } from "./views/Members.tsx";
import { Tasks, Computers, Search, Settings, Inbox, Saved } from "./views/misc.tsx";
import { Landing } from "./views/Landing.tsx";
import { Features } from "./views/Features.tsx";
import { homeRoute } from "./routing.ts";
import { SPACE_ROUTE_PATTERN } from "./shell/workspaceRoute.ts";
import "./i18n";
import "./styles.css";

// Public home ("/"). The marketing Landing is for anonymous visitors only; a user who has — or is
// still resolving — a session must never see it. While the bootstrap runs we show the workspace
// skeleton (NOT the marketing page, and NOT a blank screen), then send an authed user to their
// workspace. Same "wait for bootstrap before deciding" gate as RootRedirect/WorkspaceRoute, so
// every route is consistent and there is no flash of the wrong screen on refresh/deep-link.
function PublicHome() {
  const { slug, ready, authState } = useStore();
  switch (homeRoute({ authState, ready })) {
    case "redirect": return <Navigate to={`/s/${slug}/channel`} replace />;
    case "skeleton": return <WorkspaceSkeleton chat />; // bootstrap → we'll land on /channel, so render the 4-col chat skeleton now (shift-free)
    default: return <Landing />;
  }
}

// Root / unmatched path: wait for bootstrap, then redirect to the local workspace or the public home.
function RootRedirect() {
  const { slug, ready, authState } = useStore();
  if (!ready) return <WorkspaceSkeleton />; // bootstrap in flight: show the workspace skeleton, not a blank screen
  if (authState !== "authed") return <Navigate to="/" replace />;
  return <Navigate to={`/s/${slug}/channel`} replace />;
}

// Auth guard + Space activation for /s/:slug/*. The URL is the source of truth for the active Space: if it
// names a known Space that isn't active yet, switch to it client-side (no full-page reload) and show the skeleton
// while it loads. The auth check runs BEFORE <Layout/> renders, so an unauthenticated visitor returns to public home
// without the workspace ever painting (no flash of protected UI).
function WorkspaceRoute() {
  const { slug: activeSlug, ready, authState, spaces, switchSpace } = useStore();
  const { slug: routeSlug } = useParams();
  const loc = useLocation();
  const known = !!routeSlug && spaces.some((space) => space.slug === routeSlug); // is the URL's slug a registered Space?
  // URL → store: a known-but-not-active slug (Space switcher, deep link, browser back/forward) drives a client-side switch.
  useEffect(() => { if (ready && authState === "authed" && known && routeSlug !== activeSlug) switchSpace(routeSlug!); }, [ready, authState, known, routeSlug, activeSlug, switchSpace]);
  if (!ready || (known && routeSlug !== activeSlug)) return <WorkspaceSkeleton />; // bootstrap or a switch in flight → skeleton (do NOT bounce the URL while slug catches up)
  if (authState !== "authed") return <Navigate to="/" replace />; // A3 replaces the temporary JWT gate with access-token sessions
  if (routeSlug !== activeSlug) { // unknown / stale slug → canonicalize to the active Space
    const pathname = loc.pathname.replace(/^\/s\/[^/]+/, `/s/${activeSlug}`);
    return <Navigate to={`${pathname}${loc.search}${loc.hash}`} replace />;
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StoreProvider>
      <ConfirmProvider>
      <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<PublicHome />} />
          <Route path="/features" element={<Features />} />
          <Route path={SPACE_ROUTE_PATTERN} element={<WorkspaceRoute />}>
            <Route index element={<Navigate to="channel" replace />} />
            <Route path="inbox" element={<Inbox />} />
            <Route path="saved" element={<Saved />} />
            <Route path="showcase" element={<Showcase />} />
            <Route path="channel" element={<Chat />} />
            <Route path="channel/:channelId" element={<Chat />} />
            <Route path="agent" element={<Agents />} />
            <Route path="agent/:agentId" element={<Agents />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="tasks/:channelId" element={<Tasks />} />
            <Route path="computer" element={<Computers />} />
            <Route path="computer/:machineId" element={<Computers />} />
            <Route path="search" element={<Search />} />
            <Route path="settings" element={<Settings />} />
            <Route path="settings/:section" element={<Settings />} />
          </Route>
          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </BrowserRouter>
      </ToastProvider>
      </ConfirmProvider>
    </StoreProvider>
  </React.StrictMode>,
);
