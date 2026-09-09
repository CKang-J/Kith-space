/**
 * 本机运行器配置的前端数据访问层。
 *
 * 对应服务端 src/server/routes-api/localRuntimeConfig.ts。
 * 这里的类型是服务端 LocalRuntimeConfig 的镜像，字段大量可选，因为四个运行器
 * 的配置文件能提供的信息深度不同（Claude 只有档位、Pi 有完整模型元数据）。
 *
 * 注意：这些接口只返回「凭据是否已配置」，永远拿不到密钥明文。
 */

type Api = (method: string, path: string, body?: unknown) => Promise<any>;

export type LocalConfigIssueKind =
  | "not_found"
  | "parse_error"
  | "permission_denied"
  | "unsupported_shape"
  /** 配置正常，只是当前没有可选模型，界面按提示而非警告展示。 */
  | "notice";

export interface LocalConfigIssue {
  kind: LocalConfigIssueKind;
  path: string;
  message: string;
}

export interface LocalModel {
  id: string;
  displayName?: string;
  /** Claude Code 特有的档位（haiku/sonnet/opus/fable）。 */
  tier?: string;
  /** 档位的中文标签，一个模型占多档时用「/」连接。 */
  tierLabel?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  inputCapabilities?: string[];
  reasoning?: boolean;
  thinkingLevels?: string[];
}

export type ClaudeTier = "haiku" | "sonnet" | "opus" | "fable";

export interface LocalProvider {
  id: string;
  runtimeId: string;
  displayName: string;
  apiFormat?: string;
  baseUrl?: string;
  credential: { configured: boolean; source?: string };
  models: LocalModel[];
  defaultModelId?: string;
  sourcePaths: string[];
  /**
   * Claude Code 特有的档位原值。models 会把指向同一模型的档位合并，
   * 编辑表单要按档位逐个回填，只能靠这份没去重的原值。
   */
  claude?: {
    tiers: Partial<Record<ClaudeTier, { modelId: string; displayName?: string }>>;
    maxContextTokens?: number;
    maxOutputTokens?: number;
    selectedModel?: string;
  };
}

export interface LocalRuntimeConfig {
  runtimeId: string;
  primaryPath: string;
  present: boolean;
  providers: LocalProvider[];
  issues: LocalConfigIssue[];
}

/** 运行器没有本机配置适配器时的结果，前端据此提示「请手动填写」而不是「未找到」。 */
export interface LocalRuntimeConfigUnsupported {
  supported: false;
  runtimeId: string;
  reason: string;
}

export type LoadLocalRuntimeConfigResult =
  | { supported: true; config: LocalRuntimeConfig }
  | LocalRuntimeConfigUnsupported;

export async function loadLocalRuntimeConfig(
  api: Api,
  runtimeId: string,
): Promise<LoadLocalRuntimeConfigResult> {
  const result = await api("GET", `/api/local-runtime-config?runtimeId=${encodeURIComponent(runtimeId)}`);
  if (result?.supported === false) {
    return { supported: false, runtimeId, reason: String(result.reason ?? "该运行器暂不支持读取本机配置") };
  }
  if (!result?.config) throw new Error("服务端没有返回本机配置");
  return { supported: true, config: result.config as LocalRuntimeConfig };
}

export async function loadAllLocalRuntimeConfigs(api: Api): Promise<LocalRuntimeConfig[]> {
  const result = await api("GET", "/api/local-runtime-config/all");
  return (result?.configs ?? []) as LocalRuntimeConfig[];
}

export interface AdoptLocalModelResult {
  configurationId: string;
  configurationRevision: number;
  providerConnectionId: string;
  displayName: string;
  reused: boolean;
  /** 凭据没能自动带入时的说明，需要提示用户补 API Key。 */
  credentialNotice?: string;
}

/**
 * 把本机配置里选中的模型转成真实的 Kith 模型配置。
 *
 * 必须走这个接口：Agent 绑定需要数据库里真实存在的 configurationId，
 * 前端自己拼 `${providerId}:${modelId}` 保存时会被服务端拒绝。
 */
export async function adoptLocalModel(api: Api, input: {
  runtimeId: string;
  providerId: string;
  modelId: string;
}): Promise<AdoptLocalModelResult> {
  const result = await api("POST", "/api/local-runtime-config/adopt", input);
  if (!result?.configurationId || !result?.configurationRevision) {
    throw new Error("采用本机模型失败：服务端没有返回模型配置");
  }
  return result as AdoptLocalModelResult;
}

// ---- 写回本机配置 ----
// 每个运行器的写入形状跟着它自己的磁盘格式走，不做统一抽象：
// Claude 是 settings.json 里 env 的补丁语义，Pi 是「供应商 + 模型清单」。

/** 字段缺省 = 不动该项，null = 从配置文件里删除，字符串 = 写入。 */
export interface ClaudeConfigPatch {
  baseUrl?: string | null;
  authToken?: string | null;
  tiers?: Partial<Record<ClaudeTier, { modelId?: string; displayName?: string }>>;
  maxContextTokens?: number | null;
  maxOutputTokens?: number | null;
  selectedModel?: string | null;
}

export interface LocalWriteResult {
  path: string;
  /** 本次实际改动的配置项，用来给用户回显「改了哪些」。 */
  changedKeys: string[];
}

export async function patchClaudeLocalConfig(api: Api, patch: ClaudeConfigPatch): Promise<LocalWriteResult> {
  const result = await api("PUT", "/api/local-runtime-config/claude", patch);
  return { path: String(result?.path ?? ""), changedKeys: (result?.changedKeys ?? []) as string[] };
}

export async function clearClaudeLocalTiers(api: Api): Promise<LocalWriteResult> {
  const result = await api("DELETE", "/api/local-runtime-config/claude/tiers");
  return { path: String(result?.path ?? ""), changedKeys: (result?.changedKeys ?? []) as string[] };
}

export interface PiProviderWriteInput {
  id: string;
  name?: string;
  baseUrl?: string;
  api?: string;
  /** 只在新建或用户主动改密钥时传；不传表示保留本机已有凭据。 */
  apiKey?: string;
  models?: Array<{
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    reasoning?: boolean;
  }>;
}

export async function writePiLocalProvider(api: Api, input: PiProviderWriteInput): Promise<string[]> {
  const result = await api("PUT", "/api/local-runtime-config/pi/providers", input);
  return (result?.paths ?? []) as string[];
}

export async function deletePiLocalProvider(api: Api, providerId: string): Promise<string[]> {
  const result = await api("DELETE", `/api/local-runtime-config/pi/providers/${encodeURIComponent(providerId)}`);
  return (result?.paths ?? []) as string[];
}

export async function setPiLocalDefaultModel(api: Api, providerId: string, modelId: string): Promise<string> {
  const result = await api("PUT", "/api/local-runtime-config/pi/default-model", { providerId, modelId });
  return String(result?.path ?? "");
}
