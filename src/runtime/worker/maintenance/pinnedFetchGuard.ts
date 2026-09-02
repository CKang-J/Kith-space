import net from "node:net";
import { Agent } from "undici";

export function installPinnedFetchGuard(input: { allowedEgress: string[]; pinnedAddresses: string[] }): () => Promise<void> {
  // Allowed egress entries may carry a base path (OpenAI-compatible /v1
  // endpoints); the request origin must match an allowlisted entry's origin.
  // The pinned addresses still pin the exact host, and redirects stay rejected.
  let allowedOrigins: Set<string>;
  try {
    allowedOrigins = new Set(input.allowedEgress.map((entry) => new URL(entry).origin));
  } catch {
    throw new Error("provider_request_invalid");
  }
  const pinned = [...new Set(input.pinnedAddresses)];
  if (!pinned.length || pinned.some((address) => net.isIP(address) === 0)) throw new Error("provider_request_invalid");
  const dispatcher = new Agent({ connect: { lookup(_hostname, options, callback) {
    const requestedFamily = typeof options === "object" && (options.family === 4 || options.family === 6) ? options.family : 0;
    const candidates = pinned.map((address) => ({ address, family: net.isIPv4(address) ? 4 as const : 6 as const }))
      .filter((item) => requestedFamily === 0 || item.family === requestedFamily);
    if (!candidates.length) return callback(Object.assign(new Error("provider_postflight_destination_mismatch"), { code: "ENOTFOUND" }), "", 0);
    if (typeof options === "object" && options.all) return callback(null, candidates as any);
    return callback(null, candidates[0]!.address, candidates[0]!.family);
  } } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (resource: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource));
    if (!allowedOrigins.has(url.origin) || url.username || url.password) throw new Error("provider_postflight_destination_mismatch");
    const response = await originalFetch(resource, { ...init, redirect: "manual", dispatcher } as RequestInit & { dispatcher: Agent });
    if (response.status >= 300 && response.status < 400) throw new Error("provider_postflight_destination_mismatch");
    return response;
  }) as typeof fetch;
  return async () => { globalThis.fetch = originalFetch; await dispatcher.close(); };
}
