import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Sliders } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  ready: "已就绪",
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
    <section
      className="card space-y-3"
      aria-labelledby={`agent-model-binding-${agent.id}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 id={`agent-model-binding-${agent.id}`} className="text-base font-semibold text-foreground flex items-center gap-2">
              <Sliders className="size-4 text-primary" /> 模型绑定
            </h3>
            {needsAttention ? (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium">
                <AlertTriangle className="size-3" /> {BINDING_STATE_LABEL[state] ?? state}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-700 dark:text-green-400 font-medium">
                <CheckCircle2 className="size-3" /> {BINDING_STATE_LABEL[state] ?? state}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {mode === "runtime_default" ? "跟随运行器默认配置" : agent.modelConfigurationLabel || "固定模型配置"}
          </p>
        </div>
        <Button
          type="button"
          variant={needsAttention ? "default" : "outline"}
          size="sm"
          onClick={() => setEditing((value) => !value)}
        >
          {editing ? "取消" : needsAttention ? "重新配置" : "更改"}
        </Button>
      </div>

      {needsAttention ? (
        <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-900 dark:text-amber-200 text-xs leading-relaxed" role="status">
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="grow">
            <div className="font-semibold text-amber-800 dark:text-amber-300 mb-0.5">
              需要确认模型绑定
            </div>
            <div>
              当前绑定不会接收新的 Agent turn。请确认运行器默认模型，或固定一个兼容的 Kith 模型配置。
            </div>
          </div>
        </div>
      ) : null}

      {editing ? (
        <div className="p-3.5 rounded-lg border border-border/60 bg-muted/20 space-y-3 pt-3">
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-foreground">绑定方式</label>
            <select
              className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={mode}
              onChange={(event) => setMode(event.target.value as "runtime_default" | "pinned")}
            >
              <option value="runtime_default">跟随运行器默认配置</option>
              <option value="pinned">固定 Kith 模型配置</option>
            </select>
          </div>

          {mode === "pinned" ? (
            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-foreground">模型配置</label>
              <select
                className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={configurationId}
                onChange={(event) => setConfigurationId(event.target.value)}
              >
                <option value="">请选择</option>
                {compatibleConfigurations.map((configuration) => (
                  <option key={configuration.id} value={configuration.id}>{configuration.displayName}</option>
                ))}
              </select>
            </div>
          ) : null}

          {error ? <div className="text-xs text-destructive font-medium" role="alert">{error}</div> : null}

          <div className="flex justify-end pt-1">
            <Button
              type="button"
              size="sm"
              onClick={() => void save()}
              disabled={busy}
            >
              {busy ? "保存中…" : "确认并应用"}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
