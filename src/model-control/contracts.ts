import type {
  AdvisorApiKind,
  AdvisorCredentialSourceKind,
  AdvisorNetworkClass,
} from "../advisor-provider/contracts.js";
import type { RuntimeId } from "../local-runtime/runtimeCatalog.js";

export type ModelControlErrorCode =
  | "invalid_runtime_default_binding"
  | "model_provider_not_found"
  | "model_configuration_not_found"
  | "model_configuration_in_use"
  | "model_configuration_incompatible"
  | "runtime_profile_not_found"
  | "runtime_configuration_stale"
  | "desktop_trust_required"
  | "import_conflict";

export class ModelControlError extends Error {
  constructor(public readonly code: ModelControlErrorCode, message: string = code) {
    super(message);
    this.name = "ModelControlError";
  }
}

export type StableConfigurationStatus = "active" | "disabled";
export type ConfigurationSourceKind =
  | "manual"
  | "pi_import"
  | "claude_import"
  | "codex_import"
  | "opencode_import"
  | "legacy_advisor";

export interface ModelProviderConnection {
  id: string;
  displayName: string;
  status: StableConfigurationStatus;
  currentRevision: number;
  createdAt: number;
  updatedAt: number;
}

export interface ModelProviderConnectionRevision {
  connectionId: string;
  revision: number;
  backendId: string;
  apiKind: AdvisorApiKind;
  canonicalOrigin: string;
  networkClass: AdvisorNetworkClass;
  credentialSourceKind: AdvisorCredentialSourceKind;
  credentialRef: string | null;
  credentialIdentityDigest: string;
  dataPolicyRevision: string;
  dataPolicyProvenance: "vendor_verified" | "human_asserted" | "unknown";
  allowedEgress: readonly string[];
  capabilitySnapshot: Readonly<Record<string, unknown>>;
  sourceKind: ConfigurationSourceKind;
  sourceSnapshotDigest: string;
  createdAt: number;
}

export interface RuntimeCompatibility {
  supported: boolean;
  reason?: string;
}

export interface ModelConfiguration {
  id: string;
  displayName: string;
  status: StableConfigurationStatus;
  currentRevision: number;
  createdAt: number;
  updatedAt: number;
}

export interface ModelConfigurationRevision {
  configurationId: string;
  revision: number;
  providerConnectionId: string;
  providerRevision: number;
  modelId: string;
  reasoning: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  inputCapabilities: readonly string[];
  runtimeCompatibilitySnapshot: Partial<Record<RuntimeId | "pi_sdk", RuntimeCompatibility>>;
  options: Readonly<Record<string, unknown>>;
  createdAt: number;
}

export type RuntimeDefaultBindingMode =
  | "kith_model_configuration"
  | "unmanaged_cli_native"
  | "unset";

export interface RuntimeDefaultBinding {
  mode: RuntimeDefaultBindingMode;
  modelConfigurationId: string | null;
  modelConfigurationRevision: number | null;
}

export function assertRuntimeDefaultBinding(input: RuntimeDefaultBinding): RuntimeDefaultBinding {
  const hasConfiguration = typeof input.modelConfigurationId === "string"
    && input.modelConfigurationId.length > 0
    && Number.isSafeInteger(input.modelConfigurationRevision)
    && (input.modelConfigurationRevision ?? 0) > 0;
  const valid = input.mode === "kith_model_configuration"
    ? hasConfiguration
    : input.modelConfigurationId === null && input.modelConfigurationRevision === null;
  if (!valid) throw new ModelControlError("invalid_runtime_default_binding");
  return { ...input };
}

export type CliImportItemStatus =
  | "create"
  | "new_revision"
  | "unchanged"
  | "conflict"
  | "skipped";

export interface CliImportItemResult {
  sourceId: string;
  targetKind: "provider_connection" | "model_configuration" | "runtime_profile";
  targetId: string | null;
  status: CliImportItemStatus;
  warnings: readonly string[];
}
