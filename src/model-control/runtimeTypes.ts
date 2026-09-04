/**
 * 模型设置的核心类型定义
 * 支持多个运行器（Claude Code、Codex、Pi、OpenCode）的独立配置
 */

/**
 * 运行器 ID 类型
 */
export type RuntimeId = 'claude' | 'codex' | 'pi' | 'opencode';

/**
 * API 格式类型
 */
export type ApiFormat =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'openai-chat'
  | 'bedrock-converse-stream';

/**
 * 供应商分类
 */
export type ProviderCategory = 'official' | 'partner' | 'community' | 'custom';

/**
 * 运行器配置
 */
export interface RuntimeConfig {
  id: RuntimeId;
  name: string;
  displayName: string;
  description: string;
  configPath: string;  // 配置文件路径（相对于用户目录）
  apiFormats: ApiFormat[];  // 支持的 API 格式
  icon?: string;
  enabled: boolean;
}

/**
 * 模型预设
 */
export interface ModelPreset {
  id: string;
  displayName: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  inputCapabilities?: string[];
  thinkingLevels?: readonly string[];
  options?: Record<string, unknown>;
}

/**
 * 供应商预设
 */
export interface ProviderPreset {
  id: string;
  name: string;
  nameKey?: string;  // i18n key
  description?: string;
  runtimeId: RuntimeId;  // 所属运行器
  websiteUrl: string;
  apiKeyUrl?: string;
  category: ProviderCategory;
  isOfficial?: boolean;
  isPartner?: boolean;
  primePartner?: boolean;  // 推荐标记

  // API 配置
  backendId: string;
  apiFormat: ApiFormat;
  canonicalOrigin: string;

  // 预设模型列表
  models?: ModelPreset[];

  // 图标和主题
  icon?: string;
  iconColor?: string;

  // 端点候选列表（用于测速/容灾）
  endpointCandidates?: string[];

  // 运行器特定配置
  runtimeSpecific?: Record<string, unknown>;
}

/**
 * 运行器的供应商配置
 */
export interface RuntimeProviderConfig {
  id: string;
  runtimeId: RuntimeId;
  displayName: string;
  backendId: string;
  apiFormat: ApiFormat;
  canonicalOrigin: string;
  apiKey?: string;
  models: ModelPreset[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 所有运行器配置
 */
export const RUNTIME_CONFIGS: Record<RuntimeId, RuntimeConfig> = {
  claude: {
    id: 'claude',
    name: 'claude',
    displayName: 'Claude Code',
    description: 'Anthropic Claude 官方编程工具',
    configPath: '~/.claude/config.toml',
    apiFormats: ['anthropic-messages', 'openai-chat', 'openai-responses'],
    icon: 'claude',
    enabled: true,
  },
  codex: {
    id: 'codex',
    name: 'codex',
    displayName: 'Codex',
    description: 'OpenAI Codex 编程工具',
    configPath: '~/.codex/config.toml',
    apiFormats: ['openai-responses', 'openai-completions', 'openai-chat'],
    icon: 'codex',
    enabled: true,
  },
  pi: {
    id: 'pi',
    name: 'pi',
    displayName: 'Pi Agent',
    description: 'Pi AI 编程助手',
    configPath: '~/.pi/agent/models.json',
    apiFormats: [
      'openai-completions',
      'openai-responses',
      'anthropic-messages',
      'google-generative-ai',
    ],
    icon: 'pi',
    enabled: true,
  },
  opencode: {
    id: 'opencode',
    name: 'opencode',
    displayName: 'OpenCode',
    description: 'AI SDK 驱动的编程工具',
    configPath: '~/.opencode/opencode.json',
    apiFormats: ['openai-completions', 'openai-responses', 'anthropic-messages'],
    icon: 'opencode',
    enabled: true,
  },
};

/**
 * 获取运行器配置
 */
export function getRuntimeConfig(runtimeId: RuntimeId): RuntimeConfig {
  return RUNTIME_CONFIGS[runtimeId];
}

/**
 * 获取所有启用的运行器
 */
export function getEnabledRuntimes(): RuntimeConfig[] {
  return Object.values(RUNTIME_CONFIGS).filter((config) => config.enabled);
}

/**
 * 检查运行器是否支持指定的 API 格式
 */
export function runtimeSupportsApiFormat(
  runtimeId: RuntimeId,
  apiFormat: ApiFormat,
): boolean {
  return RUNTIME_CONFIGS[runtimeId].apiFormats.includes(apiFormat);
}
