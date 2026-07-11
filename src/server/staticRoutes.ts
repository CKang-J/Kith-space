export function shouldServeAppShell(pathname: string): boolean {
  const normalized = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  if (normalized === "/") return true;
  return /^\/s\/[^/]+(?:\/(?:channel(?:\/[^/]+)?|saved|showcase))?$/.test(normalized);
}
