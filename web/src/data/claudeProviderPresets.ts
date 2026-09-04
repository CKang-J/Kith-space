/**
 * Claude Code 供应商预设数据
 */

import type { ProviderPreset } from "../types/runtimeTypes";

export const CLAUDE_PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude 系列模型官方 API",
    runtimeId: "claude",
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
        id: "claude-opus-4-8",
        displayName: "Claude Opus 4.8",
        contextWindow: 200000,
        maxOutputTokens: 16384,
        inputCapabilities: ["文本", "图像", "PDF"],
        thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
      },
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
    ],
  },
  {
    id: "aws-bedrock",
    name: "AWS Bedrock",
    description: "通过 AWS Bedrock 访问 Claude",
    runtimeId: "claude",
    websiteUrl: "https://aws.amazon.com/bedrock/",
    apiKeyUrl: "https://console.aws.amazon.com/iam/",
    category: "partner",
    isPartner: true,
    backendId: "aws-bedrock",
    apiFormat: "bedrock-converse-stream",
    canonicalOrigin: "https://bedrock-runtime.us-east-1.amazonaws.com",
    iconColor: "#FF9900",
    models: [
      {
        id: "anthropic.claude-3-5-sonnet-20241022-v2:0",
        displayName: "Claude 3.5 Sonnet v2",
        contextWindow: 200000,
        maxOutputTokens: 8192,
        inputCapabilities: ["文本", "图像"],
      },
      {
        id: "anthropic.claude-3-opus-20240229-v1:0",
        displayName: "Claude 3 Opus",
        contextWindow: 200000,
        maxOutputTokens: 4096,
        inputCapabilities: ["文本", "图像"],
      },
    ],
  },
  {
    id: "vertex-ai",
    name: "Google Vertex AI",
    description: "通过 Google Cloud 访问 Claude",
    runtimeId: "claude",
    websiteUrl: "https://cloud.google.com/vertex-ai",
    apiKeyUrl: "https://console.cloud.google.com/apis/credentials",
    category: "partner",
    isPartner: true,
    backendId: "vertex-ai",
    apiFormat: "anthropic-messages",
    canonicalOrigin: "https://us-east5-aiplatform.googleapis.com",
    iconColor: "#4285F4",
    models: [],
  },
];

export function getClaudePresetById(id: string) {
  return CLAUDE_PROVIDER_PRESETS.find((preset) => preset.id === id);
}
