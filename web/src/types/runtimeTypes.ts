/**
 * 前端类型定义（与后端保持同步）
 */

export type RuntimeId = 'claude' | 'codex' | 'pi' | 'opencode';

export type ApiFormat =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'openai-chat'
  | 'bedrock-converse-stream';

export type ProviderCategory = 'official' | 'partner' | 'community' | 'custom';

export interface RuntimeConfig {
  id: RuntimeId;
  name: string;
  displayName: string;
  description: string;
  configPath: string;
  apiFormats: ApiFormat[];
  icon?: string;
  enabled: boolean;
}

export interface ModelPreset {
  id: string;
  displayName: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  inputCapabilities?: string[];
  thinkingLevels?: readonly string[];
  options?: Record<string, unknown>;
}

export interface ProviderPreset {
  id: string;
  name: string;
  nameKey?: string;
  description?: string;
  runtimeId: RuntimeId;
  websiteUrl: string;
  apiKeyUrl?: string;
  category: ProviderCategory;
  isOfficial?: boolean;
  isPartner?: boolean;
  primePartner?: boolean;

  backendId: string;
  apiFormat: ApiFormat;
  canonicalOrigin: string;

  models?: ModelPreset[];

  icon?: string;
  iconColor?: string;

  endpointCandidates?: string[];
  runtimeSpecific?: Record<string, unknown>;
}
