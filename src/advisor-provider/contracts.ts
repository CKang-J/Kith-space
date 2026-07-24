import type { NormalizedUsage } from "../runtime/contract/v2/runtimeContract.js";

export const ADVISOR_API_KINDS = [
  "anthropic-messages",
  "azure-openai-responses",
  "bedrock-converse-stream",
  "google-vertex",
  "openai-responses",
  "openai-completions",
  "openai-codex-responses",
  "google-generative-ai",
  "mistral-conversations",
  "pi-messages",
] as const;

export type AdvisorApiKind = typeof ADVISOR_API_KINDS[number];
export type AdvisorThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type AdvisorNetworkClass = "loopback" | "lan" | "public_cloud" | "custom";
export type AdvisorCredentialSourceKind = "pi_cli_auth" | "kith_secret" | "env_ref" | "keyless_local";

export interface AdvisorModelProfile {
  sourceKind: "bundled_catalog" | "pi_cli_import" | "manual";
  sourceSnapshotDigest: string;
  descriptorTrust: "bundled_verified" | "pi_cli_imported" | "manual";
  backendId: string;
  modelId: string;
  apiKind: AdvisorApiKind;
  thinkingLevel: AdvisorThinkingLevel;
  canonicalOrigin: string;
  region?: string;
  tenantOrProjectDigest?: string;
  credentialSourceKind: AdvisorCredentialSourceKind;
  credentialIdentityDigest: string;
  providerSchemaVersion: number;
  dataPolicyRevision: string;
  dataPolicyProvenance: "vendor_verified" | "human_asserted" | "unknown";
  networkClass: AdvisorNetworkClass;
  allowedEgress: string[];
  modelMetadata: Record<string, unknown>;
}

export interface CompiledAdvisorModelConfig {
  providerFactoryId: string;
  backendId: string;
  modelId: string;
  apiKind: AdvisorApiKind;
  thinkingLevel: AdvisorThinkingLevel;
  canonicalOrigin: string;
  networkClass: AdvisorNetworkClass;
  allowedEgress: string[];
  credentialSlot: AdvisorCredentialSourceKind;
  providerSchemaVersion: number;
  options: Readonly<Record<string, unknown>>;
}

export interface AdvisorProviderCapabilities {
  structuredOutput: "json_schema" | "validated_json" | "none";
  toolIsolation: "enforced" | "unsupported";
  mcpIsolation: "enforced" | "unsupported";
  sessionPersistence: "disabled" | "unsupported";
  ephemeralCwd: "enforced" | "unsupported";
  projectCustomization: "disabled" | "unsupported";
  environmentIsolation: "allowlist" | "unsupported";
  cancellation: "supported" | "unsupported";
  usage: "exact" | "estimated" | "unavailable";
}

export interface AdvisorProviderDescriptor {
  adapterId: "pi_sdk" | "claude_cli";
  adapterVersion: string;
  label: string;
  bundled: boolean;
  capabilities: AdvisorProviderCapabilities;
}

export interface ProviderExecutionSnapshot {
  installationIdDigest: string;
  providerRevision: number;
  modelProfileRevision: number;
  providerEpoch: number;
  adapterId: AdvisorProviderDescriptor["adapterId"];
  adapterVersion: string;
  executableOrPackageDigest: string;
  sdkLockDigest?: string;
  executionSnapshotDigest: string;
  backendId: string;
  modelId: string;
  modelSource: AdvisorModelProfile["sourceKind"];
  modelSourceDigest: string;
  descriptorTrust: AdvisorModelProfile["descriptorTrust"];
  apiKind: AdvisorApiKind;
  thinkingLevel: AdvisorThinkingLevel;
  canonicalOrigin: string;
  region?: string;
  tenantOrProjectDigest?: string;
  credentialIdentityDigest: string;
  dataPolicyRevision: string;
  dataPolicyProvenance: AdvisorModelProfile["dataPolicyProvenance"];
  networkClass: AdvisorNetworkClass;
  providerSchemaVersion: number;
  allowedEgress: string[];
  sanitizedConfig: Record<string, unknown>;
  configDigest: string;
  capabilityDigest: string;
}

export interface ResolvedEgressPlan {
  canonicalOrigin: string;
  proxy: "none" | "declared";
  networkClass: AdvisorNetworkClass;
  resolvedAddressDigest: string;
  redirectPolicy: "reject" | "same_origin_only";
  allEgress: string[];
}

export interface AdvisorCompletionResult {
  rawJson: unknown;
  usage?: NormalizedUsage;
  postflight: ResolvedEgressPlan;
}

export type AdvisorProviderErrorCode =
  | "provider_unconfigured"
  | "provider_unavailable"
  | "provider_capability_failed"
  | "provider_auth_required"
  | "provider_model_setup_required"
  | "provider_model_incompatible"
  | "provider_model_config_changed"
  | "provider_credential_command_unsupported"
  | "provider_consent_required"
  | "provider_revision_changed"
  | "provider_timeout"
  | "provider_cancelled"
  | "provider_invalid_output"
  | "provider_preflight_destination_mismatch"
  | "provider_postflight_destination_mismatch";

export class AdvisorProviderError extends Error {
  constructor(public readonly code: AdvisorProviderErrorCode, message: string = code) {
    super(message);
    this.name = "AdvisorProviderError";
  }
}
