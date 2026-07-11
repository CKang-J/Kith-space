// Control plane entry point: HTTP (/api/* human, /agent-api/* agent) + WS (/daemon/connect) + SSE
import "../env.js"; // must be first: loads .env before any module reads process.env (e.g. db)
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import helmet from "helmet";
import { handleApi } from "./routes-api/index.js";
import { handleAgentApi } from "./routes-agent.js";
import { attachWs } from "./ws.js";
import { attachSocketIO } from "./socketio.js";
import { initRealtime } from "./realtime.js";
import { startReminderScheduler } from "./reminders.js";
import { reconcileCounters } from "../counters.js";
import { isWorkerConnected } from "../local-runtime/workerHub.js";
import { sendJson, sendErr } from "./util.js";
import { createLogger } from "../log.js";
import { shouldServeAppShell } from "./staticRoutes.js";
import { BrowserAccessPolicy } from "../browser-access/index.js";
import { assertInternalCredentialsConfigured, isDesktopTrustedRequest } from "../local-runtime/internalCredentials.js";
import { browserOriginAllowed, requestPeerIsLoopback } from "./browserSessionHttp.js";
import { resolveCorePort } from "./localEndpoint.js";

assertInternalCredentialsConfigured();

// ── Security headers (helmet) ────────────────────────────────────────────────
// CSP, COEP, and CORP are disabled here: the Vite-built frontend uses inline
// scripts/styles and may load cross-origin assets. Add proper CSP directives
// once the frontend's nonce/hash strategy is established.
const helmetMiddleware = helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
});
const applyHelmet = (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> =>
  new Promise((resolve, reject) =>
    helmetMiddleware(req, res, (err?: unknown) => (err ? reject(err as Error) : resolve()))
  );

const redirect = (res: import("node:http").ServerResponse, location: string): void => {
  res.writeHead(308, { location });
  res.end();
};

const accessPolicy = new BrowserAccessPolicy();
const listenerPolicy = accessPolicy.getListenerPolicy();
// Core always needs a private listener for Desktop/Worker. `browserEnabled=false` closes only the ordinary
// browser product entrance; it does not remove the Desktop's loopback transport.
const PORT = resolveCorePort(process.env, accessPolicy);
const HOST = listenerPolicy.host;
const WEBDIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
const DOCSDIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs-site/dist");
const log = createLogger("server");
initRealtime();

const CTYPE: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json" };

function corsOriginHeader(req: http.IncomingMessage): string | null {
  const origin = req.headers.origin;
  if (!origin) return null;
  if (isDesktopTrustedRequest(req)) return origin;
  return browserOriginAllowed(req, accessPolicy.getSettings().mode, true) ? origin : null;
}

function canServeProductShell(req: http.IncomingMessage): boolean {
  if (isDesktopTrustedRequest(req)) return true;
  const settings = accessPolicy.getSettings();
  return settings.mode !== "off" && browserOriginAllowed(req, settings.mode);
}

async function serveStatic(res: import("node:http").ServerResponse, pathname: string): Promise<boolean> {
  const rel = pathname === "/" ? "/index.html" : pathname;
  let file = path.join(WEBDIST, rel);
  if (!file.startsWith(WEBDIST)) file = path.join(WEBDIST, "index.html");
  let data: Buffer; let ext = path.extname(file);
  try { data = await readFile(file); }
  catch {
    if (!shouldServeAppShell(pathname)) return false;
    try { data = await readFile(path.join(WEBDIST, "index.html")); ext = ".html"; } catch { return false; }
  }
  res.writeHead(200, { "content-type": CTYPE[ext] || "application/octet-stream" });
  res.end(data); return true;
}

async function serveDocs(res: import("node:http").ServerResponse, pathname: string, sendBody = true): Promise<boolean> {
  const withoutPrefix = pathname === "/docs" ? "/" : pathname.slice("/docs".length);
  const rel = withoutPrefix === "/" ? "/index.html" : withoutPrefix;
  let file = path.join(DOCSDIST, rel);
  if (!file.startsWith(DOCSDIST)) file = path.join(DOCSDIST, "index.html");
  let data: Buffer; let ext = path.extname(file);
  try { data = await readFile(file); }
  catch { try { data = await readFile(path.join(DOCSDIST, "index.html")); ext = ".html"; } catch { return false; } }
  res.writeHead(200, { "content-type": CTYPE[ext] || "application/octet-stream" });
  res.end(sendBody ? data : undefined); return true;
}

async function serveDocsAsset(res: import("node:http").ServerResponse, pathname: string, sendBody = true): Promise<boolean> {
  let file = path.join(DOCSDIST, pathname);
  if (!file.startsWith(DOCSDIST)) return false;
  let data: Buffer; const ext = path.extname(file);
  try { data = await readFile(file); } catch { return false; }
  res.writeHead(200, { "content-type": CTYPE[ext] || "application/octet-stream" });
  res.end(sendBody ? data : undefined); return true;
}

const server = http.createServer(async (req, res) => {
  await applyHelmet(req, res);
  const allowedOrigin = corsOriginHeader(req);
  if (allowedOrigin) {
    res.setHeader("access-control-allow-origin", allowedOrigin);
    res.setHeader("access-control-allow-credentials", "true");
    res.setHeader("vary", "Origin");
  }
  res.setHeader("access-control-allow-headers", "authorization,content-type,x-space-id,x-agent-id,x-kith-csrf");
  res.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") {
    if (req.headers.origin && !allowedOrigin) return sendErr(res, 403, "origin not allowed");
    res.writeHead(204); return res.end();
  }

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname.startsWith("/socket.io/")) return; // pass-through: handled by socket.io's own request listener (polling/handshake)
  const method = req.method ?? "GET";
  const t0 = Date.now();
  res.on("finish", () => log.debug("req", { method, path: url.pathname, status: res.statusCode, ms: Date.now() - t0 }));
  try {
    if (url.pathname === "/health") {
      if (!requestPeerIsLoopback(req) && !isDesktopTrustedRequest(req)) return sendErr(res, 404, "not found");
      return sendJson(res, 200, { ok: true, service: "kith-space", workerConnected: isWorkerConnected(), time: new Date().toISOString() });
    }
    if (await handleAgentApi(req, res, url, method)) return;
    if (await handleApi(req, res, url, method)) return;
    const isRead = method === "GET" || method === "HEAD";
    if (isRead && !canServeProductShell(req)) return sendErr(res, 403, "browser access is disabled");
    if (isRead && url.pathname === "/docs") return redirect(res, "/docs/");
    if (isRead && url.pathname.startsWith("/docs/") && await serveDocs(res, url.pathname, method === "GET")) return;
    if (isRead && url.pathname.startsWith("/_astro/") && await serveDocsAsset(res, url.pathname, method === "GET")) return;
    // Static frontend (web/dist) + SPA fallback (client-side routing /s/:space/*)
    if (method === "GET" && await serveStatic(res, url.pathname)) return;
    sendErr(res, 404, "not found");
  } catch (e: any) {
    log.error("request error", { path: url.pathname, method, detail: String(e?.message ?? e), stack: e?.stack });
    try { sendErr(res, 500, "internal", { detail: String(e?.message ?? e) }); } catch { /* */ }
  }
});

attachSocketIO(server); // human-side realtime (socket.io, /socket.io/)
attachWs(server);       // daemon control plane (raw ws, /daemon/connect)
startReminderScheduler(); // reminder scheduler: fires at due time, wakes the author

server.on("error", (error: NodeJS.ErrnoException) => {
  const message = error.code === "EADDRINUSE"
    ? `Core Service port ${PORT} is already in use`
    : `Core Service failed to listen on ${HOST}:${PORT}: ${error.message}`;
  log.error("control plane listen failed", { code: error.code, host: HOST, port: PORT, detail: error.message });
  process.send?.({ type: "kith:core-error", code: error.code ?? "LISTEN_FAILED", message, port: PORT });
  setImmediate(() => process.exit(1));
});

// Durability guard: before accepting traffic, align in-memory seq/task counters to each Space DB maximum.
// Prevents seq rollback and silent message drops after a process restart.
reconcileCounters()
  .then((r) => log.info("counters reconciled", r))
  .catch((e) => log.error("counter reconcile failed (continuing)", { detail: String(e?.message ?? e) }))
  .finally(() => server.listen(PORT, HOST, () => {
    log.info("control plane up", { url: `http://${HOST}:${PORT}`, browserMode: accessPolicy.getSettings().mode, health: `http://${HOST}:${PORT}/health`, logs: "~/.kith-space/logs/" });
    process.send?.({ type: "kith:core-ready", host: HOST, port: PORT, browserMode: accessPolicy.getSettings().mode });
  }));

let shutdownStarted = false;
const shutdown = () => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  const forcedExit = setTimeout(() => process.exit(0), 3_000);
  forcedExit.unref();
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("message", (message: unknown) => {
  if ((message as { type?: unknown } | null)?.type === "kith:shutdown") shutdown();
});
