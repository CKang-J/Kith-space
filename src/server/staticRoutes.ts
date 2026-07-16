export function shouldServeAppShell(pathname: string): boolean {
  const normalized = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  if (normalized === "/") return true;
  // Keep the retired /showcase URL as an SPA fallback only; the client normalizes it to a real conversation.
  return /^\/s\/[^/]+(?:\/(?:channel(?:\/[^/]+)?|saved|showcase))?$/.test(normalized);
}
