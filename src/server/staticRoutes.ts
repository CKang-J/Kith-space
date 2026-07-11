const APP_SHELL_EXACT_PATHS = new Set(["/", "/features"]);

export function shouldServeAppShell(pathname: string): boolean {
  const normalized = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  if (APP_SHELL_EXACT_PATHS.has(normalized)) return true;
  return pathname.startsWith("/s/");
}
