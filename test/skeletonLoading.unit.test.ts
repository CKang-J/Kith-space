// Unit regression for the loading skeletons (WorkspaceSkeleton / ChatSkeleton).
// Run: npx tsx --test --test-force-exit test/skeletonLoading.unit.test.ts
//
// Guards three things that are easy to silently break:
//   1. ready=false / switch-in-flight renders a skeleton, not a blank null (main.tsx route guards).
//   2. The workspace skeleton follows the current single-window shell and its shared primary card.
//   3. The shimmer is disabled under prefers-reduced-motion.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
const mainTsx = fs.readFileSync(new URL("../web/src/main.tsx", import.meta.url), "utf8");
const skeletonTsx = fs.readFileSync(new URL("../web/src/views/Skeleton.tsx", import.meta.url), "utf8");

test("route guards render the skeleton (not a blank null) while bootstrapping / switching", () => {
  const skeletonHits = (mainTsx.match(/<WorkspaceSkeleton\s*\/>/g) || []).length;
  assert.ok(skeletonHits >= 2, `expected WorkspaceSkeleton in both route guards, found ${skeletonHits}`);
  assert.doesNotMatch(mainTsx, /!ready\)\s*return null/, "ready=false must no longer fall through to a blank null");
});

test("workspace skeleton follows the current single-window shell and panel language", () => {
  assert.match(skeletonTsx, /className="shell-workspace-frame skel-workspace"/, "skeleton must reuse the workspace frame");
  assert.match(skeletonTsx, /className="shell-workspace-canvas skel-workspace-canvas"/, "skeleton must reuse the gray workspace canvas");
  assert.doesNotMatch(skeletonTsx, /shell-topbar|skel-topbar/, "the retired global top bar must not remain in the skeleton");
  assert.match(skeletonTsx, /<NavigationRailSkeleton itemCount=\{navigationItemCount\} \/>/, "the persistent icon rail must load in every workspace state");
  assert.match(skeletonTsx, /skel-navigation-rail/, "the icon rail must have dedicated placeholders");
  assert.match(skeletonTsx, /shell-primary-workspace-card shell-chat-main-card/, "Chat must use the shared primary card");
  assert.match(skeletonTsx, /shell-primary-workspace-card shell-module-workspace/, "module loading must use the shared primary card");
  assert.match(skeletonTsx, /WORKSPACE_MODULES\.has\(requestedModule\)/, "only legal module query values may change the skeleton mode");
  assert.match(skeletonTsx, /"spaces"/, "Home Spaces must be recognized as a legal content module");
  assert.match(skeletonTsx, /"search"/, "Search deep links must keep the module loading skeleton");
  assert.match(skeletonTsx, /pathname\.startsWith\("\/s\/home\/"\) \? 7 : 6/, "the icon rail skeleton must match Home and regular Space item counts");
  assert.match(skeletonTsx, /activeModule !== "settings"/, "Settings must keep the Chat skeleton behind its modal");
  assert.match(skeletonTsx, /contentModule \? <ModulePanelSkeleton \/> : <ChatPanelSkeleton \/>/, "module loading must replace Chat and its message pane");
  assert.doesNotMatch(skeletonTsx, /DockSkeleton|workspace-dock|shell-dock-zone/, "the retired Dock must not return");

  assert.doesNotMatch(skeletonTsx, /(?:^|[\s"'])\.app(?:[\s"'.]|$)/m, "the retired .app shell must not return");
  assert.doesNotMatch(skeletonTsx, /has-traj/, "the retired trace-column modifier must not return");
  assert.doesNotMatch(skeletonTsx, /Layout/, "the skeleton must not refer to the retired layout component");

  assert.doesNotMatch(css, /\.skel-(?:app|sb|traj)\b/, "old skeleton-only shell selectors must be removed");
  assert.match(css, /\.skel-workspace\{background:var\(--shell-bg/, "workspace skeleton must use the shell canvas token");
  assert.match(css, /\.skel-(?:conversations|trace)[^}]*background:var\(--shell-panel/, "work panels must use the shell panel token");
});

test("skeleton blocks shimmer, and the shimmer is removed under prefers-reduced-motion", () => {
  assert.match(css, /@keyframes\s+skel-shimmer/, "skel-shimmer keyframes must exist");
  const after = /\.skel-box::after\s*\{([^}]*)\}/.exec(css);
  assert.ok(after, "missing .skel-box::after rule (the shimmer sweep)");
  assert.match(after![1]!, /animation:\s*skel-shimmer/, "the shimmer must run on .skel-box::after");
  assert.match(
    css,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.skel-box::after\s*\{\s*display:\s*none/,
    "prefers-reduced-motion must disable the skeleton shimmer",
  );
});
