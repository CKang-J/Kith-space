import { useEffect, useMemo, useState } from "react";

type Api = (method: string, path: string, body?: unknown) => Promise<any>;

interface AgentModelBindingEditorProps {
  agent: {
    id: string;
    runtime: string;
    modelBindingMode?: "runtime_default" | "pinned" | null;
    modelConfigurationId?: string | null;
    modelConfigurationLabel?: string | null;
    modelBindingState?: string | null;
    runtimeRestartRequired?: boolean | number;
  };
  api: Api;
  onSaved: () => Promise<void>;
}

const BINDING_STATE_LABEL: Record<string, string> = {
  legacy: "旧版绑定",
  ready: "已确认",
  setup_required: "需要完成运行器默认配置",
  confirmation_required: "需要确认当前安装的数据目的地",
  incompatible: "当前模型与运行器不兼容",
  restart_required: "配置已变化，需要重新确认",
};

export function AgentModelBindingEditor({ agent, api, onSaved }: AgentModelBindingEditorProps) {
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<"runtime_default" | "pinned">(
    agent.modelBindingMode === "pinned" ? "pinned" : "runtime_default",
  );
  const [configurationId, setConfigurationId] = useState(agent.modelConfigurationId ?? "");
  const [configurations, setConfigurations] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setMode(agent.modelBindingMode === "pinned" ? "pinned" : "runtime_default");
    setConfigurationId(agent.modelConfigurationId ?? "");
  }, [agent.modelBindingMode, agent.modelConfigurationId]);
  useEffect(() => {
    void api("GET", "/api/settings/model-configurations")
      .then((result: any) => setConfigurations(
        (result.items ?? []).filter((item: any) => item.status === "active"),
      ))
      .catch(() => setConfigurations([]));
  }, [api]);

  const compatibleConfigurations = useMemo(
    () => configurations.filter((configuration) => configuration.compatibility?.[agent.runtime]?.supported),
    [agent.runtime, configurations],
  );
  const state = agent.modelBindingState ?? "legacy";
  const needsAttention = state !== "legacy" && (state !== "ready" || Boolean(agent.runtimeRestartRequired));

  const save = async () => {
    if (mode === "pinned" && !configurationId) {
      setError("请选择与当前运行器兼容的模型配置。");
      return;
    }
    const selected = compatibleConfigurations.find((configuration) => configuration.id === configurationId);
    setBusy(true);
    setError("");
    try {
      const result = await api("PATCH", `/api/agents/${agent.id}`, {
        runtime: agent.runtime,
        modelBinding: mode === "runtime_default"
          ? { mode: "runtime_default" }
          : {
              mode: "pinned",
              modelConfigurationId: configurationId,
              modelConfigurationRevision: selected?.currentRevision ?? 1,
            },
      });
      if (result?.error) throw new Error(result.error);
      await onSaved();
      setEditing(false);
    } catch (cause: any) {
      setError(cause?.message ?? "模型绑定保存失败。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`card model-binding-card${needsAttention ? " model-binding-card--attention" : ""}`}
      aria-labelledby={`agent-model-binding-${agent.id}`}>
      <div className="settings-section__heading">
        <div>
          <h3 id={`agent-model-binding-${agent.id}`}>模型绑定</h3>
          <p>
            {mode === "runtime_default" ? "跟随运行器默认配置" : agent.modelConfigurationLabel || "固定模型配置"}
            {" · "}{BINDING_STATE_LABEL[state] ?? state}
          </p>
        </div>
        <button type="button" className="joinbtn" onClick={() => setEditing((value) => !value)}>
          {editing ? "取消" : needsAttention ? "重新确认" : "更改"}
        </button>
      </div>
      {needsAttention ? <div className="settings-callout" role="status">
        当前绑定不会接收新的 Agent turn。请确认运行器默认模型，或固定一个兼容的 Kith 模型配置。
      </div> : null}
      {editing ? <div className="model-binding-editor">
        <label>绑定方式
          <select value={mode} onChange={(event) => setMode(event.target.value as "runtime_default" | "pinned")}>
            <option value="runtime_default">跟随运行器默认配置</option>
            <option value="pinned">固定 Kith 模型配置</option>
          </select>
        </label>
        {mode === "pinned" ? <label>模型配置
          <select value={configurationId} onChange={(event) => setConfigurationId(event.target.value)}>
            <option value="">请选择</option>
            {compatibleConfigurations.map((configuration) =>
              <option key={configuration.id} value={configuration.id}>{configuration.displayName}</option>)}
          </select>
        </label> : null}
        {error ? <div className="settings-error" role="alert">{error}</div> : null}
        <button type="button" onClick={() => void save()} disabled={busy}>
          {busy ? "保存中…" : "确认并应用"}
        </button>
      </div> : null}
    </section>
  );
}
