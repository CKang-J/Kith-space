/**
 * 读取本机 Codex（~/.codex/config.toml）配置，归一化成 LocalRuntimeConfig。
 *
 * Codex 用 TOML，项目没有引入 TOML 库，这里只实现一个覆盖所需子集的极简解析器：
 * 顶层键值、`[model_providers.<key>]` 表、注释、字符串/裸值、以及跨行数组/内联表的
 * 括号配对跳读。其余 section（mcp_servers、plugins、projects、[[skills.config]] 等）
 * 一律原样跳过，不尝试理解其内容。
 */

import { readTextFile } from "./fileIo.js";
import { codexAuthPath, codexConfigPath } from "./paths.js";
import type { LocalConfigIssue, LocalModel, LocalProvider, LocalRuntimeConfig } from "./types.js";

/** 单个 `[model_providers.<key>]` 表下我们关心的字段。 */
interface CodexProviderSection {
  name?: string;
  baseUrl?: string;
  wireApi?: string;
  envKey?: string;
}

interface ParsedCodexToml {
  /** 顶层标量键值，只保留字符串值（我们只用得到 model / model_provider）。 */
  topLevel: Map<string, string>;
  /** `model_providers.<key>` 表，key 为原始 provider id，按出现顺序保留。 */
  providers: Map<string, CodexProviderSection>;
}

export async function readCodexLocalConfig(): Promise<LocalRuntimeConfig> {
  const primaryPath = codexConfigPath();
  const read = await readTextFile(primaryPath);
  if (!read.ok) {
    return { runtimeId: "codex", primaryPath, present: false, providers: [], issues: [read.issue] };
  }

  const parsed = parseCodexToml(read.text);
  const providers = await buildProviders(parsed, primaryPath);
  const issues: LocalConfigIssue[] = [];
  return { runtimeId: "codex", primaryPath, present: true, providers, issues };
}

/** 把解析结果映射成 LocalProvider 列表，包含凭据判定和「当前生效」模型归属。 */
async function buildProviders(parsed: ParsedCodexToml, primaryPath: string): Promise<LocalProvider[]> {
  const defaultModelId = parsed.topLevel.get("model");
  const selectedProviderId = parsed.topLevel.get("model_provider");

  // 顶层 openai_base_url 会改写默认端点，没有 model_providers 段时它就是实际生效的地址。
  const topLevelBaseUrl = parsed.topLevel.get("openai_base_url");

  if (parsed.providers.size === 0) {
    if (!defaultModelId && !topLevelBaseUrl) return [];
    return [
      {
        id: "codex-default",
        runtimeId: "codex",
        displayName: describeDefaultProvider(topLevelBaseUrl),
        baseUrl: topLevelBaseUrl,
        credential: await resolveDefaultCredential(),
        models: defaultModelId ? [{ id: defaultModelId }] : [],
        defaultModelId,
        sourcePaths: [primaryPath],
      },
    ];
  }

  // 「当前生效的 provider」：顶层 model_provider 指定的那个；若没指定且只有一个 provider，
  // 那唯一的一个自然就是当前生效的。多个 provider 又没有 model_provider 时无法判断，模型信息留空。
  let activeProviderId: string | undefined;
  if (selectedProviderId && parsed.providers.has(selectedProviderId)) {
    activeProviderId = selectedProviderId;
  } else if (parsed.providers.size === 1) {
    activeProviderId = [...parsed.providers.keys()][0];
  }

  const result: LocalProvider[] = [];
  for (const [providerId, section] of parsed.providers) {
    const isActive = providerId === activeProviderId;
    const models: LocalModel[] = isActive && defaultModelId ? [{ id: defaultModelId }] : [];
    result.push({
      id: providerId,
      runtimeId: "codex",
      displayName: section.name ?? providerId,
      apiFormat: inferApiFormat(section.wireApi),
      baseUrl: section.baseUrl,
      credential: await resolveProviderCredential(section.envKey),
      models,
      defaultModelId: isActive ? defaultModelId : undefined,
      sourcePaths: [primaryPath],
    });
  }
  return result;
}

/**
 * 没有 model_providers 段时的显示名。配置了 openai_base_url 就说明走的是自定义端点，
 * 此时不能标成「官方」，否则会误导用户以为请求发去了 OpenAI。
 */
function describeDefaultProvider(baseUrl: string | undefined): string {
  if (!baseUrl) return "Codex 默认（官方端点）";
  try {
    return `Codex 默认端点（${new URL(baseUrl).host}）`;
  } catch {
    return `Codex 默认端点（${baseUrl}）`;
  }
}

function inferApiFormat(wireApi: string | undefined): string | undefined {
  if (wireApi === "chat") return "openai-chat";
  return "openai-responses";
}

/** 有 env_key 时判断环境变量是否存在；否则回落到判断 ~/.codex/auth.json 是否存在。 */
async function resolveProviderCredential(envKey: string | undefined): Promise<LocalProvider["credential"]> {
  if (envKey) {
    const value = process.env[envKey];
    return { configured: typeof value === "string" && value.trim() !== "", source: `环境变量 ${envKey}` };
  }
  return resolveDefaultCredential();
}

/** 没有 env_key（或没有任何 provider 段）时，凭据来源统一看 auth.json 是否存在。 */
async function resolveDefaultCredential(): Promise<LocalProvider["credential"]> {
  const authRead = await readTextFile(codexAuthPath());
  return { configured: authRead.ok, source: "auth.json" };
}

// ---------------------------------------------------------------------------
// 极简 TOML 解析器（仅覆盖 Codex config.toml 用到的子集）
// ---------------------------------------------------------------------------

function parseCodexToml(text: string): ParsedCodexToml {
  const topLevel = new Map<string, string>();
  const providers = new Map<string, CodexProviderSection>();

  // "" 表示当前处于顶层；否则记录当前 model_providers 的 key（未在关心范围内的 section 用 undefined 表示）。
  let currentProviderKey: string | undefined;
  let atTopLevel = true;

  for (const logicalLine of splitLogicalLines(text)) {
    const trimmed = logicalLine.trim();
    if (trimmed === "") continue;

    if (trimmed.startsWith("[")) {
      const header = parseSectionHeader(trimmed);
      if (header === undefined) continue; // 无法识别的表头格式，直接跳过，不报错
      atTopLevel = false;
      currentProviderKey = header.length === 2 && header[0] === "model_providers" ? header[1] : undefined;
      continue;
    }

    const kv = splitKeyValue(trimmed);
    if (!kv) continue;

    if (atTopLevel) {
      const value = parseTomlString(kv.valueRaw);
      if (value !== undefined) topLevel.set(kv.key, value);
      continue;
    }

    if (currentProviderKey === undefined) continue; // 处于不关心的 section，跳过其所有键值

    const section = providers.get(currentProviderKey) ?? {};
    const value = parseTomlString(kv.valueRaw);
    if (value !== undefined) {
      if (kv.key === "name") section.name = value;
      else if (kv.key === "base_url") section.baseUrl = value;
      else if (kv.key === "wire_api") section.wireApi = value;
      else if (kv.key === "env_key") section.envKey = value;
      // query_params 等其他字段：无论是字符串还是内联表/数组，我们都不需要，直接忽略。
    }
    providers.set(currentProviderKey, section);
  }

  return { topLevel, providers };
}

/**
 * 把原始文本按「逻辑行」切分：普通行照旧，跨多行的数组 `[...]` 或内联表 `{...}`
 * 会被合并成一行，避免把数组元素误判成新的键值或表头。逐行先去掉注释再判断括号配平，
 * 括号计数时忽略引号内的字符，防止字符串里出现的 `[`/`]`/`{`/`}` 干扰计数。
 */
function splitLogicalLines(text: string): string[] {
  const logicalLines: string[] = [];
  let buffer: string[] = [];
  let depth = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const stripped = stripComment(rawLine);
    if (buffer.length === 0 && stripped.trim() === "") continue;
    buffer.push(stripped);
    depth += computeBracketDelta(stripped);
    if (depth <= 0) {
      logicalLines.push(buffer.join("\n"));
      buffer = [];
      depth = 0;
    }
  }
  if (buffer.length > 0) logicalLines.push(buffer.join("\n"));
  return logicalLines;
}

/** 去掉行尾注释（`#` 开始），但忽略引号内的 `#`；不处理转义之外的复杂情形。 */
function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inDouble) {
      if (ch === "\\") i += 1; // 跳过被转义的下一个字符
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (ch === '"') inDouble = true;
    else if (ch === "'") inSingle = true;
    else if (ch === "#") return line.slice(0, i);
  }
  return line;
}

/** 统计一行里未被引号包住的 `[`/`{` 与 `]`/`}` 的净增减，用于判断多行数组/内联表是否已闭合。 */
function computeBracketDelta(line: string): number {
  let inSingle = false;
  let inDouble = false;
  let delta = 0;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inDouble) {
      if (ch === "\\") i += 1;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (ch === '"') inDouble = true;
    else if (ch === "'") inSingle = true;
    else if (ch === "[" || ch === "{") delta += 1;
    else if (ch === "]" || ch === "}") delta -= 1;
  }
  return delta;
}

/**
 * 解析形如 `[model_providers.foo]` / `[[skills.config]]` / `[plugins."a@b"]` 的表头，
 * 返回按 `.` 拆分（尊重引号）的 key 路径；解析失败（不是合法表头）时返回 undefined。
 */
function parseSectionHeader(trimmedLine: string): string[] | undefined {
  const isArrayTable = trimmedLine.startsWith("[[") && trimmedLine.endsWith("]]");
  const isTable = !isArrayTable && trimmedLine.startsWith("[") && trimmedLine.endsWith("]");
  if (!isArrayTable && !isTable) return undefined;

  const inner = isArrayTable ? trimmedLine.slice(2, -2) : trimmedLine.slice(1, -1);
  return splitDottedPath(inner);
}

/** 按 `.` 拆分路径，遇到引号（单/双）时把引号内内容整体当作一段，不再按 `.` 继续拆。 */
function splitDottedPath(input: string): string[] {
  const segments: string[] = [];
  let current = "";
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let content = "";
      while (j < input.length && input[j] !== quote) {
        content += input[j];
        j += 1;
      }
      current += content;
      i = j + 1;
      continue;
    }
    if (ch === ".") {
      segments.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  segments.push(current.trim());
  return segments.filter((segment) => segment !== "");
}

/** 把一行 `key = value` 拆成 key 和原始 value 文本，`=` 出现在引号内时不作为分隔符。 */
function splitKeyValue(line: string): { key: string; valueRaw: string } | undefined {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inDouble) {
      if (ch === "\\") i += 1;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (ch === '"') inDouble = true;
    else if (ch === "'") inSingle = true;
    else if (ch === "=") {
      const key = line.slice(0, i).trim().replace(/^["']|["']$/g, "");
      const valueRaw = line.slice(i + 1).trim();
      if (key === "") return undefined;
      return { key, valueRaw };
    }
  }
  return undefined;
}

/**
 * 只解析我们真正需要的标量字符串值（双引号/单引号字符串）。
 * 数组、内联表、裸数字/布尔等不是我们要的字段类型，统一返回 undefined 而不是抛错。
 */
function parseTomlString(raw: string): string | undefined {
  if (raw.length < 2) return undefined;
  const quote = raw[0];
  if (quote !== '"' && quote !== "'") return undefined;
  if (raw[raw.length - 1] !== quote) return undefined;
  const body = raw.slice(1, -1);
  if (quote === "'") return body; // TOML 字面字符串不转义

  // 双引号基本字符串：处理常见转义，未知转义序列去掉反斜杠原样保留。
  let result = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "\\" && i + 1 < body.length) {
      const next = body[i + 1];
      if (next === "n") result += "\n";
      else if (next === "t") result += "\t";
      else if (next === "r") result += "\r";
      else if (next === '"' || next === "\\") result += next;
      else result += next;
      i += 1;
      continue;
    }
    result += ch;
  }
  return result;
}
