/**
 * 本机运行器配置的统一读取契约。
 *
 * 每个运行器的配置文件格式完全不同（Claude Code 用 settings.json 的 env 块、
 * Codex 用 TOML、Pi 用多个 JSON、OpenCode 用 provider 字典），这里定义读取后
 * 归一化到的形状，供 API 与前端消费。
 *
 * 重要：这些结构描述的是「用户电脑上已经存在的配置」，不是 Kith 自己发明的存储格式。
 */

import type { RuntimeId } from "../runtimeTypes.js";

/** 读取失败的原因，用于前端给出可操作的提示而不是笼统的「未找到」。 */
export type LocalConfigIssueKind =
  | "not_found"
  | "parse_error"
  | "permission_denied"
  | "unsupported_shape"
  /**
   * 配置本身是好的，只是没有可供选择的模型（用官方默认模型、模型清单还没缓存等）。
   * 与上面四种区分开：那四种是读不出来，这一种是读出来了但没东西可选，界面不该报警告。
   */
  | "notice";

export interface LocalConfigIssue {
  kind: LocalConfigIssueKind;
  /** 出问题的文件绝对路径。 */
  path: string;
  /** 面向用户的中文说明。 */
  message: string;
}

/** 从本机配置读出的单个模型。字段全部可选，因为不同运行器能提供的信息深度不同。 */
export interface LocalModel {
  /** 请求时真正发给服务端的模型 id。 */
  id: string;
  /** 界面展示名，缺省时前端回落到 id。 */
  displayName?: string;
  /**
   * Claude Code 特有：该模型占用的档位（haiku/sonnet/opus/fable）。
   * 其他运行器为 undefined。
   */
  tier?: string;
  /**
   * 档位的中文标签，一个模型被多档复用时用「/」连接，例如「Sonnet（均衡） / Opus（强力）」。
   */
  tierLabel?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  /** 输入模态，如 ["text", "image"]。 */
  inputCapabilities?: string[];
  /** 是否为推理模型。 */
  reasoning?: boolean;
  /** 该模型支持的 thinking 档位（Pi Agent 的 thinkingLevelMap 的键）。 */
  thinkingLevels?: string[];
}

/**
 * 从本机配置读出的一个「供应商」。
 *
 * 对 Claude Code 而言，一份 settings.json 只描述一个生效的供应商（由 ANTHROPIC_BASE_URL
 * 决定），所以 providers 长度为 0 或 1；Pi / OpenCode / Codex 可以有多个。
 */
export interface LocalProvider {
  /** 在该运行器内稳定唯一的标识（Pi 用 provider key，Claude 用 "claude-local"）。 */
  id: string;
  runtimeId: RuntimeId;
  displayName: string;
  /** API 协议格式，值域与 runtimeTypes.ApiFormat 对齐，未知时为 undefined。 */
  apiFormat?: string;
  /** 服务端地址，读不到时为 undefined（例如使用官方默认端点）。 */
  baseUrl?: string;
  /**
   * 凭据状态。**绝不返回密钥明文**，只说明凭据从哪来、是否已配置。
   */
  credential: {
    configured: boolean;
    /** 凭据来源：环境变量名、auth.json、配置文件内联字段等。 */
    source?: string;
  };
  models: LocalModel[];
  /** 该运行器当前默认使用的模型 id（若配置里有声明）。 */
  defaultModelId?: string;
  /** 这份供应商信息来自哪些文件，用于界面显示「读自 xxx」。 */
  sourcePaths: string[];
  /**
   * Claude Code 特有的档位原值，供编辑表单精确回填。
   *
   * models 会把指向同一模型 id 的多个档位合并成一条，回填时无法还原每档各自的展示名，
   * 且档位全空时连上下文上限也没有载体，所以这里按 env 的原始形状再带一份。
   */
  claude?: {
    tiers: Partial<Record<ClaudeTierKey, { modelId: string; displayName?: string }>>;
    maxContextTokens?: number;
    maxOutputTokens?: number;
    /** settings.json 顶层 model 的原值（档位名或完整模型 id）。 */
    selectedModel?: string;
  };
}

export type ClaudeTierKey = "haiku" | "sonnet" | "opus" | "fable";

/** 单个运行器的本机配置读取结果。 */
export interface LocalRuntimeConfig {
  runtimeId: RuntimeId;
  /** 该运行器的主配置文件路径（无论是否存在）。 */
  primaryPath: string;
  /** 主配置文件是否存在且可读。 */
  present: boolean;
  providers: LocalProvider[];
  /** 非致命问题：某个文件缺失或解析失败，但其他文件仍读出了内容。 */
  issues: LocalConfigIssue[];
}
