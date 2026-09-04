/**
 * Codex 供应商预设数据
 */

import type { ProviderPreset } from "../types/runtimeTypes";

export const CODEX_PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT 系列模型官方 API",
    runtimeId: "codex",
    websiteUrl: "https://openai.com",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    category: "official",
    isOfficial: true,
    backendId: "openai",
    apiFormat: "openai-chat",
    canonicalOrigin: "https://api.openai.com",
    iconColor: "#10A37F",
    models: [
      {
        id: "gpt-4o",
        displayName: "GPT-4o",
        contextWindow: 128000,
        maxOutputTokens: 16384,
        inputCapabilities: ["文本", "图像", "音频"],
      },
      {
        id: "gpt-4o-mini",
        displayName: "GPT-4o mini",
        contextWindow: 128000,
        maxOutputTokens: 16384,
        inputCapabilities: ["文本", "图像"],
      },
      {
        id: "o1",
        displayName: "o1",
        contextWindow: 200000,
        maxOutputTokens: 100000,
        inputCapabilities: ["文本"],
      },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude 系列模型",
    runtimeId: "codex",
    websiteUrl: "https://www.anthropic.com",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    category: "partner",
    isPartner: true,
    backendId: "anthropic",
    apiFormat: "anthropic-messages",
    canonicalOrigin: "https://api.anthropic.com",
    iconColor: "#D4915D",
    models: [
      {
        id: "claude-3-5-sonnet-20241022",
        displayName: "Claude 3.5 Sonnet",
        contextWindow: 200000,
        maxOutputTokens: 8192,
        inputCapabilities: ["文本", "图像"],
      },
    ],
  },
];

export function getCodexPresetById(id: string) {
  return CODEX_PROVIDER_PRESETS.find((preset) => preset.id === id);
}
