import http from "node:http";
import net from "node:net";
import { Agent, request } from "undici";

const HOP_HEADERS = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host"]);

/** Loopback-only reverse proxy that binds Claude CLI to the approved origin and DNS lease. */
export async function startPinnedOriginProxy(origin: string, pinnedAddresses: string[]): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const target = new URL(origin);
  let cursor = 0;
  const dispatcher = new Agent({ connect: {
    lookup(hostname, _options, callback) {
      if (hostname !== target.hostname || !pinnedAddresses.length) { callback(new Error("provider_preflight_destination_mismatch"), "", 4); return; }
      const address = pinnedAddresses[cursor++ % pinnedAddresses.length]!;
      callback(null, address, net.isIPv6(address) ? 6 : 4);
    },
  } });
  const server = http.createServer((incoming, outgoing) => {
    if (!incoming.url?.startsWith("/") || incoming.url.startsWith("//")) { outgoing.writeHead(400).end(); return; }
    const headers = Object.fromEntries(Object.entries(incoming.headers)
      .filter(([name, value]) => !HOP_HEADERS.has(name.toLowerCase()) && value !== undefined));
    void request(new URL(incoming.url, target), {
      method: incoming.method as any,
      headers,
      body: incoming.method === "GET" || incoming.method === "HEAD" ? undefined : incoming,
      dispatcher,
      headersTimeout: 75_000,
      bodyTimeout: 75_000,
    }).then((upstream) => {
      if (upstream.statusCode >= 300 && upstream.statusCode < 400) {
        upstream.body.destroy();
        outgoing.writeHead(502).end();
        return;
      }
      const responseHeaders = Object.fromEntries(Object.entries(upstream.headers)
        .filter(([name, value]) => !HOP_HEADERS.has(name.toLowerCase()) && value !== undefined));
      outgoing.writeHead(upstream.statusCode, responseHeaders as http.OutgoingHttpHeaders);
      upstream.body.pipe(outgoing);
    }).catch(() => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("provider_unavailable");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await dispatcher.close();
    },
  };
}
