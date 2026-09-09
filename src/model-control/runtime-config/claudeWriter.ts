/**
 * 写入本机 Claude Code 配置。
 *
 * 关键约束：settings.json 里还有 permissions、enabledPlugins、hooks 等与模型无关的用户数据。
 * 这里只增删改 env 块里 Kith 负责的那几个 key，其余字段和 env 里的其他变量必须原样保留。
 * 之前的实现用 { providers: [] } 整体覆盖该文件，会清空用户全部配置。
 */

import type { LocalConfigIssue } from "./types.js";
import { asRecord, readJsonFile, writeFileAtomic } from "./fileIo.js";
import { claudeSettingsPath } from "./paths.js";

/** Kith 允许改写的 env key 前缀，其余 env 变量一律不动。 */
const TIER_ENV_KEYS = [
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_FABLE_MODEL",
] as const;

export type ClaudeTier = "haiku" | "sonnet" | "opus" | "fable";

const TIER_TO_ENV: Record<ClaudeTier, string> = {
  haiku: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  sonnet: "ANTHROPIC_DEFAULT_SONNET_MODEL",
  opus: "ANTHROPIC_DEFAULT_OPUS_MODEL",
  fable: "ANTHROPIC_DEFAULT_FABLE_MODEL",
};

export interface ClaudeTierInput {
  /** 实际请求用的模型 id；空字符串表示清除该档位映射。 */
  modelId?: string;
  /** 界面展示名，写入 <KEY>_NAME。 */
  displayName?: string;
}

export interface ClaudeConfigPatch {
  /** 服务端地址，传 null 表示删除该项（回到官方端点）。 */
  baseUrl?: string | null;
  /** 认证令牌，传 null 表示删除。不传则完全不碰凭据。 */
  authToken?: string | null;
  /** 四个档位的模型映射，只处理传入的档位。 */
  tiers?: Partial<Record<ClaudeTier, ClaudeTierInput>>;
  /** 上下文上限，传 null 删除。非 claude- 前缀模型需要它才能吃到大上下文。 */
  maxContextTokens?: number | null;
  /** 输出上限，传 null 删除。 */
  maxOutputTokens?: number | null;
  /** 顶层 model 字段（档位名或完整模型 id），传 null 删除。 */
  selectedModel?: string | null;
}

export interface WriteResult {
  path: string;
  /** 本次实际改动的 env key，便于界面回显与排错。 */
  changedKeys: string[];
}

/** 按 patch 的语义更新一个 env 字典：undefined 不动、null 删除、字符串写入。 */
function applyEnvValue(
  env: Record<string, unknown>,
  key: string,
  value: string | null | undefined,
  changed: string[],
): void {
  if (value === undefined) return;
  if (value === null || value === "") {
    if (key in env) {
      delete env[key];
      changed.push(key);
    }
    return;
  }
  if (env[key] !== value) {
    env[key] = value;
    changed.push(key);
  }
}

/**
 * 把改动合并进 settings.json。
 *
 * 读不到原文件时按空对象起步（用户尚未初始化 Claude Code 也应能写入）；
 * 但原文件存在却解析失败时必须中止，否则会把用户损坏但可修复的配置彻底覆盖掉。
 */
export async function patchClaudeConfig(patch: ClaudeConfigPatch): Promise<WriteResult> {
  const target = claudeSettingsPath();
  const read = await readJsonFile(target);

  if (!read.ok && read.issue.kind !== "not_found") {
    throw new Error(`${read.issue.message} 为避免覆盖用户数据，已中止写入。`);
  }

  const settings: Record<string, unknown> = read.ok ? { ...asRecord(read.value) } : {};
  const env: Record<string, unknown> = { ...asRecord(settings.env) };
  const changedKeys: string[] = [];

  applyEnvValue(env, "ANTHROPIC_BASE_URL", patch.baseUrl, changedKeys);
  applyEnvValue(env, "ANTHROPIC_AUTH_TOKEN", patch.authToken, changedKeys);

  for (const [tier, input] of Object.entries(patch.tiers ?? {})) {
    const key = TIER_TO_ENV[tier as ClaudeTier];
    if (!key || !input) continue;
    applyEnvValue(env, key, input.modelId ?? null, changedKeys);
    applyEnvValue(env, `${key}_NAME`, input.displayName ?? null, changedKeys);
  }

  applyEnvValue(
    env,
    "CLAUDE_CODE_MAX_CONTEXT_TOKENS",
    patch.maxContextTokens === undefined
      ? undefined
      : patch.maxContextTokens === null
        ? null
        : String(patch.maxContextTokens),
    changedKeys,
  );
  applyEnvValue(
    env,
    "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
    patch.maxOutputTokens === undefined
      ? undefined
      : patch.maxOutputTokens === null
        ? null
        : String(patch.maxOutputTokens),
    changedKeys,
  );

  if (Object.keys(env).length > 0) {
    settings.env = env;
  } else if ("env" in settings) {
    delete settings.env;
  }

  if (patch.selectedModel !== undefined) {
    if (patch.selectedModel === null || patch.selectedModel === "") {
      if ("model" in settings) {
        delete settings.model;
        changedKeys.push("model");
      }
    } else if (settings.model !== patch.selectedModel) {
      settings.model = patch.selectedModel;
      changedKeys.push("model");
    }
  }

  if (changedKeys.length === 0) return { path: target, changedKeys };

  await writeFileAtomic(target, `${JSON.stringify(settings, null, 2)}\n`);
  return { path: target, changedKeys };
}

/** 清除全部档位映射，回到 Claude Code 官方默认模型。 */
export async function clearClaudeTiers(): Promise<WriteResult> {
  const tiers: Partial<Record<ClaudeTier, ClaudeTierInput>> = {};
  for (const key of TIER_ENV_KEYS) {
    const tier = (Object.keys(TIER_TO_ENV) as ClaudeTier[]).find((t) => TIER_TO_ENV[t] === key);
    if (tier) tiers[tier] = { modelId: "", displayName: "" };
  }
  return patchClaudeConfig({ tiers });
}

export type { LocalConfigIssue };
