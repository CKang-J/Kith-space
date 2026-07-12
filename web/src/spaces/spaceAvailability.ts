import type { SpaceInfo } from "../store.tsx";

export function readySpace(spaces: SpaceInfo[], preferredSlug?: string): SpaceInfo | undefined {
  return spaces.find((space) => space.slug === preferredSlug && space.status === "ready")
    ?? spaces.find((space) => space.status === "ready");
}

export function initialReadySpace(spaces: SpaceInfo[], requestedSlug?: string): SpaceInfo | undefined {
  return spaces.find((space) => space.slug === requestedSlug && space.status === "ready")
    ?? spaces.find((space) => space.isHome && space.status === "ready")
    ?? spaces.find((space) => space.status === "ready");
}

export function routeSpaceAvailability(spaces: SpaceInfo[], routeSlug: string | undefined, activeSlug: string) {
  const routeSpace = routeSlug ? spaces.find((space) => space.slug === routeSlug) : undefined;
  return {
    routeSpace,
    routeReady: routeSpace?.status === "ready",
    fallback: readySpace(spaces, activeSlug),
  };
}
