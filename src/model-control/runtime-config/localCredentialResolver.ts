/**
 * 从本机运行器配置里取出凭据明文 —— **仅供服务端「采纳本机配置」流程使用**。
 *
 * 安全边界（务必保持）：
 * - 本模块的返回值绝不能出现在任何 HTTP 响应、日志、错误消息里；
 *   调用方拿到明文后只能立即交给 providerCredentialPort 落成 Kith secret。
 * - 适配器（claudeAdapter / piAdapter / ...）只回报「凭据是否已配置」，
 *   明文读取集中在这里一处，便于审计。
 * - 拒绝 `!command` 形式（会执行外部命令）与复合 `${VAR}` 插值，
 *   与 piConfigModelImportService 的既有边界一致。
 * - 环境变量引用只接受单一变量名，且拒绝 PATH / HOME 等危险变量。
 */

import { asRecord, asString, readJsonFile, readTextFile } from "./fileIo.js";
import {
  claudeSettingsPath,
  codexAuthPath,
  codexConfigPath,
  openCodeConfigPath,
  piAuthPath,
  piModelsPath,
} from "./paths.js";
import type { RuntimeId } from "../runtimeTypes.js";

/** 单一环境变量引用：`$VAR` 或 `${VAR}`。 */
const ENV_REF = /^\$(?:\{([A-Z_][A-Z0-9_]*)\}|([A-Z_][A-Z0-9_]*))$/;

/** 不允许当作凭据来源的环境变量，避免把进程环境里的敏感/关键变量搬进配置。 */
const DANGEROUS_ENV =
  /^(?:NODE_OPTIONS|PATH|HOME|USERPROFILE|XDG_.*|SHELL|BASH_ENV|ENV|NPM_.*|PNPM_.*|ELECTRON_.*|KITH_.*|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$/;

const MAX_CREDENTIAL_BYTES = 64 * 1024;

/**
 * 解析出的凭据。
 * - `kind: "secret"` 带明文，调用方必须立刻存进凭据端口，不得外传。
 * - `kind: "keyless"` 表示确实没有凭据（本地无密钥端点），附带原因供界面提示。
 */
export type ResolvedLocalCredential =
  | { kind: "secret"; value: string; source: string }
  | { kind: "keyless"; reason: string };

function keyless(reason: string): ResolvedLocalCredential {
  return { kind: "keyless", reason };
}

/**
 * 把配置里的一个字符串字段解释成凭据。
 * 字面量直接采用；单一环境变量引用去进程环境取值；其余形式一律拒绝。
 */
function interpretCredentialValue(raw: unknown, pointer: string): ResolvedLocalCredential {
  if (typeof raw !== "string" || raw === "") return keyless(`${pointer} 未配置凭据`);
  if (raw.length > MAX_CREDENTIAL_BYTES) return keyless(`${pointer} 的凭据超长，已拒绝读取`);
  if (raw.startsWith("!")) return keyless(`${pointer} 使用命令式凭据（!command），请手动填写 API Key`);

  const envMatch = ENV_REF.exec(raw);
  if (envMatch) {
    const name = envMatch[1] ?? envMatch[2]!;
    if (DANGEROUS_ENV.test(name)) return keyless(`拒绝从环境变量 ${name} 读取凭据，请手动填写 API Key`);
    const value = process.env[name];
    if (!value) return keyless(`环境变量 ${name} 当前为空，请手动填写 API Key`);
    return { kind: "secret", value, source: `环境变量 ${name}` };
  }

  if (raw.includes("$")) return keyless(`${pointer} 使用了复合环境变量插值，请手动填写 API Key`);
  return { kind: "secret", value: raw, source: pointer };
}

/**
 * 读取指定运行器、指定供应商的凭据明文。
 * providerId 的含义与对应适配器返回的 LocalProvider.id 一致。
 */
export async function resolveLocalCredential(
  runtimeId: RuntimeId,
  providerId: string,
): Promise<ResolvedLocalCredential> {
  switch (runtimeId) {
    case "claude":
      return resolveClaudeCredential();
    case "pi":
      return resolvePiCredential(providerId);
    case "codex":
      return resolveCodexCredential(providerId);
    case "opencode":
      return resolveOpenCodeCredential(providerId);
  }
}

/** Claude Code：settings.json 的 env 里 ANTHROPIC_AUTH_TOKEN 优先于 ANTHROPIC_API_KEY。 */
async function resolveClaudeCredential(): Promise<ResolvedLocalCredential> {
  const target = claudeSettingsPath();
  const read = await readJsonFile(target);
  // 记录「字段确实写了值，但被判定不可采纳」的具体原因（命令式凭据、危险环境变量等），
  // 避免下面继续检查其它候选来源时，把这条有用的拒绝理由丢掉换成笼统的「没找到」。
  let rejection: ResolvedLocalCredential | undefined;
  if (read.ok) {
    const env = asRecord(asRecord(read.value)["env"]);
    for (const key of ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"] as const) {
      const resolved = interpretCredentialValue(env[key], `settings.json 的 ${key}`);
      if (resolved.kind === "secret") return resolved;
      if (!rejection && asString(env[key]) !== undefined) rejection = resolved;
    }
  }
  // settings.json 没写，则看进程环境（用户可能在 shell profile 里导出）。
  for (const key of ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"] as const) {
    const value = process.env[key];
    if (value) return { kind: "secret", value, source: `环境变量 ${key}` };
  }
  return rejection ?? keyless("Claude Code 配置里没有找到 API Key，请手动填写");
}

/** Pi Agent：auth.json 的 api_key 优先，其次 models.json 里该供应商的内联 apiKey。 */
async function resolvePiCredential(providerId: string): Promise<ResolvedLocalCredential> {
  // 同 Claude：记录「字段确实写了值，但被判定不可采纳」的具体原因，不被后续来源的
  // 笼统「没找到」覆盖掉。
  let rejection: ResolvedLocalCredential | undefined;

  const authRead = await readJsonFile(piAuthPath());
  if (authRead.ok) {
    const entry = asRecord(asRecord(authRead.value)[providerId]);
    // oauth 凭据是带过期时间的短期令牌，搬进 Kith 会很快失效，不采纳。
    if (entry["type"] === "oauth") {
      return keyless(`供应商 ${providerId} 在 Pi 里使用 OAuth 登录，无法作为 API Key 采纳，请手动填写`);
    }
    const resolved = interpretCredentialValue(entry["key"], `auth.json 的 ${providerId}`);
    if (resolved.kind === "secret") return resolved;
    if (asString(entry["key"]) !== undefined) rejection = resolved;
  }

  const modelsRead = await readJsonFile(piModelsPath());
  if (modelsRead.ok) {
    const providers = asRecord(modelsRead.value)["providers"];
    const list = Array.isArray(providers) ? providers : [];
    const match = list.map(asRecord).find((item) => asString(item["id"]) === providerId);
    if (match) {
      const rawValue = match["apiKey"] ?? match["api_key"] ?? match["token"];
      const resolved = interpretCredentialValue(rawValue, `models.json 的 ${providerId}.apiKey`);
      if (resolved.kind === "secret") return resolved;
      if (!rejection && asString(rawValue) !== undefined) rejection = resolved;
    }
  }

  return rejection ?? keyless(`Pi 配置里没有找到供应商 ${providerId} 的 API Key，请手动填写`);
}

/**
 * Codex：`[model_providers.<id>]` 的 env_key 指向的环境变量。
 * auth.json 存的是 Codex 自己的 OAuth 会话，不是可复用的 API Key，因此不采纳。
 */
async function resolveCodexCredential(providerId: string): Promise<ResolvedLocalCredential> {
  const read = await readTextFile(codexConfigPath());
  if (read.ok) {
    const envKey = findCodexEnvKey(read.text, providerId);
    if (envKey) {
      if (DANGEROUS_ENV.test(envKey)) {
        return keyless(`拒绝从环境变量 ${envKey} 读取凭据，请手动填写 API Key`);
      }
      const value = process.env[envKey];
      if (value) return { kind: "secret", value, source: `环境变量 ${envKey}` };
      return keyless(`环境变量 ${envKey} 当前为空，请手动填写 API Key`);
    }
  }
  const authExists = await readTextFile(codexAuthPath());
  if (authExists.ok) {
    return keyless("Codex 使用自身的登录会话（auth.json），无法作为 API Key 采纳，请手动填写");
  }
  return keyless("Codex 配置里没有找到可用的 API Key，请手动填写");
}

/**
 * 在 config.toml 里定位 `[model_providers.<providerId>]` 段并取出它的 env_key。
 * 只做定位，不复用完整解析器：这里需要的信息只有一行。
 */
function findCodexEnvKey(text: string, providerId: string): string | undefined {
  const lines = text.split(/\r?\n/);
  let inTarget = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      const header = trimmed.replace(/^\[+|\]+$/g, "");
      const quoted = header.replace(/"/g, "");
      inTarget = quoted === `model_providers.${providerId}`;
      continue;
    }
    if (!inTarget) continue;
    const match = /^env_key\s*=\s*["']([^"']+)["']/.exec(trimmed);
    if (match) return match[1];
  }
  return undefined;
}

/** OpenCode：provider.<id>.options.apiKey。 */
async function resolveOpenCodeCredential(providerId: string): Promise<ResolvedLocalCredential> {
  const read = await readJsonFile(openCodeConfigPath());
  if (!read.ok) return keyless("没有读到 OpenCode 配置，请手动填写 API Key");
  const provider = asRecord(asRecord(asRecord(read.value)["provider"])[providerId]);
  const options = asRecord(provider["options"]);
  const resolved = interpretCredentialValue(
    options["apiKey"],
    `opencode.json 的 provider.${providerId}.options.apiKey`,
  );
  if (resolved.kind === "secret") return resolved;
  return resolved;
}
