import type { AdvisorModelProfile, AdvisorProviderDescriptor } from "./contracts.js";

export type AdvisorAuthenticationCapability = { supported: true; delivery: "explicit_value" }
  | { supported: false; reason: "ambient_only" | "provider_mismatch" | "keyless_unsupported" };

export function advisorAuthenticationCapability(
  adapterId: AdvisorProviderDescriptor["adapterId"],
  profile: Pick<AdvisorModelProfile, "backendId" | "apiKind" | "credentialSourceKind"> & { canonicalOrigin?: string },
): AdvisorAuthenticationCapability {
  if (profile.credentialSourceKind === "keyless_local") return { supported: false, reason: "keyless_unsupported" };
  if (adapterId === "claude_cli") return profile.backendId === "anthropic" && profile.apiKind === "anthropic-messages"
    && profile.canonicalOrigin === "https://api.anthropic.com"
    ? { supported: true, delivery: "explicit_value" }
    : { supported: false, reason: "provider_mismatch" };
  if (["amazon-bedrock", "google-vertex"].includes(profile.backendId)) return { supported: false, reason: "ambient_only" };
  return { supported: true, delivery: "explicit_value" };
}
