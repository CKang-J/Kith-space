import { useEffect, useState } from "react";
import "./modelSettings.css";

type Api = (method: string, path: string, body?: unknown) => Promise<any>;
const RUNTIMES = [
  ["claude", "Claude Code"], ["codex", "Codex"], ["opencode", "OpenCode"], ["pi", "Pi Agent（本机 CLI）"],
] as const;

export function RuntimeSettings({ api }: { api: Api }) {
  const [profiles, setProfiles] = useState<Record<string, any>>({});
  const [models, setModels] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [probing, setProbing] = useState(false);
  const reload = async () => {
    const [modelResult, ...runtimeResults] = await Promise.all([
      api("GET", "/api/settings/model-configurations"),
      ...RUNTIMES.map(([id]) => api("GET", `/api/settings/runtimes/${id}`)),
    ]);
    setModels(modelResult.items ?? []);
    setProfiles(Object.fromEntries(runtimeResults.map((item) => [item.runtimeId, item])));
  };
  useEffect(() => { void reload(); }, []);
  const probe = async () => {
    setError("");
    setProbing(true);
    try {
      await Promise.all(RUNTIMES.map(([id]) => api("POST", `/api/settings/runtimes/${id}/probe`, {})));
      await reload();
    } catch (cause: any) {
      setError(cause?.message ?? "Unable to probe runtimes");
    } finally {
      setProbing(false);
    }
  };
  const save = async (runtimeId: string, mode: string, configurationId: string | null) => {
    const model = models.find((item) => item.id === configurationId);
    setError("");
    try {
      await api("PATCH", `/api/settings/runtimes/${runtimeId}`, {
        enabled: true,
        defaultBinding: {
          mode,
          modelConfigurationId: mode === "kith_model_configuration" ? configurationId : null,
          modelConfigurationRevision: mode === "kith_model_configuration" ? model?.currentRevision ?? 1 : null,
        },
        runtimeOptions: {},
      });
      await reload();
    } catch (cause: any) { setError(cause?.message ?? "Unable to update runtime"); }
  };
  return (
    <div className="model-settings">
      <section className="settings-section">
        <div className="settings-section__heading">
          <div><h2>运行器</h2><p>运行器负责驱动 Agent。默认模型、CLI 自有账户和未配置是三个不同状态。</p></div>
          <button type="button" onClick={() => void probe()} disabled={probing}>
            {probing ? "探测中…" : "重新探测"}
          </button>
        </div>
        <div className="sr-only" aria-live="polite">{probing ? "正在探测运行器" : "运行器探测已结束"}</div>
        {error ? <div className="settings-error" role="alert">{error}</div> : null}
        <div className="runtime-list">
          {RUNTIMES.map(([id, label]) => {
            const profile = profiles[id];
            const binding = profile?.defaultBinding;
            return <article key={id}>
              <div><strong>{label}</strong><small>{profile?.probe?.status ?? "尚未探测"}</small></div>
              <label>默认配置
                <select value={binding?.mode === "kith_model_configuration" ? binding.modelConfigurationId : binding?.mode ?? "unset"}
                  onChange={(event) => {
                    const value = event.target.value;
                    void save(id,
                      value === "unset" || value === "unmanaged_cli_native" ? value : "kith_model_configuration",
                      value === "unset" || value === "unmanaged_cli_native" ? null : value);
                  }}>
                  <option value="unset">未配置</option>
                  <option value="unmanaged_cli_native">使用 CLI 自有账户/默认供应商</option>
                  {models.filter((model) => model.compatibility?.[id]?.supported).map((model) =>
                    <option key={model.id} value={model.id}>{model.displayName}</option>)}
                </select>
              </label>
              {id === "pi" ? <p>Pi Agent 使用外部 Pi CLI RPC；Memory Advisor 的内置 Pi SDK 是另一套独立执行器。MCP：不支持；Kith CLI Gateway：支持。</p> : null}
            </article>;
          })}
        </div>
      </section>
    </div>
  );
}
