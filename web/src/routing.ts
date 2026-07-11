// Pure browser-session routing decisions, kept free of React/DOM for unit tests.
// HttpOnly Cookies cannot be inspected synchronously, so the first render always waits for
// GET /api/browser-auth/session before showing either protected UI or the Access Token gate.
export type AuthState = "loading" | "authed" | "anon";

export function initialAuthState(): AuthState {
  return "loading";
}

export type HomeView = "gate" | "skeleton" | "redirect";

export function homeRoute(state: { authState: AuthState; ready: boolean }): HomeView {
  if (state.authState === "anon") return "gate";
  if (state.authState === "loading" || !state.ready) return "skeleton";
  return "redirect";
}
