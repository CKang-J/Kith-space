/**
 * 读取本机 Claude Code 配置。
 *
 * Claude Code 没有「供应商列表」这种结构，它靠 ~/.claude/settings.json 里的 env 块
 * 描述当前生效的唯一一套接入：ANTHROPIC_BASE_URL 指向服务端，
 * ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS,FABLE}_MODEL 把四个档位分别映射到具体模型 id。
 * 所以这里最多返回一个 LocalProvider，models 是这些档位映射出的模型。
 *
 * 档位变量有两种后缀，含义不同（与 Claude Code 本身的行为一致）：
 *   ANTHROPIC_DEFAULT_SONNET_MODEL       —— 实际请求用的模型 id
 *   ANTHROPIC_DEFAULT_SONNET_MODEL_NAME  —— 界面展示名
 * 只有 _MODEL 有值才算这个档位被配置了。
 */

import type {
  ClaudeTierKey,
  LocalConfigIssue,
  LocalModel,
  LocalProvider,
  LocalRuntimeConfig,
} from "./types.js";
import { asNumber, asRecord, asString, readJsonFile } from "./fileIo.js";
import { claudeSettingsPath } from "./paths.js";

/** 档位定义：环境变量前缀、稳定 key、以及界面上的中文标签。 */
const TIERS = [
  { tier: "haiku", envPrefix: "ANTHROPIC_DEFAULT_HAIKU_MODEL", label: "Haiku（快速）" },
  { tier: "sonnet", envPrefix: "ANTHROPIC_DEFAULT_SONNET_MODEL", label: "Sonnet（均衡）" },
  { tier: "opus", envPrefix: "ANTHROPIC_DEFAULT_OPUS_MODEL", label: "Opus（强力）" },
  { tier: "fable", envPrefix: "ANTHROPIC_DEFAULT_FABLE_MODEL", label: "Fable（最强）" },
] as const;

/** Claude Code 官方端点，settings.json 未指定 base url 时的实际去向。 */
const OFFICIAL_ORIGIN = "https://api.anthropic.com";

/** 凭据可能来自这几个 env key，按优先级排列。 */
const CREDENTIAL_KEYS = ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"] as const;

/**
 * 从 base url 猜一个可读的供应商名。
 * 官方端点直接叫 Anthropic 官方；第三方中转就用主机名，让用户能认出自己配的是哪家。
 */
function deriveDisplayName(baseUrl: string | undefined): string {
  if (!baseUrl) return "Anthropic 官方";
  try {
    const url = new URL(baseUrl);
    if (url.hostname.endsWith("anthropic.com")) return "Anthropic 官方";
    // 本机代理（cc-switch、claude-code-router 之类）只显示 IP 会看不懂，标注出来。
    if (["127.0.0.1", "localhost", "0.0.0.0", "::1"].includes(url.hostname)) {
      return `本机代理（${url.host}）`;
    }
    return url.hostname;
  } catch {
    return baseUrl;
  }
}

/**
 * 把 env 块里的四个档位映射拼成模型列表。
 *
 * 同一个模型 id 可能被多个档位复用（第三方中转常把四档都指向同一模型），
 * 这时合并成一条，档位标签用「/」连接，避免界面出现四个一模一样的选项。
 * displayName 只放模型本身的名字，档位另放 tierLabel，交给前端决定怎么排版。
 */
function collectTierModels(env: Record<string, unknown>): LocalModel[] {
  const ordered: string[] = [];
  const nameById = new Map<string, string>();
  const tierById = new Map<string, string>();
  const labelsById = new Map<string, string[]>();

  for (const { tier, envPrefix, label } of TIERS) {
    const modelId = asString(env[envPrefix]);
    if (!modelId) continue;

    const labels = labelsById.get(modelId);
    if (labels) {
      labels.push(label);
      continue;
    }
    ordered.push(modelId);
    labelsById.set(modelId, [label]);
    tierById.set(modelId, tier);
    nameById.set(modelId, asString(env[`${envPrefix}_NAME`]) ?? modelId);
  }

  return ordered.map((id) => ({
    id,
    displayName: nameById.get(id) ?? id,
    ...(tierById.get(id) === undefined ? {} : { tier: tierById.get(id) }),
    tierLabel: (labelsById.get(id) ?? []).join(" / "),
  }));
}

/**
 * 按 env 的原始形状收集每个档位的模型 id 与展示名。
 *
 * 与 collectTierModels 的合并结果不同，这里不去重：编辑表单需要知道「Sonnet 档填的是什么、
 * Opus 档填的是什么」，合并后的列表还原不出来。
 */
function collectRawTiers(
  env: Record<string, unknown>,
): Partial<Record<ClaudeTierKey, { modelId: string; displayName?: string }>> {
  const raw: Partial<Record<ClaudeTierKey, { modelId: string; displayName?: string }>> = {};
  for (const { tier, envPrefix } of TIERS) {
    const modelId = asString(env[envPrefix]);
    if (!modelId) continue;
    const displayName = asString(env[`${envPrefix}_NAME`]);
    raw[tier] = { modelId, ...(displayName === undefined ? {} : { displayName }) };
  }
  return raw;
}

/** 凭据探测：settings.json 的 env 块优先，其次进程环境变量。只判断有无，不取值。 */
function detectCredential(env: Record<string, unknown>): LocalProvider["credential"] {
  for (const key of CREDENTIAL_KEYS) {
    if (asString(env[key])) return { configured: true, source: `settings.json 的 ${key}` };
  }
  for (const key of CREDENTIAL_KEYS) {
    if (asString(process.env[key])) return { configured: true, source: `环境变量 ${key}` };
  }
  return { configured: false };
}

export async function readClaudeLocalConfig(): Promise<LocalRuntimeConfig> {
  const primaryPath = claudeSettingsPath();
  const issues: LocalConfigIssue[] = [];

  const read = await readJsonFile(primaryPath);
  if (!read.ok) {
    return { runtimeId: "claude", primaryPath, present: false, providers: [], issues: [read.issue] };
  }

  const settings = asRecord(read.value);
  const env = asRecord(settings.env);
  const baseUrl = asString(env.ANTHROPIC_BASE_URL);
  const models = collectTierModels(env);

  // settings.json 的顶层 model 是「当前选用的档位或模型」，例如 "fable" 或完整模型 id。
  const selected = asString(settings.model);
  const defaultModelId = selected
    ? (models.find((model) => model.tier === selected)?.id ?? selected)
    : undefined;

  // 非 claude- 前缀的模型需要显式声明上下文上限，Claude Code 才会按该值裁剪。
  const maxContext = asNumber(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS);
  const maxOutput = asNumber(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS);
  const enriched: LocalModel[] = models.map((model) => ({
    ...model,
    ...(maxContext === undefined ? {} : { contextWindow: maxContext }),
    ...(maxOutput === undefined ? {} : { maxOutputTokens: maxOutput }),
  }));

  // env 块存在但没有任何档位映射，说明用户在用官方默认模型：这不是错误，
  // 但要让界面知道「读到了配置，只是没有可选模型」。
  if (enriched.length === 0) {
    issues.push({
      kind: "notice",
      path: primaryPath,
      message:
        "settings.json 中未配置 ANTHROPIC_DEFAULT_*_MODEL，Claude Code 正在使用官方默认模型，没有可供选择的自定义模型。",
    });
  }

  const provider: LocalProvider = {
    id: "claude-local",
    runtimeId: "claude",
    displayName: deriveDisplayName(baseUrl),
    apiFormat: "anthropic-messages",
    baseUrl: baseUrl ?? OFFICIAL_ORIGIN,
    credential: detectCredential(env),
    models: enriched,
    ...(defaultModelId === undefined ? {} : { defaultModelId }),
    sourcePaths: [primaryPath],
    claude: {
      tiers: collectRawTiers(env),
      ...(maxContext === undefined ? {} : { maxContextTokens: maxContext }),
      ...(maxOutput === undefined ? {} : { maxOutputTokens: maxOutput }),
      ...(selected === undefined ? {} : { selectedModel: selected }),
    },
  };

  return { runtimeId: "claude", primaryPath, present: true, providers: [provider], issues };
}
