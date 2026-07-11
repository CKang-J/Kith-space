export const DESKTOP_TRUST_HEADER = "x-kith-desktop-token";

export interface DesktopOriginPolicy {
  corePort: number;
  uiPort?: number;
}

function loopbackUrl(rawUrl: string, protocols: ReadonlySet<string>): URL | null {
  try {
    const url = new URL(rawUrl);
    if (!protocols.has(url.protocol) || url.hostname !== "127.0.0.1") return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

export function isAllowedDesktopUrl(rawUrl: string, policy: DesktopOriginPolicy): boolean {
  const url = loopbackUrl(rawUrl, new Set(["http:"]));
  if (!url) return false;
  const port = Number(url.port || "80");
  return port === policy.corePort || port === policy.uiPort;
}

/**
 * Desktop trust is attached by Electron, never renderer JavaScript. In development the Vite
 * origin receives it only for requests that Vite proxies to Core; static assets remain ordinary.
 */
export function shouldAttachDesktopTrust(rawUrl: string, policy: DesktopOriginPolicy): boolean {
  const url = loopbackUrl(rawUrl, new Set(["http:", "ws:"]));
  if (!url) return false;
  const port = Number(url.port || "80");
  if (url.protocol === "ws:") {
    return (port === policy.corePort || port === policy.uiPort) && url.pathname.startsWith("/socket.io/");
  }
  if (url.pathname === "/api/desktop" || url.pathname.startsWith("/api/desktop/")) return false;
  if (port === policy.corePort) {
    return true;
  }
  return port === policy.uiPort
    && (url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/"));
}
