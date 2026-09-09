/**
 * 本机运行器配置的展示层。
 *
 * 只负责「把读到的东西如实显示出来」：读自哪个文件、有哪些供应商、每个供应商有哪些模型、
 * 凭据在不在、哪个文件没读成功。写操作由各运行器面板通过 actions / providerActions 插槽注入，
 * 因为四个运行器的可写程度完全不同（Claude 改 env、Pi 改供应商、Codex/OpenCode 目前只读）。
 */

import type { ReactNode } from "react";
import { AlertCircle, FileWarning, Info, Loader2, RefreshCw, Server } from "lucide-react";
import type { LocalConfigIssue, LocalProvider, LocalRuntimeConfig } from "../../data/localRuntimeConfig.ts";

interface LocalConfigPanelProps {
  runtimeLabel: string;
  config: LocalRuntimeConfig | null;
  loading: boolean;
  error: string;
  unsupported: string;
  onRefresh: () => void;
  /** 面板级操作按钮（新增供应商、导入等）。 */
  actions?: ReactNode;
  /** 每个供应商卡片右侧的操作按钮。 */
  providerActions?: (provider: LocalProvider) => ReactNode;
  /** 供应商卡片下方的额外内容（例如展开的编辑表单）。 */
  providerDetail?: (provider: LocalProvider) => ReactNode;
  /** 一个供应商都没读到时的补充说明。 */
  emptyHint?: ReactNode;
}

const ISSUE_LABEL: Record<LocalConfigIssue["kind"], string> = {
  not_found: "文件不存在",
  parse_error: "解析失败",
  permission_denied: "没有读取权限",
  unsupported_shape: "结构无法识别",
  notice: "说明",
};

/** notice 是「配置正常，只是没有可选模型」，用中性配色，不要显示成警告。 */
const NOTICE_ONLY: ReadonlySet<LocalConfigIssue["kind"]> = new Set(["notice"]);

function CodePath({ children }: { children: string }) {
  return (
    <code style={{
      padding: "2px 6px",
      background: "#e8eaed",
      borderRadius: "4px",
      fontSize: "12px",
      wordBreak: "break-all",
    }}>{children}</code>
  );
}

function ModelRow({ model, isDefault }: { model: LocalProvider["models"][number]; isDefault: boolean }) {
  return (
    <li style={{ display: "flex", alignItems: "baseline", gap: "8px", padding: "4px 0", flexWrap: "wrap" }}>
      {model.tierLabel ? (
        <span style={{
          fontSize: "11px",
          fontWeight: 700,
          padding: "1px 6px",
          borderRadius: "4px",
          background: "#eef2ff",
          color: "#4338ca",
          flexShrink: 0,
        }}>{model.tierLabel}</span>
      ) : null}
      <span style={{ fontSize: "13px", fontWeight: 600 }}>{model.displayName || model.id}</span>
      {model.displayName && model.displayName !== model.id ? (
        <span style={{ fontSize: "12px", color: "var(--settings-muted)" }}>{model.id}</span>
      ) : null}
      {isDefault ? (
        <span style={{ fontSize: "11px", color: "#197342", fontWeight: 700 }}>当前默认</span>
      ) : null}
      {model.contextWindow ? (
        <span style={{ fontSize: "12px", color: "var(--settings-muted)" }}>
          上下文 {model.contextWindow.toLocaleString()}
        </span>
      ) : null}
      {model.reasoning ? (
        <span style={{ fontSize: "12px", color: "var(--settings-muted)" }}>推理模型</span>
      ) : null}
    </li>
  );
}

function ProviderCard({ provider, actions, detail }: {
  provider: LocalProvider;
  actions?: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div style={{
      border: "1px solid var(--settings-border)",
      borderRadius: "10px",
      padding: "14px 16px",
      background: "#fff",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: "14px" }}>{provider.displayName}</div>
          <div style={{ fontSize: "12px", color: "var(--settings-muted)", marginTop: "2px" }}>
            {provider.baseUrl || "使用官方默认端点"}
            {provider.apiFormat ? ` · ${provider.apiFormat}` : ""}
          </div>
        </div>
        {actions ? <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>{actions}</div> : null}
      </div>

      <div style={{ fontSize: "12px", color: provider.credential.configured ? "#197342" : "#b06000" }}>
        {provider.credential.configured
          ? `密钥已在本机配置${provider.credential.source ? `（${provider.credential.source}）` : ""}`
          : "本机配置里没有密钥，使用前需要补上"}
      </div>

      {provider.models.length > 0 ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, borderTop: "1px solid var(--settings-border)", paddingTop: "8px" }}>
          {provider.models.map((model) => (
            <ModelRow
              key={`${model.tier ?? ""}:${model.id}`}
              model={model}
              isDefault={provider.defaultModelId === model.id}
            />
          ))}
        </ul>
      ) : (
        <div style={{ fontSize: "12px", color: "var(--settings-muted)", borderTop: "1px solid var(--settings-border)", paddingTop: "8px" }}>
          配置文件里没有这个供应商的模型清单
        </div>
      )}

      {provider.sourcePaths.length > 0 ? (
        <div style={{ fontSize: "11px", color: "var(--settings-muted)" }}>
          读自 {provider.sourcePaths.join("、")}
        </div>
      ) : null}

      {detail}
    </div>
  );
}

export function LocalConfigPanel({
  runtimeLabel,
  config,
  loading,
  error,
  unsupported,
  onRefresh,
  actions,
  providerActions,
  providerDetail,
  emptyHint,
}: LocalConfigPanelProps) {
  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "60px" }}>
        <Loader2 size={32} className="is-spinning" style={{ color: "var(--settings-muted)" }} />
      </div>
    );
  }

  if (unsupported) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "48px" }}>
        <Server size={20} style={{ color: "var(--settings-muted)" }} />
        <p style={{ margin: 0, fontSize: "14px", color: "var(--settings-muted)" }}>{unsupported}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", padding: "48px" }}>
        <p style={{ margin: 0, fontSize: "14px", color: "var(--settings-muted)" }}>{error}</p>
        <button type="button" className="button-secondary" onClick={onRefresh}>
          <RefreshCw size={16} />
          重试
        </button>
      </div>
    );
  }

  const providers = config?.providers ?? [];
  const modelCount = providers.reduce((total, provider) => total + provider.models.length, 0);
  // 读失败要显眼（琥珀警告），「配置正常但没有可选模型」只是说明（中性灰）。
  const issues = config?.issues ?? [];
  const problems = issues.filter((issue) => !NOTICE_ONLY.has(issue.kind));
  const notices = issues.filter((issue) => NOTICE_ONLY.has(issue.kind));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{
        border: "1px solid #e0e7ff",
        borderRadius: "12px",
        padding: "16px 20px",
        background: "#f5f7ff",
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
      }}>
        <AlertCircle size={20} style={{ color: "#6366f1", flexShrink: 0, marginTop: "2px" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h4 style={{ margin: "0 0 6px", fontSize: "14px", fontWeight: 700, color: "#202124" }}>
            {runtimeLabel} 本机配置
          </h4>
          <p style={{ margin: 0, fontSize: "13px", color: "#5f6368", lineHeight: 1.6 }}>
            读自 {config ? <CodePath>{config.primaryPath}</CodePath> : "（未知路径）"}
            {config?.present ? "" : "（该文件当前不存在）"}
            {providers.length > 0
              ? `，共 ${providers.length} 个供应商、${modelCount} 个模型。`
              : "。"}
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
          {actions}
          <button type="button" className="button-secondary" onClick={onRefresh} title="重新读取本机配置">
            <RefreshCw size={16} />
            刷新
          </button>
        </div>
      </div>

      {problems.length > 0 ? (
        <div style={{
          border: "1px solid #fde68a",
          borderRadius: "10px",
          padding: "12px 16px",
          background: "#fffbeb",
          display: "flex",
          alignItems: "flex-start",
          gap: "10px",
        }}>
          <FileWarning size={18} style={{ color: "#b45309", flexShrink: 0, marginTop: "2px" }} />
          <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", color: "#78350f", lineHeight: 1.7 }}>
            {problems.map((issue) => (
              <li key={`${issue.kind}:${issue.path}`}>
                <strong>{ISSUE_LABEL[issue.kind]}</strong>：{issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {notices.length > 0 ? (
        <div style={{
          border: "1px solid #e2e8f0",
          borderRadius: "10px",
          padding: "12px 16px",
          background: "#f8fafc",
          display: "flex",
          alignItems: "flex-start",
          gap: "10px",
        }}>
          <Info size={18} style={{ color: "#64748b", flexShrink: 0, marginTop: "2px" }} />
          <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", color: "#475569", lineHeight: 1.7 }}>
            {notices.map((issue) => (
              <li key={`${issue.kind}:${issue.path}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {providers.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>本机已有的供应商</h3>
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              actions={providerActions?.(provider)}
              detail={providerDetail?.(provider)}
            />
          ))}
        </div>
      ) : (
        <div style={{
          border: "1px dashed var(--settings-border)",
          borderRadius: "10px",
          padding: "32px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "10px",
          textAlign: "center",
        }}>
          <Server size={20} style={{ color: "var(--settings-muted)" }} />
          <p style={{ margin: 0, fontSize: "13px", color: "var(--settings-muted)" }}>
            这个配置文件里还没有可用的供应商。
          </p>
          {emptyHint}
        </div>
      )}
    </div>
  );
}
