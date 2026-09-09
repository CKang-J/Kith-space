/**
 * 本机运行器配置的统一入口。
 *
 * 四个运行器的磁盘格式完全不同（Claude 的 env 分层、Pi 的四文件、Codex 的 TOML、
 * OpenCode 的 provider 字典），各自的适配器负责解析，这里只做分发与聚合，
 * 让上层（API 路由、前端）只面对 LocalRuntimeConfig 一种形状。
 */

import { RUNTIME_IDS, type RuntimeId } from "../runtimeTypes.js";
import { readClaudeLocalConfig } from "./claudeAdapter.js";
import { readCodexLocalConfig } from "./codexAdapter.js";
import { readOpenCodeLocalConfig } from "./openCodeAdapter.js";
import { readPiLocalConfig } from "./piAdapter.js";
import type { LocalRuntimeConfig } from "./types.js";

/** 读取单个运行器的本机配置。适配器自身不抛错，异常都表达为 issues。 */
export async function readLocalRuntimeConfig(runtimeId: RuntimeId): Promise<LocalRuntimeConfig> {
  switch (runtimeId) {
    case "claude":
      return readClaudeLocalConfig();
    case "pi":
      return readPiLocalConfig();
    case "codex":
      return readCodexLocalConfig();
    case "opencode":
      return readOpenCodeLocalConfig();
  }
}

/** 读取所有运行器的本机配置，单个运行器失败不影响其余。 */
export async function readAllLocalRuntimeConfigs(): Promise<LocalRuntimeConfig[]> {
  return Promise.all(RUNTIME_IDS.map((runtimeId) => readLocalRuntimeConfig(runtimeId)));
}

export type {
  LocalConfigIssue,
  LocalConfigIssueKind,
  LocalModel,
  LocalProvider,
  LocalRuntimeConfig,
} from "./types.js";
export { primaryConfigPath } from "./paths.js";
export { clearClaudeTiers, patchClaudeConfig, type ClaudeConfigPatch } from "./claudeWriter.js";
export {
  deletePiProvider,
  setPiDefaultModel,
  writePiProvider,
  type PiProviderWriteInput,
} from "./piWriter.js";
