/**
 * Pi Agent 本机配置写入。
 *
 * Pi 把「供应商定义」和「凭据」分开存放，本模块同样分开写：
 *   - `~/.pi/agent/models.json` 的 `providers[]`  → 供应商与模型清单
 *   - `~/.pi/agent/auth.json` 的 `<providerId>`   → API Key
 *   - `~/.pi/agent/settings.json`                 → 默认供应商 / 默认模型
 *
 * 三个文件都以「读取 → 合并 → 原子写回」的方式更新，绝不整体覆盖：
 * models.json 里其它供应商、auth.json 里其它凭据、settings.json 里的
 * theme / packages 等字段都会原样保留。
 */

import { piAuthPath, piModelsPath, piSettingsPath } from "./paths.js";
import { asRecord, readJsonFile, writeFileAtomic } from "./fileIo.js";

/** 写入 Pi 供应商时接受的入参。models 为空表示交给 Pi 动态拉取。 */
export interface PiProviderWriteInput {
  id: string;
  name?: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  models?: Array<{
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    reasoning?: boolean;
  }>;
}

/**
 * 读出 JSON 对象用于合并。
 *
 * 文件不存在按空对象起步；但文件存在却解析失败时必须抛错中止，
 * 否则会把用户损坏（但可手工修复）的配置直接覆盖成新内容。
 */
async function readObject(target: string): Promise<Record<string, unknown>> {
  const result = await readJsonFile(target);
  if (result.ok) return asRecord(result.value);
  if (result.issue.kind === "not_found") return {};
  throw new Error(`${result.issue.message} 为避免覆盖用户数据，已中止写入。`);
}

/**
 * 把供应商写进 models.json 的 providers[]。
 * 同 id 覆盖，其余供应商保持原顺序与原字段。
 */
async function writeProviderEntry(input: PiProviderWriteInput): Promise<void> {
  const target = piModelsPath();
  const root = await readObject(target);
  const existing = Array.isArray(root.providers) ? [...(root.providers as unknown[])] : [];

  const entry: Record<string, unknown> = {
    id: input.id,
    ...(input.name ? { name: input.name } : {}),
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    ...(input.api ? { api: input.api } : {}),
    models: (input.models ?? []).map((model) => ({
      id: model.id,
      ...(model.name ? { name: model.name } : {}),
      ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
      ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
      ...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
    })),
  };

  const index = existing.findIndex((item) => asRecord(item).id === input.id);
  if (index >= 0) {
    // 保留该供应商上已存在但本次未提交的字段（例如 Pi 自己写的 compat）。
    existing[index] = { ...asRecord(existing[index]), ...entry };
  } else {
    existing.push(entry);
  }

  await writeFileAtomic(target, `${JSON.stringify({ ...root, providers: existing }, null, 2)}\n`);
}

/**
 * 把 API Key 写进 auth.json。空值表示删除该供应商的凭据。
 * auth.json 权限保持 0600（由 writeFileAtomic 负责）。
 */
async function writeAuthEntry(providerId: string, apiKey: string | undefined): Promise<void> {
  const target = piAuthPath();
  const root = await readObject(target);

  if (apiKey === undefined) return;

  const next = { ...root };
  if (apiKey === "") {
    delete next[providerId];
  } else {
    const previous = asRecord(root[providerId]);
    next[providerId] = { ...previous, type: previous.type ?? "api_key", key: apiKey };
  }

  await writeFileAtomic(target, `${JSON.stringify(next, null, 2)}\n`);
}

/** 写入 Pi 供应商定义与凭据。返回实际改动过的文件列表，供 UI 展示。 */
export async function writePiProvider(input: PiProviderWriteInput): Promise<string[]> {
  const touched: string[] = [];
  await writeProviderEntry(input);
  touched.push(piModelsPath());
  if (input.apiKey !== undefined) {
    await writeAuthEntry(input.id, input.apiKey);
    touched.push(piAuthPath());
  }
  return touched;
}

/** 从 models.json 移除供应商定义，并清掉它在 auth.json 里的凭据。 */
export async function deletePiProvider(providerId: string): Promise<string[]> {
  const touched: string[] = [];

  const modelsTarget = piModelsPath();
  const root = await readObject(modelsTarget);
  if (Array.isArray(root.providers)) {
    const kept = (root.providers as unknown[]).filter(
      (item) => asRecord(item).id !== providerId,
    );
    await writeFileAtomic(modelsTarget, `${JSON.stringify({ ...root, providers: kept }, null, 2)}\n`);
    touched.push(modelsTarget);
  }

  const authTarget = piAuthPath();
  const auth = await readObject(authTarget);
  if (providerId in auth) {
    const next = { ...auth };
    delete next[providerId];
    await writeFileAtomic(authTarget, `${JSON.stringify(next, null, 2)}\n`);
    touched.push(authTarget);
  }

  return touched;
}

/** 设置 Pi 的默认供应商与默认模型，settings.json 其它字段保持不变。 */
export async function setPiDefaultModel(providerId: string, modelId: string): Promise<string> {
  const target = piSettingsPath();
  const root = await readObject(target);
  await writeFileAtomic(
    target,
    `${JSON.stringify({ ...root, defaultProvider: providerId, defaultModel: modelId }, null, 2)}\n`,
  );
  return target;
}
