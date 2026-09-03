export interface AgentOnboardingStatus {
  pending: boolean;
  completedAt: number | null;
  homeSpaceId: string | null;
  homeAgentCount: number;
}

export interface OnboardingRuntime {
  id: string;
  label: string;
  installed: boolean;
  builtIn?: boolean;
}

export interface OnboardingPresetProvider {
  backendId: string;
  apiKind: string;
  canonicalOrigin: string;
  models: Array<{ id: string; name: string; thinkingLevels: readonly string[] }>;
}

export interface OnboardingPiImportProvider {
  backendId: string;
  apiKind: string;
  canonicalOrigin: string;
  models: Array<{ id: string; name: string }>;
  credential: { kind: string };
  warnings: string[];
}

export interface OnboardingModelConfiguration {
  id: string;
  displayName: string;
  status: string;
  currentRevision: number;
  modelId: string;
  provider: { id: string; displayName: string; backendId: string };
  compatibility: Record<string, { supported: boolean } | undefined>;
}

export async function createOnboardingAgent(api: Api, input: OnboardingAgentDraft): Promise<any> {
  return api("POST", "/api/agents", {
    name: input.name,
    displayName: input.displayName,
    description: input.description,
    runtime: input.runtime,
    model: null,
    modelBinding: input.modelBinding,
    reasoning: null,
    fastMode: input.fastMode,
  });
}

export interface OnboardingAgentDraft {
  name: string;
  displayName: string;
  description: string;
  runtime: string;
  modelBinding:
    | { mode: "runtime_default" }
    | { mode: "pinned"; modelConfigurationId: string; modelConfigurationRevision: number };
  fastMode: boolean;
}

type Api = (method: string, path: string, body?: unknown) => Promise<any>;

export async function loadAgentOnboardingStatus(api: Api): Promise<AgentOnboardingStatus> {
  return api("GET", "/api/setup/agent-onboarding");
}

export async function completeAgentOnboarding(api: Api): Promise<AgentOnboardingStatus> {
  return api("POST", "/api/setup/agent-onboarding/complete");
}

export async function loadOnboardingRuntimes(api: Api): Promise<OnboardingRuntime[]> {
  const result = await api("GET", "/api/local-runtime/runtimes");
  return (result?.runtimes ?? []) as OnboardingRuntime[];
}

export async function loadOnboardingPresets(api: Api): Promise<OnboardingPresetProvider[]> {
  const result = await api("GET", "/api/settings/pi-presets");
  return (result?.providers ?? []) as OnboardingPresetProvider[];
}

export async function loadOnboardingModelConfigurations(api: Api): Promise<OnboardingModelConfiguration[]> {
  const result = await api("GET", "/api/settings/model-configurations");
  return (result?.items ?? []) as OnboardingModelConfiguration[];
}

/**
 * Create a provider connection + model configuration in one aggregated save
 * (same server transaction as the model settings editor), returning the model
 * configuration id and revision for a runtime default binding.
 */
export async function createOnboardingModel(api: Api, input: {
  displayName: string;
  backendId: string;
  apiKind: string;
  canonicalOrigin: string;
  credentialValue?: string;
  modelId: string;
}): Promise<{ configurationId: string; configurationRevision: number }> {
  let parsed: URL;
  try {
    parsed = new URL(input.canonicalOrigin);
  } catch {
    throw new Error("API 地址无效");
  }
  const origin = parsed.origin + parsed.pathname.replace(/\/$/, "");
  const provider = {
    displayName: input.displayName || input.backendId,
    backendId: input.backendId,
    apiKind: input.apiKind,
    canonicalOrigin: origin,
    networkClass: ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ? "loopback" : "public_cloud",
    credentialSourceKind: input.credentialValue ? "kith_secret" : "keyless_local",
    ...(input.credentialValue ? { credentialValue: input.credentialValue } : {}),
    dataPolicyRevision: "human-confirmed-v1",
    dataPolicyProvenance: "human_asserted",
    allowedEgress: [origin],
    capabilitySnapshot: {},
  };
  const result = await api("POST", "/api/settings/model-provider-bundles", {
    provider,
    models: [{ displayName: input.modelId, modelId: input.modelId }],
  });
  const created = result?.models?.[0];
  if (!created?.configuration?.id || !created?.revision?.revision) {
    throw new Error("模型创建失败：服务端没有返回模型配置");
  }
  return { configurationId: created.configuration.id, configurationRevision: created.revision.revision };
}

export async function bindRuntimeDefaultModel(api: Api, input: {
  runtimeId: string;
  configurationId: string;
  configurationRevision: number;
}): Promise<void> {
  await api("PATCH", `/api/settings/runtimes/${encodeURIComponent(input.runtimeId)}`, {
    enabled: true,
    defaultBinding: {
      mode: "kith_model_configuration",
      modelConfigurationId: input.configurationId,
      modelConfigurationRevision: input.configurationRevision,
    },
  });
}
