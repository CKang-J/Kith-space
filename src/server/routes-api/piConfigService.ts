/**
 * Pi Agent 配置服务
 * 读写 ~/.pi/agent/models.json
 */

import fs from "fs/promises";
import path from "path";
import os from "os";

const PI_CONFIG_DIR = path.join(os.homedir(), ".pi", "agent");
const PI_MODELS_FILE = path.join(PI_CONFIG_DIR, "models.json");

export interface PiModelConfig {
  providers: PiProvider[];
}

export interface PiProvider {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  models: PiModel[];
  apiFormat: string;
  enabled?: boolean;
}

export interface PiModel {
  id: string;
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilities?: string[];
}

/**
 * 确保配置目录存在
 */
async function ensureConfigDir(): Promise<void> {
  try {
    await fs.mkdir(PI_CONFIG_DIR, { recursive: true });
  } catch (error) {
    console.error("Failed to create Pi config directory:", error);
    throw error;
  }
}

/**
 * 读取 Pi models.json 配置
 */
export async function readPiConfig(): Promise<PiModelConfig> {
  try {
    const content = await fs.readFile(PI_MODELS_FILE, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    // 文件不存在时返回空配置
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { providers: [] };
    }
    console.error("Failed to read Pi config:", error);
    throw error;
  }
}

/**
 * 写入 Pi models.json 配置
 */
export async function writePiConfig(config: PiModelConfig): Promise<void> {
  try {
    await ensureConfigDir();
    await fs.writeFile(
      PI_MODELS_FILE,
      JSON.stringify(config, null, 2),
      "utf-8"
    );
  } catch (error) {
    console.error("Failed to write Pi config:", error);
    throw error;
  }
}

/**
 * 添加或更新供应商配置
 */
export async function upsertPiProvider(provider: PiProvider): Promise<void> {
  const config = await readPiConfig();

  const existingIndex = config.providers.findIndex((p) => p.id === provider.id);

  if (existingIndex >= 0) {
    // 更新现有供应商
    config.providers[existingIndex] = provider;
  } else {
    // 添加新供应商
    config.providers.push(provider);
  }

  await writePiConfig(config);
}

/**
 * 删除供应商配置
 */
export async function deletePiProvider(providerId: string): Promise<void> {
  const config = await readPiConfig();
  config.providers = config.providers.filter((p) => p.id !== providerId);
  await writePiConfig(config);
}

/**
 * 获取单个供应商配置
 */
export async function getPiProvider(providerId: string): Promise<PiProvider | null> {
  const config = await readPiConfig();
  return config.providers.find((p) => p.id === providerId) || null;
}

/**
 * 测试供应商连接
 */
export async function testPiProviderConnection(
  apiKey: string,
  baseUrl: string,
  apiFormat: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // 根据不同的 API 格式进行测试
    if (apiFormat === "anthropic-messages") {
      // Anthropic API 测试
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 1,
          messages: [{ role: "user", content: "test" }],
        }),
      });

      if (response.status === 401) {
        return { success: false, error: "API Key 无效" };
      }

      if (!response.ok && response.status !== 400) {
        const errorText = await response.text();
        return { success: false, error: errorText };
      }

      return { success: true };
    } else if (apiFormat === "openai-chat" || apiFormat === "openai-completions") {
      // OpenAI 兼容 API 测试
      const endpoint = apiFormat === "openai-chat" ? "/v1/chat/completions" : "/v1/completions";
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(
          apiFormat === "openai-chat"
            ? {
                model: "gpt-3.5-turbo",
                messages: [{ role: "user", content: "test" }],
                max_tokens: 1,
              }
            : {
                model: "gpt-3.5-turbo-instruct",
                prompt: "test",
                max_tokens: 1,
              }
        ),
      });

      if (response.status === 401) {
        return { success: false, error: "API Key 无效" };
      }

      if (!response.ok && response.status !== 400) {
        const errorText = await response.text();
        return { success: false, error: errorText };
      }

      return { success: true };
    } else {
      // 其他格式暂不支持测试
      return { success: true };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "连接失败",
    };
  }
}
