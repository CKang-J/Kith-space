import { useEffect, useState } from "react";
import { getDesktopBridge } from "../../desktopBridge.ts";
import "./modelSettings.css";

type Api = (method: string, path: string, body?: unknown) => Promise<any>;

const API_KINDS = [
  ["openai-responses", "OpenAI Responses"],
  ["openai-completions", "OpenAI Completions compatible"],
  ["anthropic-messages", "Anthropic Messages"],
] as const;

export function ModelProviderSettings({ api }: { api: Api }) {
  const desktop = getDesktopBridge() !== null;
  const [providers, setProviders] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importing, setImporting] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    displayName: "", backendId: "openai", apiKind: "openai-responses",
    canonicalOrigin: "https://api.openai.com/v1", credentialValue: "",
  });
  const [modelDraft, setModelDraft] = useState({ displayName: "", modelId: "" });

  const reload = async () => {
    const [providerResult, modelResult] = await Promise.all([
      api("GET", "/api/settings/model-providers"),
      api("GET", "/api/settings/model-configurations"),
    ]);
    setProviders(providerResult.items ?? []);
    setModels(modelResult.items ?? []);
  };
  useEffect(() => { void reload(); }, []);

  const createProvider = async () => {
    setError("");
    try {
      const origin = new URL(draft.canonicalOrigin).origin + new URL(draft.canonicalOrigin).pathname.replace(/\/$/, "");
      const created = await api("POST", "/api/settings/model-providers", {
        displayName: draft.displayName, backendId: draft.backendId, apiKind: draft.apiKind,
        canonicalOrigin: origin, networkClass: origin.startsWith("http://127.0.0.1") ? "loopback" : "public_cloud",
        credentialSourceKind: draft.credentialValue ? "kith_secret" : "keyless_local",
        ...(draft.credentialValue ? { credentialValue: draft.credentialValue } : {}),
        dataPolicyRevision: "human-confirmed-v1", dataPolicyProvenance: "human_asserted",
        allowedEgress: [origin], capabilitySnapshot: {},
      });
      setSelected(created.id);
      setDraft((value) => ({ ...value, displayName: "", credentialValue: "" }));
      await reload();
    } catch (cause: any) { setError(cause?.message ?? "Unable to save provider connection"); }
  };

  const testSelected = async () => {
    if (!selected) return;
    setError(""); setNotice("");
    try {
      const result = await api("POST", `/api/settings/model-providers/${selected}/test`, {});
      setNotice(`目的地校验通过：${result.destination.host} · redirect ${result.redirectPolicy}`);
    } catch (cause: any) { setError(cause?.message ?? "连接检查失败"); }
  };

  const importRuntime = async (runtimeId: string) => {
    setError(""); setNotice(""); setImporting(runtimeId);
    try {
      const preview = await api("POST", "/api/settings/cli-imports/preview", { runtimeId });
      const result = await api("POST", "/api/settings/cli-imports/apply", {
        runtimeId, sourceMtimeDigest: preview.sourceMtimeDigest,
      });
      setNotice(result.applied ? `${runtimeId} 的静态 CLI 默认值已导入；全局配置未被写入。` : `${runtimeId} 没有可导入的受支持配置。`);
    } catch (cause: any) { setError(cause?.message ?? "CLI 配置导入失败"); }
    finally { setImporting(null); }
  };

  const createModel = async () => {
    if (!selected) return;
    setError("");
    try {
      await api("POST", "/api/settings/model-configurations", {
        displayName: modelDraft.displayName, providerConnectionId: selected,
        modelId: modelDraft.modelId, inputCapabilities: ["text"], options: {},
      });
      setModelDraft({ displayName: "", modelId: "" });
      await reload();
    } catch (cause: any) { setError(cause?.message ?? "Unable to save model configuration"); }
  };

  return (
    <div className="model-settings" data-testid="model-provider-settings">
      <section className="settings-section">
        <div className="settings-section__heading">
          <div><h2>模型与供应商</h2><p>连接描述实际数据目的地；模型配置可被多个 Agent 和 Memory Advisor 复用。</p></div>
          <button type="button" onClick={() => void reload()}>重新检查</button>
        </div>
        {!desktop ? <div className="settings-callout" role="status">
          浏览器可查看和选择已有配置。新增或更换密钥请前往“桌面端 → 设置 → 模型与供应商”。
        </div> : null}
        {error ? <div className="settings-error" role="alert">{error}</div> : null}
        {notice ? <div className="settings-callout" role="status" aria-live="polite">{notice}</div> : null}
        {!providers.length ? <ol className="settings-onboarding">
          <li>连接供应商并确认真实数据目的地</li><li>创建可复用模型配置</li>
          <li>到“运行器”设置三态默认绑定</li><li>创建 Agent 或为 Memory Advisor 授权</li>
        </ol> : null}
        <div className="settings-master-detail">
          <div className="settings-list" role="listbox" aria-label="供应商连接">
            {providers.map((provider) => (
              <button type="button" role="option" aria-selected={selected === provider.id}
                className={selected === provider.id ? "is-selected" : ""} key={provider.id}
                onClick={() => setSelected(provider.id)}>
                <strong>{provider.displayName}</strong>
                <span>{provider.destination.host}</span>
                <small>{provider.apiKind} · {provider.credential === "configured" ? "凭据已配置" : "无需密钥"}</small>
              </button>
            ))}
            {!providers.length ? <p className="settings-empty">尚无供应商连接。按右侧步骤创建第一个连接。</p> : null}
          </div>
          <div className="settings-detail">
            <h3>1. 新建供应商连接</h3>
            <label>友好名称<input value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} /></label>
            <label>供应商标识<input value={draft.backendId} onChange={(e) => setDraft({ ...draft, backendId: e.target.value })} /></label>
            <label>API 协议<select value={draft.apiKind} onChange={(e) => setDraft({ ...draft, apiKind: e.target.value })}>
              {API_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label>Endpoint<input className="wrap-anywhere" value={draft.canonicalOrigin} onChange={(e) => setDraft({ ...draft, canonicalOrigin: e.target.value })} /></label>
            <label>API Key<input type="password" disabled={!desktop} value={draft.credentialValue}
              placeholder={desktop ? "仅保存在 Kith 加密凭据存储中" : "请在桌面端完成"}
              onChange={(e) => setDraft({ ...draft, credentialValue: e.target.value })} /></label>
            <button type="button" className="ok" disabled={!desktop || !draft.displayName} onClick={() => void createProvider()}>保存连接</button>
            <button type="button" disabled={!selected} onClick={() => void testSelected()}>检查所选连接目的地</button>
            <hr />
            <h3>2. 为所选连接添加模型</h3>
            <label>模型配置名称<input value={modelDraft.displayName} onChange={(e) => setModelDraft({ ...modelDraft, displayName: e.target.value })} /></label>
            <label>Model ID<input className="wrap-anywhere" value={modelDraft.modelId} onChange={(e) => setModelDraft({ ...modelDraft, modelId: e.target.value })} /></label>
            <button type="button" className="ok" disabled={!selected || !modelDraft.displayName || !modelDraft.modelId}
              onClick={() => void createModel()}>保存模型配置</button>
          </div>
        </div>
      </section>
      <section className="settings-section">
        <h2>从本机 CLI 只读导入</h2>
        <p>只读取受支持的静态默认值并保存脱敏快照；不会修改 Claude Code、Codex、OpenCode 或 Pi 的全局配置。</p>
        <div className="settings-actions">
          {["claude", "codex", "opencode", "pi"].map((runtimeId) =>
            <button type="button" key={runtimeId} disabled={!desktop || importing !== null}
              onClick={() => void importRuntime(runtimeId)}>
              {importing === runtimeId ? "导入中…" : `导入 ${runtimeId}`}
            </button>)}
        </div>
      </section>
      <section className="settings-section">
        <h2>模型配置</h2>
        <div className="settings-card-grid">
          {models.map((model) => <article key={model.id}>
            <strong>{model.displayName}</strong><span className="wrap-anywhere">{model.modelId}</span>
            <small>{model.provider.displayName} · {model.destination.host}</small>
          </article>)}
        </div>
      </section>
    </div>
  );
}
