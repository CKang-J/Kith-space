/**
 * OpenCode 供应商预设数据
 */

import type { ProviderPreset } from "../types/runtimeTypes";

export const OPENCODE_PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT 系列模型官方 API",
    runtimeId: "opencode",
    websiteUrl: "https://openai.com",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    category: "official",
    isOfficial: true,
    backendId: "openai",
    apiFormat: "openai-chat",
    canonicalOrigin: "https://api.openai.com",
    iconColor: "#10A37F",
    models: [],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude 系列模型",
    runtimeId: "opencode",
    websiteUrl: "https://www.anthropic.com",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    category: "partner",
    isPartner: true,
    backendId: "anthropic",
    apiFormat: "anthropic-messages",
    canonicalOrigin: "https://api.anthropic.com",
    iconColor: "#D4915D",
    models: [],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "统一 API 路由，支持多家供应商",
    runtimeId: "opencode",
    websiteUrl: "https://openrouter.ai",
    apiKeyUrl: "https://openrouter.ai/keys",
    category: "community",
    backendId: "openrouter",
    apiFormat: "openai-chat",
    canonicalOrigin: "https://openrouter.ai",
    iconColor: "#8B5CF6",
    models: [],
  },
];

export function getOpenCodePresetById(id: string) {
  return OPENCODE_PROVIDER_PRESETS.find((preset) => preset.id === id);
}
