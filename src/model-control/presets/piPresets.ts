/**
 * Pi Agent 运行器的供应商预设
 * 参考 cc-switch 的 piProviderPresets.ts
 */

import type { ProviderPreset } from '../runtimeTypes.js';

/**
 * Pi Agent 支持的供应商预设列表
 */
export const PI_PROVIDER_PRESETS: ProviderPreset[] = [
  // ===== 官方预设 =====
  {
    id: 'anthropic-official',
    name: 'Anthropic Official',
    description: 'Anthropic 官方 API',
    runtimeId: 'pi',
    websiteUrl: 'https://www.anthropic.com',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    category: 'official',
    isOfficial: true,
    backendId: 'anthropic',
    apiFormat: 'anthropic-messages',
    canonicalOrigin: 'https://api.anthropic.com',
    icon: 'anthropic',
    iconColor: '#D4915D',
    models: [
      {
        id: 'claude-opus-4-8',
        displayName: 'Claude Opus 4.8',
        contextWindow: 200000,
        maxOutputTokens: 16384,
        inputCapabilities: ['text', 'image', 'pdf'],
      },
      {
        id: 'claude-sonnet-4-1',
        displayName: 'Claude Sonnet 4.1',
        contextWindow: 200000,
        maxOutputTokens: 16384,
        inputCapabilities: ['text', 'image', 'pdf'],
      },
      {
        id: 'claude-sonnet-3-5',
        displayName: 'Claude Sonnet 3.5',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        inputCapabilities: ['text', 'image'],
      },
    ],
  },

  {
    id: 'openai-official',
    name: 'OpenAI Official',
    description: 'OpenAI 官方 API',
    runtimeId: 'pi',
    websiteUrl: 'https://platform.openai.com',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    category: 'official',
    isOfficial: true,
    backendId: 'openai',
    apiFormat: 'openai-responses',
    canonicalOrigin: 'https://api.openai.com',
    icon: 'openai',
    iconColor: '#10A37F',
    models: [
      {
        id: 'gpt-4o',
        displayName: 'GPT-4o',
        contextWindow: 128000,
        maxOutputTokens: 16384,
        inputCapabilities: ['text', 'image'],
      },
      {
        id: 'o1',
        displayName: 'O1',
        contextWindow: 200000,
        maxOutputTokens: 100000,
        inputCapabilities: ['text'],
        thinkingLevels: ['low', 'medium', 'high'],
      },
    ],
  },

  // ===== 合作伙伴预设 =====
  {
    id: 'kimi',
    name: 'Kimi',
    description: '月之暗面 Kimi 模型',
    runtimeId: 'pi',
    websiteUrl: 'https://platform.kimi.com',
    apiKeyUrl: 'https://platform.kimi.com/console/api-keys',
    category: 'partner',
    isPartner: true,
    primePartner: true,
    backendId: 'moonshot',
    apiFormat: 'openai-completions',
    canonicalOrigin: 'https://api.moonshot.cn/v1',
    icon: 'kimi',
    iconColor: '#FF6B35',
    models: [
      {
        id: 'kimi-k3',
        displayName: 'Kimi K3',
        contextWindow: 1048576,
        maxOutputTokens: 131072,
        inputCapabilities: ['text', 'image', 'video'],
      },
      {
        id: 'kimi-k2.7-code',
        displayName: 'Kimi K2.7 Code',
        contextWindow: 262144,
        maxOutputTokens: 131072,
        inputCapabilities: ['text'],
      },
      {
        id: 'kimi-k2.6',
        displayName: 'Kimi K2.6',
        contextWindow: 262144,
        maxOutputTokens: 262144,
        inputCapabilities: ['text', 'image', 'video'],
      },
    ],
  },

  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek 推理模型',
    runtimeId: 'pi',
    websiteUrl: 'https://platform.deepseek.com',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    category: 'partner',
    isPartner: true,
    backendId: 'deepseek',
    apiFormat: 'openai-completions',
    canonicalOrigin: 'https://api.deepseek.com',
    icon: 'deepseek',
    iconColor: '#1E40AF',
    models: [
      {
        id: 'deepseek-v4-pro',
        displayName: 'DeepSeek V4 Pro',
        contextWindow: 128000,
        maxOutputTokens: 8192,
        inputCapabilities: ['text'],
      },
      {
        id: 'deepseek-reasoner',
        displayName: 'DeepSeek Reasoner',
        contextWindow: 64000,
        maxOutputTokens: 8192,
        inputCapabilities: ['text'],
        thinkingLevels: ['off', 'on'],
      },
      {
        id: 'deepseek-chat',
        displayName: 'DeepSeek Chat',
        contextWindow: 64000,
        maxOutputTokens: 4096,
        inputCapabilities: ['text'],
      },
    ],
  },

  {
    id: 'zhipu-glm',
    name: '智谱 AI',
    description: '智谱 GLM 系列模型',
    runtimeId: 'pi',
    websiteUrl: 'https://open.bigmodel.cn',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    category: 'partner',
    isPartner: true,
    backendId: 'zhipu',
    apiFormat: 'openai-completions',
    canonicalOrigin: 'https://open.bigmodel.cn/api/paas/v4',
    icon: 'zhipu',
    iconColor: '#4F46E5',
    models: [
      {
        id: 'glm-5.1',
        displayName: 'GLM 5.1',
        contextWindow: 204800,
        maxOutputTokens: 131072,
        inputCapabilities: ['text'],
      },
      {
        id: 'glm-4-flash',
        displayName: 'GLM 4 Flash',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        inputCapabilities: ['text', 'image'],
      },
      {
        id: 'glm-4-plus',
        displayName: 'GLM 4 Plus',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        inputCapabilities: ['text', 'image'],
      },
    ],
  },

  {
    id: 'alibaba-qwen',
    name: '阿里云通义千问',
    description: '阿里云通义千问系列模型',
    runtimeId: 'pi',
    websiteUrl: 'https://dashscope.aliyun.com',
    apiKeyUrl: 'https://dashscope.console.aliyun.com/apiKey',
    category: 'partner',
    isPartner: true,
    backendId: 'qwen',
    apiFormat: 'openai-completions',
    canonicalOrigin: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    icon: 'qwen',
    iconColor: '#FF6A00',
    models: [
      {
        id: 'qwen-max',
        displayName: 'Qwen Max',
        contextWindow: 30720,
        maxOutputTokens: 8192,
        inputCapabilities: ['text'],
      },
      {
        id: 'qwen-plus',
        displayName: 'Qwen Plus',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        inputCapabilities: ['text'],
      },
      {
        id: 'qwen-turbo',
        displayName: 'Qwen Turbo',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        inputCapabilities: ['text'],
      },
    ],
  },

  {
    id: 'minimax',
    name: 'MiniMax',
    description: 'MiniMax 大模型',
    runtimeId: 'pi',
    websiteUrl: 'https://platform.minimaxi.com',
    apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    category: 'partner',
    isPartner: true,
    backendId: 'minimax',
    apiFormat: 'openai-completions',
    canonicalOrigin: 'https://api.minimax.chat/v1',
    icon: 'minimax',
    iconColor: '#FF6B6B',
    models: [
      {
        id: 'MiniMax-M2.7',
        displayName: 'MiniMax M2.7',
        contextWindow: 204800,
        maxOutputTokens: 131072,
        inputCapabilities: ['text'],
      },
    ],
  },

  {
    id: 'google-gemini',
    name: 'Google Gemini',
    description: 'Google Gemini 系列模型',
    runtimeId: 'pi',
    websiteUrl: 'https://ai.google.dev',
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    category: 'partner',
    isPartner: true,
    backendId: 'google',
    apiFormat: 'google-generative-ai',
    canonicalOrigin: 'https://generativelanguage.googleapis.com',
    icon: 'google',
    iconColor: '#4285F4',
    models: [
      {
        id: 'gemini-2.5-flash',
        displayName: 'Gemini 2.5 Flash',
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        inputCapabilities: ['text', 'image', 'pdf', 'video', 'audio'],
      },
      {
        id: 'gemini-2.5-pro',
        displayName: 'Gemini 2.5 Pro',
        contextWindow: 2097152,
        maxOutputTokens: 65536,
        inputCapabilities: ['text', 'image', 'pdf', 'video', 'audio'],
      },
    ],
  },

  // ===== 社区预设 =====
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: '聚合多个 AI 模型的路由服务',
    runtimeId: 'pi',
    websiteUrl: 'https://openrouter.ai',
    apiKeyUrl: 'https://openrouter.ai/keys',
    category: 'community',
    backendId: 'openrouter',
    apiFormat: 'openai-completions',
    canonicalOrigin: 'https://openrouter.ai/api/v1',
    icon: 'openrouter',
    iconColor: '#8B5CF6',
  },

  {
    id: 'together',
    name: 'Together AI',
    description: 'Together AI 开源模型平台',
    runtimeId: 'pi',
    websiteUrl: 'https://www.together.ai',
    apiKeyUrl: 'https://api.together.xyz/settings/api-keys',
    category: 'community',
    backendId: 'together',
    apiFormat: 'openai-completions',
    canonicalOrigin: 'https://api.together.xyz/v1',
    icon: 'together',
    iconColor: '#10B981',
  },

  {
    id: 'groq',
    name: 'Groq',
    description: 'Groq 高速推理平台',
    runtimeId: 'pi',
    websiteUrl: 'https://groq.com',
    apiKeyUrl: 'https://console.groq.com/keys',
    category: 'community',
    backendId: 'groq',
    apiFormat: 'openai-completions',
    canonicalOrigin: 'https://api.groq.com/openai/v1',
    icon: 'groq',
    iconColor: '#F97316',
  },
];

/**
 * 根据分类获取 Pi 预设
 */
export function getPiPresetsByCategory(category: 'official' | 'partner' | 'community') {
  return PI_PROVIDER_PRESETS.filter((preset) => preset.category === category);
}

/**
 * 获取所有 Pi 预设的分组
 */
export function getPiPresetsGrouped() {
  return {
    official: getPiPresetsByCategory('official'),
    partner: getPiPresetsByCategory('partner'),
    community: getPiPresetsByCategory('community'),
  };
}

/**
 * 根据 ID 获取 Pi 预设
 */
export function getPiPresetById(id: string) {
  return PI_PROVIDER_PRESETS.find((preset) => preset.id === id);
}
