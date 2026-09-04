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
    models: [
      {
        id: "claude-3-5-sonnet-20241022",
        displayName: "Claude 3.5 Sonnet",
        contextWindow: 200000,
        maxOutputTokens: 8192,
        inputCapabilities: ["文本", "图像"],
      },
      {
        id: "claude-3-5-haiku-20241022",
        displayName: "Claude 3.5 Haiku",
        contextWindow: 200000,
        maxOutputTokens: 8192,
        inputCapabilities: ["文本", "图像"],
      },
      {
        id: "claude-3-opus-20240229",
        displayName: "Claude 3 Opus",
        contextWindow: 200000,
        maxOutputTokens: 4096,
        inputCapabilities: ["文本", "图像"],
      },
    ],
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
      {
        id: "o1-mini",
        displayName: "o1-mini",
        contextWindow: 128000,
        maxOutputTokens: 65536,
        inputCapabilities: ["文本"],
      },
    ],
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
    models: [
      {
        id: "moonshot-v1-8k",
        displayName: "Moonshot v1 8k",
        contextWindow: 8000,
        maxOutputTokens: 4000,
        inputCapabilities: ["文本"],
      },
      {
        id: "moonshot-v1-32k",
        displayName: "Moonshot v1 32k",
        contextWindow: 32000,
        maxOutputTokens: 4000,
        inputCapabilities: ["文本"],
      },
      {
        id: "moonshot-v1-128k",
        displayName: "Moonshot v1 128k",
        contextWindow: 128000,
        maxOutputTokens: 4000,
        inputCapabilities: ["文本"],
      },
    ],
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
    models: [
      {
        id: "deepseek-chat",
        displayName: "DeepSeek Chat",
        contextWindow: 64000,
        maxOutputTokens: 4096,
        inputCapabilities: ["文本"],
      },
      {
        id: "deepseek-reasoner",
        displayName: "DeepSeek Reasoner",
        contextWindow: 64000,
        maxOutputTokens: 8000,
        inputCapabilities: ["文本"],
      },
    ],
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
    models: [
      {
        id: "glm-4-plus",
        displayName: "GLM-4-Plus",
        contextWindow: 128000,
        maxOutputTokens: 4096,
        inputCapabilities: ["文本"],
      },
      {
        id: "glm-4-air",
        displayName: "GLM-4-Air",
        contextWindow: 128000,
        maxOutputTokens: 4096,
        inputCapabilities: ["文本"],
      },
      {
        id: "glm-4-flash",
        displayName: "GLM-4-Flash",
        contextWindow: 128000,
        maxOutputTokens: 4096,
        inputCapabilities: ["文本"],
      },
    ],
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
    models: [
      {
        id: "qwen-max",
        displayName: "Qwen Max",
        contextWindow: 30000,
        maxOutputTokens: 8000,
        inputCapabilities: ["文本"],
      },
      {
        id: "qwen-plus",
        displayName: "Qwen Plus",
        contextWindow: 30000,
        maxOutputTokens: 8000,
        inputCapabilities: ["文本"],
      },
      {
        id: "qwen-turbo",
        displayName: "Qwen Turbo",
        contextWindow: 30000,
        maxOutputTokens: 8000,
        inputCapabilities: ["文本"],
      },
    ],
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
    models: [
      {
        id: "abab6.5s-chat",
        displayName: "abab6.5s Chat",
        contextWindow: 245000,
        maxOutputTokens: 8192,
        inputCapabilities: ["文本"],
      },
      {
        id: "abab6.5-chat",
        displayName: "abab6.5 Chat",
        contextWindow: 200000,
        maxOutputTokens: 8192,
        inputCapabilities: ["文本"],
      },
    ],
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
    models: [
      {
        id: "gemini-2.0-flash-exp",
        displayName: "Gemini 2.0 Flash",
        contextWindow: 1000000,
        maxOutputTokens: 8192,
        inputCapabilities: ["文本", "图像", "音频", "视频"],
      },
      {
        id: "gemini-1.5-pro",
        displayName: "Gemini 1.5 Pro",
        contextWindow: 2000000,
        maxOutputTokens: 8192,
        inputCapabilities: ["文本", "图像", "音频", "视频"],
      },
      {
        id: "gemini-1.5-flash",
        displayName: "Gemini 1.5 Flash",
        contextWindow: 1000000,
        maxOutputTokens: 8192,
        inputCapabilities: ["文本", "图像", "音频", "视频"],
      },
    ],
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
