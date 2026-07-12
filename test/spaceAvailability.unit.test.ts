import assert from "node:assert/strict";
import test from "node:test";
import { initialReadySpace, readySpace, routeSpaceAvailability } from "../web/src/spaces/spaceAvailability.ts";
import type { SpaceInfo } from "../web/src/store.tsx";

const missingHome: SpaceInfo = { id: "home-id", name: "Home", slug: "home", status: "missing", isHome: true };
const readyProject: SpaceInfo = { id: "project-id", name: "Project", slug: "project", status: "ready", isHome: false };

test("a missing Space deep link falls back to an available Space", () => {
  const result = routeSpaceAvailability([missingHome, readyProject], "home", "project");
  assert.equal(result.routeSpace, missingHome);
  assert.equal(result.routeReady, false);
  assert.equal(result.fallback, readyProject);
});

test("an installation with only unavailable Spaces enters recovery", () => {
  const result = routeSpaceAvailability([missingHome], "home", "home");
  assert.equal(result.routeReady, false);
  assert.equal(result.fallback, undefined);
  assert.equal(readySpace([missingHome]), undefined);
});

test("a ready route remains the preferred target", () => {
  const result = routeSpaceAvailability([missingHome, readyProject], "project", "home");
  assert.equal(result.routeReady, true);
  assert.equal(result.fallback, readyProject);
});

test("cold start chooses stable Home while an explicit ready deep link wins", () => {
  const home = { ...missingHome, status: "ready" as const };
  assert.equal(initialReadySpace([readyProject, home]), home);
  assert.equal(initialReadySpace([home, readyProject], "project"), readyProject);
});
