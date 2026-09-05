/**
 * 模型列表获取服务
 * 参考 cc-switch 的 model-fetch 实现
 */

import https from "https";
import http from "http";

export interface FetchedModel {
  id: string;
  owned_by?: string;
  created?: number;
}

interface ModelsResponse {
  data: FetchedModel[];
  object: string;
}

/**
 * 从供应商获取可用模型列表
 * 支持 OpenAI 兼容的 /v1/models 端点
 */
export async function fetchModelsFromProvider(
  baseUrl: string,
  apiKey: string,
  apiFormat: string = "openai-chat"
): Promise<FetchedModel[]> {
  // 生成候选 URL
  const candidates = generateModelUrlCandidates(baseUrl, apiFormat);

  let lastError: Error | null = null;

  // 按顺序尝试每个候选 URL
  for (const url of candidates) {
    try {
      const models = await tryFetchModels(url, apiKey, apiFormat);
      if (models.length > 0) {
        return models;
      }
    } catch (error) {
      lastError = error as Error;
      // 继续尝试下一个候选
    }
  }

  // 所有候选都失败
  throw new Error(
    lastError
      ? `All candidates failed: ${lastError.message}`
      : "Failed to fetch models from any endpoint"
  );
}

/**
 * 生成模型 URL 候选列表
 */
function generateModelUrlCandidates(baseUrl: string, apiFormat: string): string[] {
  const candidates: string[] = [];
  const base = baseUrl.replace(/\/$/, "");

  if (apiFormat === "anthropic-messages") {
    // Anthropic 格式通常在子路径
    candidates.push(`${base}/v1/models`);
    candidates.push(`${base}/models`);
    // 尝试去掉 /anthropic 后缀
    if (base.endsWith("/anthropic")) {
      const stripped = base.slice(0, -10);
      candidates.push(`${stripped}/v1/models`);
      candidates.push(`${stripped}/models`);
    }
  } else if (apiFormat === "openai-chat" || apiFormat === "openai-completions") {
    // OpenAI 兼容格式
    candidates.push(`${base}/v1/models`);
    candidates.push(`${base}/models`);
  } else if (apiFormat === "google-generative-ai") {
    // Gemini API
    candidates.push(`${base}/v1beta/models`);
    candidates.push(`${base}/v1/models`);
  } else {
    // 默认尝试标准端点
    candidates.push(`${base}/v1/models`);
    candidates.push(`${base}/models`);
  }

  return candidates;
}

/**
 * 尝试从指定 URL 获取模型列表
 */
function tryFetchModels(
  url: string,
  apiKey: string,
  apiFormat: string
): Promise<FetchedModel[]> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "https:" ? https : http;

    const headers: Record<string, string> = {
      "User-Agent": "Kith-space/1.0",
    };

    // 根据 API 格式设置认证头
    if (apiFormat === "anthropic-messages") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (apiFormat.startsWith("openai")) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    } else if (apiFormat === "google-generative-ai") {
      // Gemini 使用 query parameter
      parsedUrl.searchParams.set("key", apiKey);
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      headers,
      timeout: 10000, // 10 秒超时
    };

    const req = client.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data) as ModelsResponse;
            const models = parsed.data || [];
            resolve(models);
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error}`));
          }
        } else if (res.statusCode === 401 || res.statusCode === 403) {
          reject(new Error(`HTTP ${res.statusCode}: Authentication failed`));
        } else if (res.statusCode === 404 || res.statusCode === 405) {
          reject(new Error(`HTTP ${res.statusCode}: Endpoint not found`));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on("error", (error) => {
      reject(error);
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    req.end();
  });
}
