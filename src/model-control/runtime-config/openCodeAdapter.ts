/**
 * 读取本机 OpenCode（~/.config/opencode/opencode.json）配置，归一化成 LocalRuntimeConfig。
 *
 * OpenCode 用 JSON，结构比 Codex 简单：`provider` 字典下每个 key 一个供应商，
 * 各供应商下再有 `models` 字典。
 */

import { asRecord, asString, readJsonFile } from "./fileIo.js";
import { openCodeConfigPath } from "./paths.js";
import type { LocalConfigIssue, LocalModel, LocalProvider, LocalRuntimeConfig } from "./types.js";

export async function readOpenCodeLocalConfig(): Promise<LocalRuntimeConfig> {
  const primaryPath = openCodeConfigPath();
  const read = await readJsonFile(primaryPath);
  if (!read.ok) {
    return { runtimeId: "opencode", primaryPath, present: false, providers: [], issues: [read.issue] };
  }

  const root = asRecord(read.value);
  const providerDict = asRecord(root["provider"]);
  const defaultModelSpec = asString(root["model"]);
  const issues: LocalConfigIssue[] = [];

  const providers: LocalProvider[] = Object.entries(providerDict).map(([providerId, rawProvider]) =>
    buildProvider(providerId, asRecord(rawProvider), defaultModelSpec, primaryPath),
  );

  return { runtimeId: "opencode", primaryPath, present: true, providers, issues };
}

function buildProvider(
  providerId: string,
  raw: Record<string, unknown>,
  defaultModelSpec: string | undefined,
  primaryPath: string,
): LocalProvider {
  const options = asRecord(raw["options"]);
  const apiKey = asString(options["apiKey"]);
  const modelsDict = asRecord(raw["models"]);

  const models: LocalModel[] = Object.entries(modelsDict).map(([modelId, rawModel]) =>
    buildModel(modelId, asRecord(rawModel)),
  );

  return {
    id: providerId,
    runtimeId: "opencode",
    displayName: asString(raw["name"]) ?? providerId,
    apiFormat: inferApiFormat(asString(raw["npm"])),
    baseUrl: asString(options["baseURL"]),
    credential: { configured: apiKey !== undefined, source: "opencode.json" },
    models,
    defaultModelId: resolveDefaultModelId(providerId, defaultModelSpec),
    sourcePaths: [primaryPath],
  };
}

function buildModel(modelId: string, raw: Record<string, unknown>): LocalModel {
  const limit = asRecord(raw["limit"]);
  const modalities = asRecord(raw["modalities"]);
  const inputCapabilities = asStringArray(modalities["input"]);

  return {
    id: modelId,
    displayName: asString(raw["name"]),
    contextWindow: asPositiveInteger(limit["context"]),
    maxOutputTokens: asPositiveInteger(limit["output"]),
    inputCapabilities,
  };
}

/** 顶层 `model` 形如 "provider/model" 时只取斜杠后的部分，仅赋给匹配的 provider。 */
function resolveDefaultModelId(providerId: string, defaultModelSpec: string | undefined): string | undefined {
  if (!defaultModelSpec) return undefined;
  const slashIndex = defaultModelSpec.indexOf("/");
  if (slashIndex === -1) return undefined; // 没有 provider 前缀，无法判断归属哪个供应商
  const specProviderId = defaultModelSpec.slice(0, slashIndex);
  const specModelId = defaultModelSpec.slice(slashIndex + 1);
  if (specProviderId !== providerId || specModelId === "") return undefined;
  return specModelId;
}

function inferApiFormat(npm: string | undefined): string | undefined {
  if (!npm) return undefined;
  if (npm === "@ai-sdk/openai" || npm === "@ai-sdk/openai-compatible") return "openai-completions";
  if (npm.includes("anthropic")) return "anthropic-messages";
  if (npm.includes("google")) return "google-generative-ai";
  return undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.filter((item): item is string => typeof item === "string");
  return result.length > 0 ? result : undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
