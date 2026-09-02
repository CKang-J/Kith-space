import net from "node:net";
import {
  ADVISOR_API_KINDS,
  AdvisorProviderError,
  type AdvisorApiKind,
  type AdvisorModelProfile,
  type CompiledAdvisorModelConfig,
} from "./contracts.js";

const FACTORIES: Readonly<Record<string, ReadonlyArray<AdvisorApiKind>>> = Object.freeze({
  anthropic: ["anthropic-messages"],
  openai: ["openai-responses"],
  openrouter: ["openai-completions"],
  deepseek: ["openai-completions"],
  google: ["google-generative-ai"],
  "google-vertex": ["google-vertex"],
  mistral: ["mistral-conversations"],
  "azure-openai-responses": ["azure-openai-responses"],
  "amazon-bedrock": ["bedrock-converse-stream"],
});

function incompatible(detail: string): never {
  throw new AdvisorProviderError("provider_model_incompatible", `provider_model_incompatible: ${detail}`);
}

export function canonicalAdvisorOrigin(value: string, networkClass: AdvisorModelProfile["networkClass"]): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { return incompatible("endpoint is not an absolute URL"); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) incompatible("endpoint contains credentials, query, or fragment");
  // OpenAI-compatible endpoints often live under a base path (e.g. /v1). Only
  // bounded, simple path segments are accepted; the path stays part of the
  // allowlisted endpoint so the helper's pinned egress guard covers the full
  // base URL, not just the origin.
  const pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname !== "") {
    if (pathname.includes("//")) incompatible("unsafe endpoint path");
    const segments = pathname.slice(1).split("/");
    if (segments.length > 8 || segments.some((segment) => segment === "." || segment === ".."
      || !/^[A-Za-z0-9._~-]+$/.test(segment))) incompatible("unsafe endpoint path");
    if (pathname.length > 200) incompatible("endpoint path is too long");
  }
  const isLoopbackName = parsed.hostname === "localhost" || parsed.hostname.endsWith(".localhost");
  const ip = net.isIP(parsed.hostname.replace(/^\[|\]$/g, ""));
  const isLoopbackIp = ip === 4
    ? parsed.hostname.startsWith("127.")
    : ip === 6 && ["::1", "0:0:0:0:0:0:0:1"].includes(parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase());
  const loopback = isLoopbackName || isLoopbackIp;
  if (networkClass === "loopback" && !loopback) incompatible("loopback profile has a non-loopback endpoint");
  if (networkClass !== "loopback" && loopback) incompatible("endpoint network class does not match loopback address");
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && networkClass === "loopback")) {
    incompatible("external endpoints require HTTPS");
  }
  return parsed.origin + pathname;
}

export function compileAdvisorModel(profile: AdvisorModelProfile): CompiledAdvisorModelConfig {
  if (!(ADVISOR_API_KINDS as readonly string[]).includes(profile.apiKind)) incompatible("unknown API kind");
  const supportedApis = FACTORIES[profile.backendId];
  if (!supportedApis?.includes(profile.apiKind)) incompatible("provider factory/API combination is not allowlisted");
  if (!profile.modelId.trim() || profile.modelId.length > 256) incompatible("invalid model id");
  if (!Number.isSafeInteger(profile.providerSchemaVersion) || profile.providerSchemaVersion !== 1) incompatible("unsupported provider schema");
  if (profile.dataPolicyProvenance === "unknown" && profile.networkClass !== "loopback") incompatible("external destination has unknown data policy");
  const supportedThinking = Array.isArray(profile.modelMetadata.supportedThinking)
    ? profile.modelMetadata.supportedThinking.filter((item): item is string => typeof item === "string")
    : ["off"];
  if (!supportedThinking.includes(profile.thinkingLevel)) incompatible("thinking level is not supported by this descriptor");
  const canonicalOrigin = canonicalAdvisorOrigin(profile.canonicalOrigin, profile.networkClass);
  const allowedEgress = [...new Set(profile.allowedEgress.map((origin) => canonicalAdvisorOrigin(origin, profile.networkClass)))].sort();
  if (!allowedEgress.includes(canonicalOrigin)) incompatible("canonical endpoint is absent from allowed egress");
  return Object.freeze({
    providerFactoryId: profile.backendId,
    backendId: profile.backendId,
    modelId: profile.modelId,
    apiKind: profile.apiKind,
    thinkingLevel: profile.thinkingLevel,
    canonicalOrigin,
    networkClass: profile.networkClass,
    allowedEgress,
    credentialSlot: profile.credentialSourceKind,
    providerSchemaVersion: profile.providerSchemaVersion,
    options: Object.freeze({ maxRetries: 0, timeoutMs: 75_000, transport: "sse" }),
  });
}
