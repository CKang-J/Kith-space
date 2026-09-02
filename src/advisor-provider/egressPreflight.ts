import { createHash } from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { AdvisorProviderError, type AdvisorNetworkClass, type ResolvedEgressPlan } from "./contracts.js";

export interface EgressPreflightInput {
  canonicalOrigin: string;
  networkClass: AdvisorNetworkClass;
  allowedEgress: string[];
  proxyUrl?: string;
  allowDeclaredProxy?: boolean;
}

export interface PreparedEgressLease {
  plan: ResolvedEgressPlan;
  pinnedAddresses: string[];
}

function fail(): never { throw new AdvisorProviderError("provider_preflight_destination_mismatch"); }

type AddressKind = "loopback" | "lan" | "metadata" | "transparent_proxy" | "public";

function ipv4Kind(address: string): AddressKind {
  const parts = address.split(".").map(Number);
  const [a, b, c] = parts;
  if (a === 127 || a === 0) return "loopback";
  if (a === 169 && b === 254) return "metadata";
  if (a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168) || (a === 100 && b! >= 64 && b! <= 127)) return "lan";
  // RFC 2544 is commonly used by transparent-proxy Fake-IP DNS. It is not routable public space,
  // but an HTTPS hostname may safely retain it as a pinned transport address because TLS still
  // authenticates the original hostname. A literal RFC 2544 endpoint remains forbidden below.
  if (a === 198 && (b === 18 || b === 19)) return "transparent_proxy";
  if (a! >= 224 || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99)
    || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return "metadata";
  return "public";
}

function ipKind(address: string): AddressKind {
  if (net.isIPv4(address)) return ipv4Kind(address);
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "::") return "loopback";
  if (lower.startsWith("::ffff:")) {
    const tail = lower.slice(7);
    if (net.isIPv4(tail)) return ipv4Kind(tail);
    const words = tail.split(":");
    if (words.length === 2 && words.every((word) => /^[0-9a-f]{1,4}$/.test(word))) {
      const high = Number.parseInt(words[0]!, 16);
      const low = Number.parseInt(words[1]!, 16);
      return ipv4Kind(`${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`);
    }
    return "metadata";
  }
  const firstText = lower.split(":", 1)[0] ?? "";
  const first = Number.parseInt(firstText || "0", 16);
  if (!Number.isFinite(first)) return "metadata";
  if ((first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) return "metadata";
  if ((first & 0xfe00) === 0xfc00) return "lan";
  // Fail closed for non-global and special-purpose IPv6 space. Public cloud accepts only 2000::/3.
  if ((first & 0xe000) !== 0x2000 || lower.startsWith("2001:db8:") || lower.startsWith("2001:2:")
    || lower.startsWith("2001:10:") || lower.startsWith("2001:20:")) return "metadata";
  return "public";
}

export async function prepareEgressLease(
  input: EgressPreflightInput,
  lookup: (hostname: string) => Promise<string[]> = async (hostname) => (await dns.lookup(hostname, { all: true, verbatim: true })).map((item) => item.address),
): Promise<PreparedEgressLease> {
  let endpoint: URL;
  try { endpoint = new URL(input.canonicalOrigin); } catch { return fail(); }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) fail();
  const canonicalPath = endpoint.pathname === "/" ? "" : endpoint.pathname.replace(/\/+$/, "");
  if (endpoint.origin + canonicalPath !== input.canonicalOrigin) fail();
  if (canonicalPath !== "" && (canonicalPath.includes("//")
    || canonicalPath.slice(1).split("/").some((segment) => segment === "." || segment === ".."
      || !/^[A-Za-z0-9._~-]+$/.test(segment)))) fail();
  if (!input.allowedEgress.includes(input.canonicalOrigin)) fail();
  if (input.proxyUrl && !input.allowDeclaredProxy) fail();
  if (input.proxyUrl) {
    let proxy: URL;
    try { proxy = new URL(input.proxyUrl); } catch { return fail(); }
    if (!input.allowedEgress.includes(proxy.origin) || proxy.username || proxy.password) fail();
  }
  const hostname = endpoint.hostname.replace(/^\[|\]$/g, "");
  const literalAddress = net.isIP(hostname) !== 0;
  const addresses = literalAddress ? [hostname] : await lookup(hostname);
  if (!addresses.length) fail();
  const kinds = addresses.map(ipKind);
  const transparentProxyDns = !literalAddress && endpoint.protocol === "https:" && kinds.includes("transparent_proxy");
  if (input.networkClass === "public_cloud" && kinds.some((kind) => kind !== "public"
    && !(kind === "transparent_proxy" && transparentProxyDns)
    && !(kind === "lan" && transparentProxyDns))) fail();
  if (input.networkClass === "loopback" && kinds.some((kind) => kind !== "loopback")) fail();
  if (input.networkClass === "lan" && kinds.some((kind) => kind !== "lan")) fail();
  if (kinds.includes("metadata")) fail();
  const normalized = [...new Set(addresses)].sort();
  return { pinnedAddresses: normalized, plan: {
    canonicalOrigin: endpoint.origin,
    proxy: input.proxyUrl ? "declared" : "none",
    networkClass: input.networkClass,
    resolvedAddressDigest: createHash("sha256").update(normalized.join("\0")).digest("hex"),
    redirectPolicy: "reject",
    allEgress: [...input.allowedEgress].sort(),
  } };
}

export async function preflightEgress(
  input: EgressPreflightInput,
  lookup?: (hostname: string) => Promise<string[]>,
): Promise<ResolvedEgressPlan> {
  return (await prepareEgressLease(input, lookup)).plan;
}
