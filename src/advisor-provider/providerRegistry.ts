import { AdvisorProviderError, type AdvisorProviderCapabilities, type AdvisorProviderDescriptor } from "./contracts.js";

export const ADVISOR_PROVIDER_CAPABILITIES: AdvisorProviderCapabilities = Object.freeze({
  structuredOutput: "validated_json",
  toolIsolation: "enforced",
  mcpIsolation: "enforced",
  sessionPersistence: "disabled",
  ephemeralCwd: "enforced",
  projectCustomization: "disabled",
  environmentIsolation: "allowlist",
  cancellation: "supported",
  usage: "exact",
});
export const PI_AI_PACKAGE_INTEGRITY = "sha512-hzHE7Z8l5mgJk+ke67Lge0rwS2+wbKJrFKl9o5M1R1rh33+cCT7D1AHz1OAtX5wFs90E1/BTGhyJRTUHaMxGvQ==";

const PI_PROVIDER: AdvisorProviderDescriptor = Object.freeze({
    adapterId: "pi_sdk",
    adapterVersion: "0.81.1",
    label: "Built-in Pi SDK",
    bundled: true,
    capabilities: ADVISOR_PROVIDER_CAPABILITIES,
});
const CLAUDE_PROVIDER: AdvisorProviderDescriptor = Object.freeze({
    adapterId: "claude_cli",
    adapterVersion: "system",
    label: "Claude Code",
    bundled: false,
    capabilities: ADVISOR_PROVIDER_CAPABILITIES,
});
const PROVIDERS: ReadonlyMap<AdvisorProviderDescriptor["adapterId"], AdvisorProviderDescriptor> = new Map([
  ["pi_sdk", PI_PROVIDER],
  ["claude_cli", CLAUDE_PROVIDER],
]);

export function advisorProviderDescriptor(adapterId: string): AdvisorProviderDescriptor {
  const descriptor = PROVIDERS.get(adapterId as AdvisorProviderDescriptor["adapterId"]);
  if (!descriptor) throw new AdvisorProviderError("provider_unavailable");
  return descriptor;
}

export function listAdvisorProviderDescriptors(): readonly AdvisorProviderDescriptor[] {
  return [...PROVIDERS.values()];
}
