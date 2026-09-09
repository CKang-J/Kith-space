/**
 * 读取本机 Pi Agent 配置。
 *
 * Pi 把信息拆在 ~/.pi/agent/ 下四个文件里，缺一个就读不全：
 *   models.json        用户自定义供应商（{ providers: [...] }），通常为空
 *   models-store.json  Pi 缓存的各内置供应商模型清单（{ <providerId>: { models: [...] } }）
 *   auth.json          已登录的供应商（{ <providerId>: { type, key } }）
 *   settings.json      默认供应商 / 默认模型 / 默认 thinking 档位
 *
 * 只读 models.json 是之前读不到东西的根因：内置供应商的模型全在 models-store.json 里。
 */

import type { LocalConfigIssue, LocalModel, LocalProvider, LocalRuntimeConfig } from "./types.js";
import { asNumber, asRecord, asString, readJsonFile } from "./fileIo.js";
import { piAuthPath, piModelsPath, piModelsStorePath, piSettingsPath } from "./paths.js";

/** models-store.json / models.json 里单个模型条目的原始形状。 */
interface RawPiModel {
  id?: unknown;
  name?: unknown;
  api?: unknown;
  baseUrl?: unknown;
  provider?: unknown;
  reasoning?: unknown;
  input?: unknown;
  contextWindow?: unknown;
  maxTokens?: unknown;
  thinkingLevelMap?: unknown;
}

/**
 * thinkingLevelMap 的键是全部档位，值为 null 表示该档位不被这个模型支持。
 * 只把值非 null 的档位当作可用，否则界面会给出模型实际拒绝的选项。
 */
function extractThinkingLevels(value: unknown): string[] | undefined {
  const map = asRecord(value);
  const levels = Object.entries(map)
    .filter(([, level]) => level !== null && level !== undefined)
    .map(([name]) => name);
  return levels.length > 0 ? levels : undefined;
}

function toLocalModel(raw: RawPiModel): LocalModel | undefined {
  const id = asString(raw.id);
  if (!id) return undefined;

  const inputs = Array.isArray(raw.input)
    ? raw.input.filter((item): item is string => typeof item === "string")
    : undefined;
  const contextWindow = asNumber(raw.contextWindow);
  const maxTokens = asNumber(raw.maxTokens);
  const thinkingLevels = extractThinkingLevels(raw.thinkingLevelMap);
  const displayName = asString(raw.name);

  return {
    id,
    ...(displayName === undefined ? {} : { displayName }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxTokens === undefined ? {} : { maxOutputTokens: maxTokens }),
    ...(inputs && inputs.length > 0 ? { inputCapabilities: inputs } : {}),
    ...(typeof raw.reasoning === "boolean" ? { reasoning: raw.reasoning } : {}),
    ...(thinkingLevels === undefined ? {} : { thinkingLevels }),
  };
}

function readModelList(value: unknown): LocalModel[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => toLocalModel(asRecord(item) as RawPiModel))
    .filter((model): model is LocalModel => model !== undefined);
}

/** 同一供应商下取第一个模型的 baseUrl 作为该供应商地址——Pi 把它冗余在每个模型上。 */
function deriveBaseUrl(models: unknown): string | undefined {
  if (!Array.isArray(models)) return undefined;
  for (const item of models) {
    const url = asString(asRecord(item).baseUrl);
    if (url) return url;
  }
  return undefined;
}

/** 同理，api 字段（openai-completions / anthropic-messages 等）也挂在模型上。 */
function deriveApiFormat(models: unknown): string | undefined {
  if (!Array.isArray(models)) return undefined;
  for (const item of models) {
    const api = asString(asRecord(item).api);
    if (api) return api;
  }
  return undefined;
}

export async function readPiLocalConfig(): Promise<LocalRuntimeConfig> {
  const primaryPath = piModelsPath();
  const storePath = piModelsStorePath();
  const authPath = piAuthPath();
  const settingsPath = piSettingsPath();
  const issues: LocalConfigIssue[] = [];

  const [customRead, storeRead, authRead, settingsRead] = await Promise.all([
    readJsonFile(primaryPath),
    readJsonFile(storePath),
    readJsonFile(authPath),
    readJsonFile(settingsPath),
  ]);

  // 单个文件损坏（而不是缺失）要告诉用户，缺失属正常情况不打扰。
  for (const read of [customRead, storeRead, authRead, settingsRead]) {
    if (!read.ok && read.issue.kind !== "not_found") issues.push(read.issue);
  }

  // 四个文件都读不到才算「Pi 未配置」；只要有一个有内容就继续拼装。
  // 注意：即使全部读取都失败，也要优先把上面收集到的真实问题（如某文件损坏）
  // 报出来，而不是被 customRead 的 not_found 覆盖掉——损坏和缺失是不同的问题。
  if (!customRead.ok && !storeRead.ok && !authRead.ok && !settingsRead.ok) {
    return {
      runtimeId: "pi",
      primaryPath,
      present: false,
      providers: [],
      issues: issues.length > 0 ? issues : [customRead.issue],
    };
  }

  const authorized = authRead.ok ? asRecord(authRead.value) : {};
  const settings = settingsRead.ok ? asRecord(settingsRead.value) : {};
  const defaultProvider = asString(settings.defaultProvider);
  const defaultModel = asString(settings.defaultModel);

  const providers: LocalProvider[] = [];

  // 1) models-store.json：Pi 已缓存模型清单的内置供应商。
  const store = storeRead.ok ? asRecord(storeRead.value) : {};
  for (const [providerId, entry] of Object.entries(store)) {
    const record = asRecord(entry);
    const models = readModelList(record.models);
    if (models.length === 0) continue;

    const credentialType = asString(asRecord(authorized[providerId]).type);
    providers.push({
      id: providerId,
      runtimeId: "pi",
      displayName: providerId,
      ...(deriveApiFormat(record.models) === undefined
        ? {}
        : { apiFormat: deriveApiFormat(record.models) }),
      ...(deriveBaseUrl(record.models) === undefined
        ? {}
        : { baseUrl: deriveBaseUrl(record.models) }),
      credential: {
        configured: Object.prototype.hasOwnProperty.call(authorized, providerId),
        ...(credentialType === undefined ? {} : { source: `auth.json（${credentialType}）` }),
      },
      models,
      ...(providerId === defaultProvider && defaultModel ? { defaultModelId: defaultModel } : {}),
      sourcePaths: [storePath, ...(authRead.ok ? [authPath] : [])],
    });
  }

  // 2) models.json：用户手写的自定义供应商，覆盖同 id 的缓存条目。
  const custom = customRead.ok ? asRecord(customRead.value) : {};
  const customProviders = Array.isArray(custom.providers) ? custom.providers : [];
  for (const item of customProviders) {
    const record = asRecord(item);
    const providerId = asString(record.id);
    if (!providerId) continue;

    const models = readModelList(record.models);
    const baseUrl = asString(record.baseUrl) ?? deriveBaseUrl(record.models);
    const apiFormat = asString(record.api) ?? deriveApiFormat(record.models);
    const displayName = asString(record.name) ?? providerId;
    // 自定义供应商可以把密钥内联在 models.json 里，这里只判断有无。
    const inlineKey = asString(record.apiKey) !== undefined;
    const credentialType = asString(asRecord(authorized[providerId]).type);

    const provider: LocalProvider = {
      id: providerId,
      runtimeId: "pi",
      displayName,
      ...(apiFormat === undefined ? {} : { apiFormat }),
      ...(baseUrl === undefined ? {} : { baseUrl }),
      credential: {
        configured: inlineKey || Object.prototype.hasOwnProperty.call(authorized, providerId),
        source: inlineKey ? "models.json 内联密钥" : (credentialType ? `auth.json（${credentialType}）` : undefined),
      },
      models,
      ...(providerId === defaultProvider && defaultModel ? { defaultModelId: defaultModel } : {}),
      sourcePaths: [primaryPath],
    };

    const existing = providers.findIndex((candidate) => candidate.id === providerId);
    if (existing >= 0) providers[existing] = provider;
    else providers.push(provider);
  }

  // 3) auth.json 里已登录、但 models-store.json 还没缓存模型清单的供应商：
  //    列出来并说明原因，比直接隐藏更有用（用户知道该去 Pi 里刷新一次）。
  for (const providerId of Object.keys(authorized)) {
    if (providers.some((candidate) => candidate.id === providerId)) continue;
    const credentialType = asString(asRecord(authorized[providerId]).type);
    providers.push({
      id: providerId,
      runtimeId: "pi",
      displayName: providerId,
      credential: {
        configured: true,
        ...(credentialType === undefined ? {} : { source: `auth.json（${credentialType}）` }),
      },
      models: [],
      sourcePaths: [authPath],
    });
    issues.push({
      kind: "notice",
      path: storePath,
      message: `供应商 ${providerId} 已在 Pi 中登录，但本机还没有缓存它的模型清单，请在 Pi Agent 里使用一次该供应商以生成清单。`,
    });
  }

  // 默认供应商排在最前，与 Pi 自身的选中状态保持一致。
  providers.sort((a, b) => {
    if (a.id === defaultProvider) return -1;
    if (b.id === defaultProvider) return 1;
    return a.id.localeCompare(b.id);
  });

  return { runtimeId: "pi", primaryPath, present: providers.length > 0, providers, issues };
}
