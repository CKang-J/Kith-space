import http from "node:http";
import type { IncomingMessage, ServerResponse, Server } from "node:http";

/** Resolve the managed Desktop dev Vite origin, if configured. */
export function resolveViteDevProxyOrigin(): URL | null {
  const raw = process.env.KITH_SPACE_VITE_DEV_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" || !url.hostname || !url.port) return null;
    return url;
  } catch {
    return null;
  }
}

/** Frontend paths owned by Core/API stay local; everything else can be proxied to Vite in dev. */
export function shouldProxyPathToViteDev(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return false;
  if (pathname.startsWith("/agent-api/")) return false;
  if (pathname.startsWith("/agent-gateway/")) return false;
  if (pathname.startsWith("/socket.io/")) return false;
  if (pathname === "/health" || pathname === "/daemon/connect") return false;
  return true;
}

function forwardHeaders(req: IncomingMessage): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { ...req.headers };
  delete headers.connection;
  delete headers.host;
  if (typeof req.headers.host === "string") headers.host = req.headers.host;
  return headers;
}

/** Proxy a browser frontend request to the managed Vite dev server. */
export async function proxyHttpToViteDev(
  req: IncomingMessage,
  res: ServerResponse,
  viteOrigin: URL,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!shouldProxyPathToViteDev(url.pathname)) return false;

  return new Promise((resolve) => {
    const proxyReq = http.request(
      {
        hostname: viteOrigin.hostname,
        port: Number(viteOrigin.port),
        path: req.url,
        method: req.method,
        headers: forwardHeaders(req),
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
        proxyRes.on("end", () => resolve(true));
      },
    );
    proxyReq.on("error", () => {
      if (!res.headersSent) sendProxyUnavailable(res);
      else res.end();
      resolve(true);
    });
    req.pipe(proxyReq);
  });
}

function sendProxyUnavailable(res: ServerResponse): void {
  res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
  res.end("Vite dev server is unavailable. Wait for desktop:dev to finish starting, then refresh.");
}

/** Pipe non-Core websocket upgrades to Vite so HMR works through the browser-access port. */
export function attachViteDevProxyUpgrade(server: Server, viteOrigin: URL): void {
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!shouldProxyPathToViteDev(url.pathname)) return;

    const proxyReq = http.request({
      hostname: viteOrigin.hostname,
      port: Number(viteOrigin.port),
      path: req.url,
      method: req.method,
      headers: forwardHeaders(req),
    });

    proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
      const headerLines = Object.entries(proxyRes.headers)
        .flatMap(([key, value]) => {
          if (value === undefined) return [];
          return Array.isArray(value)
            ? value.map((entry) => `${key}: ${entry}`)
            : [`${key}: ${value}`];
        })
        .join("\r\n");
      socket.write(`HTTP/1.1 ${proxyRes.statusCode ?? 101} ${proxyRes.statusMessage ?? "Switching Protocols"}\r\n${headerLines}\r\n\r\n`);
      if (proxyHead.length) socket.write(proxyHead);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
    });

    proxyReq.on("error", () => {
      socket.destroy();
    });

    proxyReq.end();
  });
}
