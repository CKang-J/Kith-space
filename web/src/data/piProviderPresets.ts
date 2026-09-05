/**
 * Pi Agent 供应商预设数据
 * 从后端类型定义派生，用于前端展示
 */

import type { ProviderPreset } from "../types/runtimeTypes";

export const PI_PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude 系列模型官方 API",
    runtimeId: "pi",
    websiteUrl: "https://www.anthropic.com",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    category: "official",
    isOfficial: true,
    primePartner: true,
    backendId: "anthropic",
    apiFormat: "anthropic-messages",
    canonicalOrigin: "https://api.anthropic.com",
    iconColor: "#D4915D",
    // 不预填模型，使用"获取模型列表"功能动态获取
    models: [],
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT 系列模型官方 API",
    runtimeId: "pi",
    websiteUrl: "https://openai.com",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    category: "official",
    isOfficial: true,
    backendId: "openai",
    apiFormat: "openai-chat",
    canonicalOrigin: "https://api.openai.com",
    iconColor: "#10A37F",
    // 不预填模型，使用"获取模型列表"功能
    models: [],
  },
  {
    id: "kimi",
    name: "Kimi",
    nameKey: "月之暗面 Kimi",
    description: "Moonshot AI 长文本模型",
    runtimeId: "pi",
    websiteUrl: "https://platform.moonshot.cn",
    apiKeyUrl: "https://platform.moonshot.cn/console/api-keys",
    category: "partner",
    isPartner: true,
    backendId: "moonshot",
    apiFormat: "openai-chat",
    canonicalOrigin: "https://api.moonshot.cn",
    iconColor: "#2E5CFF",
    models: [],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "深度求索推理模型",
    runtimeId: "pi",
    websiteUrl: "https://platform.deepseek.com",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    category: "partner",
    isPartner: true,
    backendId: "deepseek",
    apiFormat: "openai-chat",
    canonicalOrigin: "https://api.deepseek.com",
    iconColor: "#1A73E8",
    models: [],
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    description: "智谱 AI ChatGLM 系列",
    runtimeId: "pi",
    websiteUrl: "https://open.bigmodel.cn",
    apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    category: "partner",
    isPartner: true,
    backendId: "zhipu",
    apiFormat: "openai-chat",
    canonicalOrigin: "https://open.bigmodel.cn",
    iconColor: "#6366F1",
    models: [],
  },
  {
    id: "qwen",
    name: "阿里 Qwen",
    description: "阿里云通义千问系列",
    runtimeId: "pi",
    websiteUrl: "https://dashscope.aliyun.com",
    apiKeyUrl: "https://dashscope.console.aliyun.com/apiKey",
    category: "partner",
    isPartner: true,
    backendId: "qwen",
    apiFormat: "openai-chat",
    canonicalOrigin: "https://dashscope.aliyuncs.com",
    iconColor: "#FF6A00",
    models: [],
  },
  {
    id: "minimax",
    name: "MiniMax",
    description: "MiniMax AI 对话模型",
    runtimeId: "pi",
    websiteUrl: "https://www.minimaxi.com",
    apiKeyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    category: "community",
    backendId: "minimax",
    apiFormat: "openai-chat",
    canonicalOrigin: "https://api.minimax.chat",
    iconColor: "#7C3AED",
    models: [],
  },
  {
    id: "google",
    name: "Google Gemini",
    description: "Google Gemini 系列模型",
    runtimeId: "pi",
    websiteUrl: "https://ai.google.dev",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    category: "official",
    isOfficial: true,
    backendId: "google",
    apiFormat: "google-generative-ai",
    canonicalOrigin: "https://generativelanguage.googleapis.com",
    iconColor: "#4285F4",
    models: [],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "统一 API 路由，支持多家供应商",
    runtimeId: "pi",
    websiteUrl: "https://openrouter.ai",
    apiKeyUrl: "https://openrouter.ai/keys",
    category: "community",
    backendId: "openrouter",
    apiFormat: "openai-chat",
    canonicalOrigin: "https://openrouter.ai",
    iconColor: "#8B5CF6",
    models: [],
  },
  {
    id: "together",
    name: "Together AI",
    description: "开源模型云服务",
    runtimeId: "pi",
    websiteUrl: "https://www.together.ai",
    apiKeyUrl: "https://api.together.xyz/settings/api-keys",
    category: "community",
    backendId: "together",
    apiFormat: "openai-chat",
    canonicalOrigin: "https://api.together.xyz",
    iconColor: "#F59E0B",
    models: [],
  },
  {
    id: "groq",
    name: "Groq",
    description: "超高速推理引擎",
    runtimeId: "pi",
    websiteUrl: "https://groq.com",
    apiKeyUrl: "https://console.groq.com/keys",
    category: "community",
    backendId: "groq",
    apiFormat: "openai-chat",
    canonicalOrigin: "https://api.groq.com",
    iconColor: "#F97316",
    models: [],
  },
];

/**
 * 按分类获取预设
 */
export function getPiPresetsByCategory(category: ProviderPreset["category"]) {
  return PI_PROVIDER_PRESETS.filter((preset) => preset.category === category);
}

/**
 * 获取分组的预设
 */
export function getPiPresetsGrouped() {
  return {
    official: getPiPresetsByCategory("official"),
    partner: getPiPresetsByCategory("partner"),
    community: getPiPresetsByCategory("community"),
  };
}

/**
 * 根据 ID 获取预设
 */
export function getPiPresetById(id: string) {
  return PI_PROVIDER_PRESETS.find((preset) => preset.id === id);
}
