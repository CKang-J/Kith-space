import { useEffect, useState } from "react";
import { Brain, CheckCircle2, RefreshCw, Sparkles } from "lucide-react";
import "../model-settings/modelSettings.css";

type Api = (method: string, path: string, body?: unknown) => Promise<any>;

function stateLabel(state: string, requiresAuthorization: boolean) {
  if (requiresAuthorization) return { tone: "warning", label: "需要重新确认" };
  if (state === "ready") return { tone: "ready", label: "已就绪" };
  if (state === "disabled") return { tone: "missing", label: "已停用" };
  return { tone: "warning", label: "需要检查" };
}

function runErrorLabel(code: string): string {
  const labels: Record<string, string> = {
    provider_model_incompatible: "当前整理方式不支持这个模型",
    credential_activation_failed: "模型凭据不可用",
    egress_preflight_failed: "无法安全连接模型地址",
    provider_timeout: "模型响应超时",
  };
  return labels[code] ?? "整理未完成，请重新测试当前设置";
}

export function MemoryAdvisorSettings({ api }: { api: Api }) {
  const [summary, setSummary] = useState<any>(null);
  const [models, setModels] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    const [advisor, configurations] = await Promise.all([
      api("GET", "/api/settings/memory-advisor"),
      api("GET", "/api/settings/model-configurations"),
    ]);
    setSummary(advisor);
    setModels(configurations.items ?? []);
  };

  useEffect(() => {
    void reload()
      .catch((cause) => setError(cause?.message ?? "无法读取记忆整理设置"))
      .finally(() => setLoading(false));
  }, []);

  const patch = async (body: unknown) => {
    setError("");
    setNotice("");
    setBusy("save");
    try {
      const result = await api("PATCH", "/api/settings/memory-advisor", body);
      if (result?.error) throw new Error(result.error);
      setSummary(result);
      setNotice("设置已保存。");
    } catch (cause: any) {
      setError(cause?.message ?? "无法更新自动整理记忆");
    } finally {
      setBusy("");
    }
  };

  const probe = async () => {
    setBusy("probe");
    setError("");
    setNotice("");
    try {
      const result = await api("POST", "/api/advisor-provider/probe", {});
      if (result?.error) throw new Error(result.error);
      await reload();
      setNotice("测试完成，自动整理记忆可以使用。");
    } catch (cause: any) {
      setError(cause?.message ?? "测试失败，请检查模型连接");
    } finally {
      setBusy("");
    }
  };

  if (loading) return <div className="empty">正在读取自动整理记忆设置…</div>;
  if (!summary) {
    return (
      <div className="model-settings">
        <div className="settings-alert settings-alert--error" role="alert">
          {error || "没有可显示的自动整理记忆设置。"}
        </div>
        <button className="settings-button settings-button--secondary" type="button"
          onClick={() => {
            setLoading(true);
            setError("");
            void reload()
              .catch((cause) => setError(cause?.message ?? "无法读取记忆整理设置"))
              .finally(() => setLoading(false));
          }}>
          <RefreshCw size={16} />重新加载
        </button>
      </div>
    );
  }
  const currentState = stateLabel(summary.state, summary.requiresAuthorization);
  const executorId = summary.executor?.id ?? "pi_sdk";
  const compatibleModels = models.filter((model) => {
    if (model.status !== "active" || model.provider?.credential !== "configured") return false;
    if (executorId === "claude_cli") {
      return model.provider?.backendId === "anthropic"
        && model.provider?.apiKind === "anthropic-messages"
        && model.destination?.host === "api.anthropic.com";
    }
    return !["amazon-bedrock", "google-vertex"].includes(model.provider?.backendId);
  });

  return (
    <div className="model-settings">
      <header className="settings-page-heading">
        <div>
          <h2>自动整理记忆</h2>
          <p>从对话中提取长期有用的信息，供 Agent 在以后需要时回忆。</p>
        </div>
        <label className="settings-switch">
          <input type="checkbox" checked={summary.enabled} disabled={Boolean(busy)}
            onChange={(event) => void patch({ enabled: event.target.checked })} />
          <span aria-hidden="true" />
          <b>{summary.enabled ? "已启用" : "已停用"}</b>
        </label>
      </header>

      {error ? <div className="settings-alert settings-alert--error" role="alert">{error}</div> : null}
      {notice ? <div className="settings-alert settings-alert--success" role="status" aria-live="polite">{notice}</div> : null}

      <section className="advisor-settings-card">
        <header>
          <span className="runtime-logo runtime-logo--large"><Brain size={22} /></span>
          <div><h3>记忆整理方式</h3><p>整理任务在后台独立运行，不会占用聊天 Agent 的会话。</p></div>
          <span className={`settings-status-pill is-${currentState.tone}`}>
            <CheckCircle2 size={14} />{currentState.label}
          </span>
        </header>

        <div className="advisor-settings-grid">
          <label className="settings-field">
            <span>由谁整理</span>
            <select value={summary.executor?.id ?? ""} disabled={Boolean(busy)}
              onChange={(event) => void patch({ executorId: event.target.value })}>
              <option value="">请选择</option>
              <option value="pi_sdk">内置 Pi（推荐，轻量且独立）</option>
              <option value="claude_cli">Claude Code</option>
            </select>
            <small>这里只决定整理工作的执行器，不会改变聊天 Agent 的运行器。</small>
          </label>

          <label className="settings-field">
            <span>使用哪个模型</span>
            <select value={summary.modelConfiguration?.id ?? ""} disabled={Boolean(busy)}
              onChange={(event) => {
                const model = models.find((item) => item.id === event.target.value);
                if (model) void patch({
                  modelConfigurationId: model.id,
                  modelConfigurationRevision: model.currentRevision,
                });
              }}>
              <option value="">请选择模型</option>
              {compatibleModels.map((model) => (
                  <option key={model.id} value={model.id}>{model.displayName} · {model.provider.displayName}</option>
                ))}
            </select>
            <small>{summary.modelConfiguration
              ? `当前发送到 ${summary.modelConfiguration.destinationHost}`
              : "先到“模型与供应商”添加一个模型，再回到这里选择。"}</small>
          </label>
        </div>

        <div className="advisor-explainer">
          <Sparkles size={18} />
          <div>
            <strong>什么时候会整理？</strong>
            <p>Agent 发现对以后有用的信息后，系统会在后台逐条整理；停用后保留已有记忆，但不再整理新内容。</p>
          </div>
        </div>

        <footer>
          <button className="settings-button settings-button--secondary" type="button"
            disabled={Boolean(busy) || !summary.executor || !summary.modelConfiguration}
            onClick={() => void probe()}>
            <RefreshCw size={16} className={busy === "probe" ? "is-spinning" : ""} />
            {busy === "probe" ? "测试中…" : "测试当前设置"}
          </button>
        </footer>
      </section>

      <details className="settings-import-panel">
        <summary>运行记录与故障排查</summary>
        {summary.latestRun ? (
          <dl className="settings-diagnostics-list">
            <div><dt>最近结果</dt><dd>{summary.latestRun.status === "succeeded" ? "整理成功" : summary.latestRun.status === "failed" ? "整理失败" : "处理中或已停止"}</dd></div>
            <div><dt>时间</dt><dd>{new Date(summary.latestRun.completedAt ?? summary.latestRun.createdAt).toLocaleString()}</dd></div>
            <div><dt>空间</dt><dd>{summary.latestRun.spaceName}</dd></div>
            {summary.latestRun.latencyMs != null ? <div><dt>耗时</dt><dd>{summary.latestRun.latencyMs} ms</dd></div> : null}
            {summary.latestRun.errorCode ? <div><dt>失败原因</dt><dd>{runErrorLabel(summary.latestRun.errorCode)}</dd></div> : null}
          </dl>
        ) : (
          <p>还没有整理记录。首次产生需要长期保存的信息后，这里会显示最近一次结果。</p>
        )}
        <div className="settings-actions">
          <button className="settings-button settings-button--secondary" type="button" onClick={() => void reload()}>
            重新读取状态
          </button>
        </div>
      </details>
    </div>
  );
}
