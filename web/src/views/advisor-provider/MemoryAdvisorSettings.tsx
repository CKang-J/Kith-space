import { useEffect, useState } from "react";

type Api = (method: string, path: string, body?: unknown) => Promise<any>;

export function MemoryAdvisorSettings({ api }: { api: Api }) {
  const [summary, setSummary] = useState<any>(null);
  const [models, setModels] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const reload = async () => {
    const [advisor, configurations] = await Promise.all([
      api("GET", "/api/settings/memory-advisor"),
      api("GET", "/api/settings/model-configurations"),
    ]);
    setSummary(advisor);
    setModels(configurations.items ?? []);
  };
  useEffect(() => { void reload(); }, []);
  const patch = async (body: unknown) => {
    setError("");
    try {
      const result = await api("PATCH", "/api/settings/memory-advisor", body);
      if (result?.error) throw new Error(`${result.code ?? "error"}: ${result.error}`);
      setSummary(result);
    }
    catch (cause: any) { setError(cause?.message ?? "无法更新 Memory Advisor"); }
  };
  const probe = async () => {
    setBusy("probe");
    setError("");
    try {
      const result = await api("POST", "/api/advisor-provider/probe", {});
      if (result?.error) throw new Error(`${result.code ?? "error"}: ${result.error}`);
      await reload();
    } catch (cause: any) {
      setError(cause?.message ?? "执行配置测试失败");
    } finally {
      setBusy("");
    }
  };
  if (!summary) return <div className="empty">正在读取 Memory Advisor 设置…</div>;
  return (
    <div className="model-settings">
      <section className="settings-section">
        <div className="settings-section__heading">
          <div><h2>Memory Advisor</h2><p>控制是否启用、由谁执行，以及使用哪个已验证的模型配置。</p></div>
          <label className="ck-row"><input type="checkbox" checked={summary.enabled}
            onChange={(event) => void patch({ enabled: event.target.checked })} /><span>启用</span></label>
        </div>
        {error ? <div className="settings-error" role="alert">{error}</div> : null}
        <div className="settings-card-grid">
          <article><small>执行器</small>
            <select aria-label="Memory Advisor 执行器" value={summary.executor?.id ?? ""} onChange={(event) =>
              void patch({ executorId: event.target.value })}>
              <option value="">请选择执行器</option>
              <option value="pi_sdk">内置 Pi SDK</option>
              <option value="claude_cli">Claude Code</option>
            </select>
            <span>一次性记忆执行，与聊天 Agent session、工具和凭据 activation 相互独立。</span></article>
          <article><small>当前状态</small><strong>{summary.state}</strong>
            <span>{summary.requiresAuthorization ? "模型或目的地变化后，需要逐 Agent 重新授权。" : "执行配置已就绪。"}</span></article>
        </div>
        <label>模型配置
          <select value={summary.modelConfiguration?.id ?? ""} onChange={(event) => {
            const model = models.find((item) => item.id === event.target.value);
            if (model) void patch({ modelConfigurationId: model.id, modelConfigurationRevision: model.currentRevision });
          }}>
            <option value="">请选择模型配置</option>
            {models.filter((model) => model.compatibility?.pi_sdk?.supported !== false)
              .map((model) => <option key={model.id} value={model.id}>{model.displayName} · {model.provider.displayName}</option>)}
          </select>
        </label>
        {summary.modelConfiguration ? <p className="wrap-anywhere">
          实际目的地：{summary.modelConfiguration.destinationHost} · 模型：{summary.modelConfiguration.modelId}
        </p> : <div className="settings-callout">请先在“模型与供应商”创建配置，再返回这里选择。</div>}
        {summary.executor && summary.modelConfiguration ? <button type="button" disabled={Boolean(busy)}
          onClick={() => void probe()}>{busy === "probe" ? "测试中…" : summary.state === "ready" ? "重新测试执行配置" : "测试并启用执行配置"}</button> : null}
      </section>
      <details className="settings-section">
        <summary>技术诊断与 Provider Run</summary>
        <p>内部 revision、epoch、执行审计和失败原因保留在诊断视图；普通设置不会展示不可操作的摘要值。</p>
        <button type="button" onClick={() => void reload()}>重新检查状态</button>
      </details>
    </div>
  );
}
