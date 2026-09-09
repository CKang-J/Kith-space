/**
 * 运行器配置文件的真实路径解析。
 *
 * 路径以本机实际情况和 cc-switch 的实现为准，不使用推测值：
 * - Claude Code: ~/.claude/settings.json，旧版命名 claude.json 作为回落
 * - Codex:       $CODEX_HOME/config.toml，缺省 ~/.codex/config.toml
 * - Pi Agent:    ~/.pi/agent/ 下的 models.json / models-store.json / auth.json / settings.json
 * - OpenCode:    ~/.config/opencode/opencode.json
 */

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RuntimeId } from "../runtimeTypes.js";

function home(): string {
  return os.homedir();
}

/** Claude Code 配置目录，支持 CLAUDE_CONFIG_DIR 覆盖。 */
export function claudeConfigDir(): string {
  const override = process.env.CLAUDE_CONFIG_DIR?.trim();
  return override ? override : path.join(home(), ".claude");
}

/**
 * Claude Code 主配置文件。优先 settings.json；仅当它不存在而旧版 claude.json 存在时
 * 才用旧文件（与 cc-switch 的 get_claude_settings_path 一致）。
 */
export function claudeSettingsPath(): string {
  const dir = claudeConfigDir();
  const settings = path.join(dir, "settings.json");
  if (existsSync(settings)) return settings;
  const legacy = path.join(dir, "claude.json");
  if (existsSync(legacy)) return legacy;
  return settings;
}

/** Codex 配置目录，支持 CODEX_HOME 覆盖。 */
export function codexConfigDir(): string {
  const override = process.env.CODEX_HOME?.trim();
  return override ? override : path.join(home(), ".codex");
}

export function codexConfigPath(): string {
  return path.join(codexConfigDir(), "config.toml");
}

export function codexAuthPath(): string {
  return path.join(codexConfigDir(), "auth.json");
}

/** Pi Agent 配置目录，支持 PI_AGENT_DIR 覆盖。 */
export function piConfigDir(): string {
  const override = process.env.PI_AGENT_DIR?.trim();
  return override ? override : path.join(home(), ".pi", "agent");
}

/** 用户自定义供应商，Pi 唯一可写的模型配置文件。 */
export function piModelsPath(): string {
  return path.join(piConfigDir(), "models.json");
}

/** Pi 缓存的各供应商模型清单（由 Pi 自己维护，只读）。 */
export function piModelsStorePath(): string {
  return path.join(piConfigDir(), "models-store.json");
}

/** Pi 的凭据文件，只用来判断某供应商是否已授权，不读取密钥值。 */
export function piAuthPath(): string {
  return path.join(piConfigDir(), "auth.json");
}

/** Pi 的默认供应商 / 模型 / thinking 档位。 */
export function piSettingsPath(): string {
  return path.join(piConfigDir(), "settings.json");
}

/** OpenCode 配置文件，支持 OPENCODE_CONFIG 覆盖。 */
export function openCodeConfigPath(): string {
  const override = process.env.OPENCODE_CONFIG?.trim();
  if (override) return override;
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const base = xdg ? xdg : path.join(home(), ".config");
  return path.join(base, "opencode", "opencode.json");
}

/** 各运行器的主配置文件路径。 */
export function primaryConfigPath(runtimeId: RuntimeId): string {
  switch (runtimeId) {
    case "claude":
      return claudeSettingsPath();
    case "codex":
      return codexConfigPath();
    case "pi":
      return piModelsPath();
    case "opencode":
      return openCodeConfigPath();
  }
}
