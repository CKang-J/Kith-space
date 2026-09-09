/**
 * 把「本机运行器配置里的某个模型」转成一个真实可用的 Kith 模型配置。
 *
 * 为什么需要这一层：向导里选中本机模型后，Agent 绑定需要一个真实存在的
 * modelConfigurationId（AgentModelBindingService.resolve 会去数据库查它）。
 * 之前前端自己拼 `${providerId}:${modelId}` 当 id，保存时必然抛
 * model_configuration_not_found，所以本机 Tab 是整条链路都不通，不只是列表为空。
 *
 * 安全边界：凭据明文只在本进程内从 localCredentialResolver 取出、直接交给
 * providerCredentialPort 落库，绝不出现在返回值、日志或错误信息里。
 */

import { createHash } from "node:crypto";
import { providerCredentialPort } from "../../advisor-provider/credentialPort.js";
import { canonicalAdvisorOrigin } from "../../advisor-provider/advisorModelCompiler.js";
import type { AdvisorApiKind, AdvisorNetworkClass } from "../../advisor-provider/contracts.js";
import { ModelControlError } from "../contracts.js";
import { ModelConfigurationService } from "../modelConfigurationService.js";
import { ModelProviderConnectionService } from "../modelProviderConnectionService.js";
import { withRuntimeConfigurationChange } from "../runtimeConfigurationChange.js";
import { markAgentsForRuntimeConfigurationChange } from "../runtimeConfigurationImpact.js";
import type { RuntimeId } from "../runtimeTypes.js";
import { readLocalRuntimeConfig } from "./index.js";
import { resolveLocalCredential } from "./localCredentialResolver.js";
import type { LocalModel, LocalProvider } from "./types.js";

/** 本机 apiFormat → Kith apiKind。openai-chat 在 Kith 侧就是 openai-completions。 */
const API_KIND_BY_FORMAT: Readonly<Record<string, AdvisorApiKind>> = Object.freeze({
  "anthropic-messages": "anthropic-messages",
  "openai-responses": "openai-responses",
  "openai-completions": "openai-completions",
  "openai-chat": "openai-completions",
  "google-generative-ai": "google-generative-ai",
  "bedrock-converse-stream": "bedrock-converse-stream",
});

/** 各运行器读不出 apiFormat 时的兜底，按该运行器实际使用的协议给。 */
const FALLBACK_API_KIND: Readonly<Record<RuntimeId, AdvisorApiKind>> = Object.freeze({
  claude: "anthropic-messages",
  codex: "openai-responses",
  pi: "openai-completions",
  opencode: "openai-completions",
});

const SOURCE_KIND: Readonly<Record<RuntimeId, "claude_import" | "codex_import" | "pi_import" | "opencode_import">> =
  Object.freeze({
    claude: "claude_import",
    codex: "codex_import",
    pi: "pi_import",
    opencode: "opencode_import",
  });

/** 没有 baseUrl 时各运行器的官方端点，否则无法构造 canonicalOrigin。 */
const DEFAULT_ORIGIN: Readonly<Record<RuntimeId, string>> = Object.freeze({
  claude: "https://api.anthropic.com",
  codex: "https://api.openai.com/v1",
  pi: "https://api.openai.com/v1",
  opencode: "https://api.openai.com/v1",
});

export interface AdoptLocalModelInput {
  runtimeId: RuntimeId;
  /** LocalProvider.id */
  providerId: string;
  /** LocalModel.id */
  modelId: string;
}

export interface AdoptLocalModelResult {
  configurationId: string;
  configurationRevision: number;
  providerConnectionId: string;
  displayName: string;
  /** 已存在同源配置时为 true，此时不新建而是复用。 */
  reused: boolean;
  /** 凭据未能自动带入时的说明，前端据此提示用户去补 API Key。 */
  credentialNotice?: string;
}

function networkClassOf(origin: string): AdvisorNetworkClass {
  return /^https?:\/\/(?:127\.|localhost|\[::1\]|::1)/.test(origin) ? "loopback" : "public_cloud";
}

function resolveApiKind(provider: LocalProvider, runtimeId: RuntimeId): AdvisorApiKind {
  const mapped = provider.apiFormat === undefined ? undefined : API_KIND_BY_FORMAT[provider.apiFormat];
  return mapped ?? FALLBACK_API_KIND[runtimeId];
}

/**
 * 同一个「运行器 + 供应商 + 端点」只建一个 provider connection，靠 sourceSnapshotDigest
 * 认领。用 backendId 认领不行：Claude 的 claude-local、Pi 的 zai 这些 id 在不同端点下
 * 可以重复，而端点变了就是另一个执行身份。
 */
function providerIdentityDigest(runtimeId: RuntimeId, providerId: string, canonicalOrigin: string): string {
  return createHash("sha256").update([runtimeId, providerId, canonicalOrigin].join("\0")).digest("hex");
}

export class LocalConfigAdoptService {
  constructor(
    private readonly providers = new ModelProviderConnectionService(),
    private readonly configurations = new ModelConfigurationService(providers),
  ) {}

  async adopt(input: AdoptLocalModelInput): Promise<AdoptLocalModelResult> {
    const config = await readLocalRuntimeConfig(input.runtimeId);
    const provider = config.providers.find((item) => item.id === input.providerId);
    if (!provider) {
      throw new ModelControlError(
        "model_provider_not_found",
        `本机 ${input.runtimeId} 配置中没有供应商 ${input.providerId}`,
      );
    }
    const model = provider.models.find((item) => item.id === input.modelId);
    if (!model) {
      throw new ModelControlError(
        "model_configuration_not_found",
        `供应商 ${input.providerId} 的本机配置中没有模型 ${input.modelId}`,
      );
    }

    const apiKind = resolveApiKind(provider, input.runtimeId);
    const rawOrigin = provider.baseUrl ?? DEFAULT_ORIGIN[input.runtimeId];
    const networkClass = networkClassOf(rawOrigin);
    let canonicalOrigin: string;
    try {
      canonicalOrigin = canonicalAdvisorOrigin(rawOrigin, networkClass);
    } catch {
      throw new ModelControlError(
        "model_provider_not_found",
        `本机配置中的地址 ${rawOrigin} 不是合法的 API 端点，无法导入`,
      );
    }
    const sourceSnapshotDigest =
      `${SOURCE_KIND[input.runtimeId]}:${providerIdentityDigest(input.runtimeId, provider.id, canonicalOrigin)}`;

    const existingConfiguration = this.findExistingConfiguration(sourceSnapshotDigest, model.id);
    if (existingConfiguration) {
      return {
        configurationId: existingConfiguration.configuration.id,
        configurationRevision: existingConfiguration.configuration.currentRevision,
        providerConnectionId: existingConfiguration.revision.providerConnectionId,
        displayName: existingConfiguration.configuration.displayName,
        reused: true,
      };
    }

    const credential = await resolveLocalCredential(input.runtimeId, provider.id);
    const existingProvider = this.findExistingProvider(sourceSnapshotDigest);

    const result = await withRuntimeConfigurationChange(() => {
      const connectionId = existingProvider?.connection.id ?? this.createProvider({
        provider,
        runtimeId: input.runtimeId,
        apiKind,
        canonicalOrigin,
        networkClass,
        sourceSnapshotDigest,
        credential,
      });
      const created = this.configurations.createWithinConfigurationChange({
        displayName: modelDisplayName(provider, model),
        providerConnectionId: connectionId,
        modelId: model.id,
        ...(model.reasoning === undefined ? {} : { reasoning: model.reasoning ? "medium" : null }),
        ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
        ...(model.maxOutputTokens === undefined ? {} : { maxOutputTokens: model.maxOutputTokens }),
        ...(model.inputCapabilities === undefined ? {} : { inputCapabilities: model.inputCapabilities }),
      });
      return created;
    });
    markAgentsForRuntimeConfigurationChange({ runtimeIds: [input.runtimeId] });

    return {
      configurationId: result.configuration.id,
      configurationRevision: result.configuration.currentRevision,
      providerConnectionId: result.revision.providerConnectionId,
      displayName: result.configuration.displayName,
      reused: false,
      ...(credential.kind === "keyless"
        ? { credentialNotice: credential.reason }
        : {}),
    };
  }

  /** 已经从同一份本机配置导入过同一个模型时直接复用，避免每次进向导都堆一条新配置。 */
  private findExistingConfiguration(sourceSnapshotDigest: string, modelId: string) {
    const provider = this.findExistingProvider(sourceSnapshotDigest);
    if (!provider) return undefined;
    return this.configurations.list().find((item) =>
      item.configuration.status === "active"
      && item.revision.providerConnectionId === provider.connection.id
      && item.revision.modelId === modelId);
  }

  private findExistingProvider(sourceSnapshotDigest: string) {
    return this.providers.list().find((item) =>
      item.connection.status === "active"
      && item.revision.sourceSnapshotDigest === sourceSnapshotDigest);
  }

  private createProvider(args: {
    provider: LocalProvider;
    runtimeId: RuntimeId;
    apiKind: AdvisorApiKind;
    canonicalOrigin: string;
    networkClass: AdvisorNetworkClass;
    sourceSnapshotDigest: string;
    credential: Awaited<ReturnType<typeof resolveLocalCredential>>;
  }): string {
    const base = {
      displayName: args.provider.displayName,
      backendId: args.provider.id,
      apiKind: args.apiKind,
      canonicalOrigin: args.canonicalOrigin,
      networkClass: args.networkClass,
      dataPolicyRevision: "human-confirmed-v1",
      dataPolicyProvenance: "human_asserted" as const,
      allowedEgress: [args.canonicalOrigin],
      capabilitySnapshot: {},
      sourceKind: SOURCE_KIND[args.runtimeId],
      sourceSnapshotDigest: args.sourceSnapshotDigest,
    };
    if (args.credential.kind === "secret") {
      // 明文只在这一行内存活：storeKithSecret 立刻加密落库，之后只带 ref。
      const stored = providerCredentialPort.storeKithSecret(args.provider.id, args.credential.value);
      return this.providers.createWithinConfigurationChange({
        ...base,
        credentialSourceKind: "kith_secret",
        credentialRef: stored.credentialRef,
        credentialIdentityDigest: stored.credentialIdentityDigest,
      }).connection.id;
    }
    return this.providers.createWithinConfigurationChange({
      ...base,
      credentialSourceKind: "keyless_local",
    }).connection.id;
  }
}

function modelDisplayName(provider: LocalProvider, model: LocalModel): string {
  const name = model.displayName ?? model.id;
  return `${name}（${provider.displayName}）`.slice(0, 200);
}

export const localConfigAdoptService = new LocalConfigAdoptService();
