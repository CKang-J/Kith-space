import path from "node:path";
import { managedRuntimesDir } from "../paths.js";

export const SETUP_RUNTIME_IDS = ["claude", "codex", "opencode", "pi"] as const;
export type SetupRuntimeId = (typeof SETUP_RUNTIME_IDS)[number];

export interface RuntimeSetupDefinition {
  id: SetupRuntimeId;
  label: string;
  command: string;
  summary: string;
  packageName: string;
  testedVersion: string;
  installExtraArgs?: readonly string[];
  loginCommand: string;
  accountHelp: string;
}

export const RUNTIME_SETUP_CATALOG: readonly RuntimeSetupDefinition[] = [
  {
    id: "claude",
    label: "Claude Code",
    command: "claude",
    summary: "Anthropic 的编码 Agent，支持 Kith 工具与会话恢复。",
    packageName: "@anthropic-ai/claude-code",
    testedVersion: "2.1.214",
    loginCommand: "claude login",
    accountHelp: "使用 Anthropic 账号登录，或通过 Kith 模型配置提供连接。",
  },
  {
    id: "codex",
    label: "Codex",
    command: "codex",
    summary: "OpenAI 的编码 Agent，支持 ChatGPT 账号或 Kith 模型配置。",
    packageName: "@openai/codex",
    testedVersion: "0.144.6",
    loginCommand: "codex login",
    accountHelp: "使用 ChatGPT 账号登录，或通过 Kith 模型配置提供连接。",
  },
  {
    id: "opencode",
    label: "OpenCode",
    command: "opencode",
    summary: "开源编码 Agent，通过 provider/model 选择模型。",
    packageName: "opencode-ai",
    testedVersion: "1.15.10",
    loginCommand: "opencode auth login",
    accountHelp: "至少配置一个 OpenCode 供应商凭据，或使用 Kith 模型配置。",
  },
  {
    id: "pi",
    label: "Pi",
    command: "pi",
    summary: "轻量、可扩展的编码 Agent；聊天运行器与记忆整理器相互独立。",
    packageName: "@earendil-works/pi-coding-agent",
    testedVersion: "0.81.1",
    installExtraArgs: ["--ignore-scripts"],
    loginCommand: "pi",
    accountHelp: "在 Pi 中选择供应商并完成登录，或使用 Kith 模型配置。",
  },
] as const;

export function runtimeSetupDefinition(runtimeId: string): RuntimeSetupDefinition {
  const definition = RUNTIME_SETUP_CATALOG.find((item) => item.id === runtimeId);
  if (!definition) throw new Error(`unsupported runtime setup: ${runtimeId}`);
  return definition;
}

export function managedRuntimePrefix(runtimeId: SetupRuntimeId): string {
  return path.join(managedRuntimesDir(), runtimeId);
}

export function managedRuntimeBinDir(runtimeId: SetupRuntimeId): string {
  return path.join(managedRuntimePrefix(runtimeId), "node_modules", ".bin");
}

export function managedRuntimeExecutable(runtimeId: SetupRuntimeId): string {
  const definition = runtimeSetupDefinition(runtimeId);
  const suffix = process.platform === "win32" ? ".cmd" : "";
  return path.join(managedRuntimeBinDir(runtimeId), `${definition.command}${suffix}`);
}

export function managedRuntimePathEntries(): string[] {
  return SETUP_RUNTIME_IDS.map(managedRuntimeBinDir);
}

export function withManagedRuntimePath(sourcePath = process.env.PATH ?? ""): string {
  const existing = sourcePath.split(path.delimiter).filter(Boolean);
  return [...managedRuntimePathEntries(), ...existing.filter((entry) => !managedRuntimePathEntries().includes(entry))]
    .join(path.delimiter);
}
