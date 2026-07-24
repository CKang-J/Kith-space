import { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyRound,
  Pencil,
  Plus,
  Server,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { getDesktopBridge } from "../../desktopBridge.ts";
import "./modelSettings.css";

type Api = (method: string, path: string, body?: unknown) => Promise<any>;

const API_KINDS = [
  ["openai-responses", "OpenAI Responses"],
  ["openai-completions", "OpenAI 兼容接口"],
  ["anthropic-messages", "Anthropic Messages"],
] as const;

const PROVIDER_PRESETS = {
  openai: {
    label: "OpenAI",
    backendId: "openai",
    apiKind: "openai-responses",
    canonicalOrigin: "https://api.openai.com",
  },
  anthropic: {
    label: "Anthropic",
    backendId: "anthropic",
    apiKind: "anthropic-messages",
    canonicalOrigin: "https://api.anthropic.com",
  },
  deepseek: {
    label: "DeepSeek",
    backendId: "deepseek",
    apiKind: "openai-completions",
    canonicalOrigin: "https://api.deepseek.com",
  },
  custom: {
    label: "自定义",
    backendId: "custom",
    apiKind: "openai-completions",
    canonicalOrigin: "https://",
  },
} as const;

type ProviderPreset = keyof typeof PROVIDER_PRESETS;
type ProviderDraft = {
  displayName: string;
  backendId: string;
  apiKind: string;
  canonicalOrigin: string;
  credentialValue: string;
};
type ModelDraft = {
  key: string;
  id?: string;
  displayName: string;
  modelId: string;
};

const emptyProvider = (): ProviderDraft => ({
  displayName: "OpenAI",
  backendId: "openai",
  apiKind: "openai-responses",
  canonicalOrigin: "https://api.openai.com",
  credentialValue: "",
});

function apiKindLabel(value: string): string {
  return API_KINDS.find(([id]) => id === value)?.[1] ?? value;
}

type ModelConfigurationUsage =
  | {
    configurationId: string;
    kind: "runtime_default";
    runtimeId: string;
    runtimeEnabled: boolean;
  }
  | {
    configurationId: string;
    kind: "memory_advisor";
    advisorEnabled: boolean;
  }
  | {
    configurationId: string;
    kind: "agent";
    agentId: string;
    agentName: string;
    spaceId: string;
    spaceName: string;
  };

const RUNTIME_LABELS: Readonly<Record<string, string>> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  pi: "Pi",
};

function modelUsageMessage(
  usage: readonly ModelConfigurationUsage[] | undefined,
  subject: "这个模型" | "这个供应商",
): string {
  if (!usage?.length) {
    return `${subject}仍被运行器、Agent 或自动整理记忆使用，请先更换对应模型。`;
  }
  const locations = [...new Set(usage.map((item) => {
    if (item.kind === "runtime_default") {
      const runtime = RUNTIME_LABELS[item.runtimeId] ?? item.runtimeId;
      return `${runtime} 的默认模型${item.runtimeEnabled ? "" : "（运行器已停用）"}`;
    }
    if (item.kind === "memory_advisor") {
      return `自动整理记忆${item.advisorEnabled ? "" : "（已停用但仍保留绑定）"}`;
    }
    return `Space「${item.spaceName}」中的 Agent「${item.agentName}」`;
  }))];
  return `${subject}仍被以下位置使用：${locations.join("、")}。请先在那里切换模型，再回来删除。`;
}

export function ModelProviderSettings({ api }: { api: Api }) {
  const desktop = getDesktopBridge() !== null;
  const localBrowser = !desktop && ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const canWriteSecret = desktop || localBrowser;
  const [providers, setProviders] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [preset, setPreset] = useState<ProviderPreset>("openai");
  const [draft, setDraft] = useState<ProviderDraft>(emptyProvider);
  const [modelDrafts, setModelDrafts] = useState<ModelDraft[]>([]);
  const [error, setError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [importing, setImporting] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const dialogTrigger = useRef<HTMLElement | null>(null);

  const request = async (method: string, path: string, body?: unknown) => {
    const result = await api(method, path, body);
    if (result?.error) {
      const cause = new Error(result.error) as Error & {
        code?: string;
        usage?: ModelConfigurationUsage[];
      };
      cause.code = result.code;
      cause.usage = result.usage;
      throw cause;
    }
    return result;
  };

  const reload = async () => {
    const [providerResult, modelResult] = await Promise.all([
      request("GET", "/api/settings/model-providers"),
      request("GET", "/api/settings/model-configurations"),
    ]);
    setProviders((providerResult.items ?? []).filter((item: any) => item.status === "active"));
    setModels((modelResult.items ?? []).filter((item: any) => item.status === "active"));
  };

  useEffect(() => {
    void reload()
      .catch((cause) => setError(cause?.message ?? "无法读取模型供应商"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!showDialog) return;
    firstFieldRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowDialog(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      dialogTrigger.current?.focus();
    };
  }, [showDialog]);

  const modelsByProvider = useMemo(() => {
    const grouped = new Map<string, any[]>();
    for (const model of models) {
      const providerId = model.provider?.id ?? model.providerConnectionId;
      grouped.set(providerId, [...(grouped.get(providerId) ?? []), model]);
    }
    return grouped;
  }, [models]);

  const applyPreset = (value: ProviderPreset) => {
    const next = PROVIDER_PRESETS[value];
    setPreset(value);
    setDraft({
      displayName: next.label === "自定义" ? "" : next.label,
      backendId: next.backendId,
      apiKind: next.apiKind,
      canonicalOrigin: next.canonicalOrigin,
      credentialValue: "",
    });
  };

  const openCreate = (trigger: HTMLElement) => {
    dialogTrigger.current = trigger;
    setEditingId(null);
    setPreset("openai");
    setDraft(emptyProvider());
    setModelDrafts([{ key: crypto.randomUUID(), displayName: "", modelId: "" }]);
    setDialogError("");
    setShowDialog(true);
  };

  const openEdit = (provider: any, trigger: HTMLElement) => {
    dialogTrigger.current = trigger;
    setEditingId(provider.id);
    const matchingPreset = (Object.entries(PROVIDER_PRESETS)
      .find(([, item]) => item.backendId === provider.backendId)?.[0] ?? "custom") as ProviderPreset;
    setPreset(matchingPreset);
    setDraft({
      displayName: provider.displayName,
      backendId: provider.backendId,
      apiKind: provider.apiKind,
      canonicalOrigin: provider.canonicalOrigin,
      credentialValue: "",
    });
    setModelDrafts((modelsByProvider.get(provider.id) ?? []).map((model) => ({
      key: model.id,
      id: model.id,
      displayName: model.displayName,
      modelId: model.modelId,
    })));
    setDialogError("");
    setShowDialog(true);
  };

  const saveProvider = async () => {
    setDialogError("");
    if (modelDrafts.some((model) => !model.displayName.trim() || !model.modelId.trim())) {
      setDialogError("请填写每个模型的显示名称和模型 ID，或使用右侧移除按钮删除这一行。");
      return;
    }
    setBusy("save");
    try {
      const parsed = new URL(draft.canonicalOrigin);
      const origin = parsed.origin + parsed.pathname.replace(/\/$/, "");
      const payload = {
        displayName: draft.displayName,
        backendId: draft.backendId,
        apiKind: draft.apiKind,
        canonicalOrigin: origin,
        networkClass: ["127.0.0.1", "localhost"].includes(parsed.hostname) ? "loopback" : "public_cloud",
        ...(editingId
          ? (draft.credentialValue ? { credentialValue: draft.credentialValue } : {})
          : {
            credentialSourceKind: draft.credentialValue ? "kith_secret" : "keyless_local",
            ...(draft.credentialValue ? { credentialValue: draft.credentialValue } : {}),
          }),
        dataPolicyRevision: "human-confirmed-v1",
        dataPolicyProvenance: "human_asserted",
        allowedEgress: [origin],
        capabilitySnapshot: {},
      };
      await request(editingId ? "PUT" : "POST",
        editingId
          ? `/api/settings/model-provider-bundles/${editingId}`
          : "/api/settings/model-provider-bundles", {
          provider: payload,
          models: modelDrafts.map((model) => ({
            ...(model.id ? { id: model.id } : {}),
            displayName: model.displayName.trim(),
            modelId: model.modelId.trim(),
          })),
        });
      await reload();
      setShowDialog(false);
      setNotice(editingId ? "供应商和模型已更新。" : "供应商和模型已添加。");
    } catch (cause: any) {
      setDialogError(
        cause?.code === "model_configuration_in_use"
          ? `${modelUsageMessage(cause.usage, "这个模型")} 没有保存任何改动。`
          : cause?.code === "credential_reentry_required"
            ? "供应商或 API 地址发生了变化。为避免把旧密钥发送到新的目的地，请重新输入 API Key。"
            : cause?.code === "space_unavailable"
              ? "有一个已登记的空间当前无法访问，系统不能安全确认模型是否正在使用。请恢复或移除该空间后再保存。"
            : cause?.message ?? "无法保存供应商和模型",
      );
    } finally {
      setBusy("");
    }
  };

  const removeProvider = async (providerId: string) => {
    setError("");
    setBusy(`delete:${providerId}`);
    try {
      await request("DELETE", `/api/settings/model-providers/${providerId}`);
      await reload();
      setDeleteId(null);
      setNotice("供应商及其未被使用的模型已删除。");
    } catch (cause: any) {
      setError(cause?.code === "model_configuration_in_use"
        ? modelUsageMessage(cause.usage, "这个供应商")
        : cause?.code === "space_unavailable"
          ? "有一个已登记的空间当前无法访问，系统不能安全确认模型是否正在使用。请恢复或移除该空间后再删除。"
        : cause?.message ?? "无法删除供应商");
    } finally {
      setBusy("");
    }
  };

  const importRuntime = async (runtimeId: string) => {
    setError("");
    setNotice("");
    setImporting(runtimeId);
    try {
      const preview = await request("POST", "/api/settings/cli-imports/preview", { runtimeId });
      const result = await request("POST", "/api/settings/cli-imports/apply", {
        runtimeId,
        sourceMtimeDigest: preview.sourceMtimeDigest,
      });
      await reload();
      setNotice(result.applied
        ? `已从 ${runtimeId} 读取可复用配置；原 CLI 文件没有被修改。`
        : `${runtimeId} 中没有找到可导入的配置。`);
    } catch (cause: any) {
      setError(cause?.message ?? "CLI 配置导入失败");
    } finally {
      setImporting(null);
    }
  };

  return (
    <div className="model-settings model-settings--wide" data-testid="model-provider-settings">
      <header className="settings-page-heading settings-page-heading--models">
        <div>
          <h2>模型</h2>
          <p>Agent 可用的模型来源，包括你添加的供应商和本机配置。</p>
        </div>
      </header>

      {!desktop && !localBrowser ? (
        <div className="settings-alert settings-alert--info" role="status">
          你可以在浏览器添加、编辑和删除模型来源。为避免 API Key 通过局域网 HTTP 传输，新增或更换密钥请在桌面端或本机浏览器完成。
        </div>
      ) : null}
      {error ? <div className="settings-alert settings-alert--error" role="alert">{error}</div> : null}
      {notice ? <div className="settings-alert settings-alert--success" role="status" aria-live="polite">{notice}</div> : null}

      <section className="provider-overview">
        <header className="provider-overview__header">
          <div><h3>来源</h3><p>{providers.length} 个来源</p></div>
          <button className="settings-button settings-button--primary" type="button"
            onClick={(event) => openCreate(event.currentTarget)}>
            <Plus size={17} />添加模型供应商
          </button>
        </header>

        {loading ? (
          <div className="provider-overview__empty">正在读取模型来源…</div>
        ) : providers.length ? (
          <div className="provider-overview__list">
            {providers.map((provider) => {
              const providerModels = modelsByProvider.get(provider.id) ?? [];
              return (
                <article className="provider-overview-card" key={provider.id}>
                  <div className="provider-overview-card__main">
                    <div className="provider-overview-card__title">
                      <span className="runtime-logo"><Server size={18} /></span>
                      <strong>{provider.displayName}</strong>
                      <span>{apiKindLabel(provider.apiKind)}</span>
                    </div>
                    <p>{providerModels.length
                      ? providerModels.map((model) => model.modelId).join(" · ")
                      : "还没有添加模型"}</p>
                    <small>{provider.destination.host}</small>
                  </div>
                  <div className="provider-overview-card__actions">
                    <span>{providerModels.length} 个模型</span>
                    <button className="settings-button settings-button--secondary" type="button"
                      disabled={Boolean(busy)}
                      onClick={(event) => openEdit(provider, event.currentTarget)}>
                      <Pencil size={15} />编辑
                    </button>
                    <button className="settings-icon-button settings-icon-button--danger" type="button"
                      disabled={Boolean(busy)} aria-label={`删除 ${provider.displayName}`}
                      onClick={() => setDeleteId(provider.id)}>
                      <Trash2 size={17} />
                    </button>
                  </div>
                  {deleteId === provider.id ? (
                    <div className="provider-overview-card__confirm" role="alert">
                      <p>删除后，这个供应商及其未被使用的模型会从列表中移除。系统不会修改任何 CLI 配置。</p>
                      <div className="settings-actions">
                        <button className="settings-button settings-button--secondary" type="button"
                          onClick={() => setDeleteId(null)}>取消</button>
                        <button className="settings-button settings-button--danger" type="button"
                          disabled={busy === `delete:${provider.id}`}
                          onClick={() => void removeProvider(provider.id)}>
                          {busy === `delete:${provider.id}` ? "删除中…" : "确认删除"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="provider-overview__empty">
            <p>还没有模型来源。</p>
            <button className="settings-button settings-button--primary" type="button"
              onClick={(event) => openCreate(event.currentTarget)}>
              <Plus size={17} />添加第一个供应商
            </button>
          </div>
        )}
      </section>

      <details className="settings-import-panel">
        <summary><Upload size={17} />从本机 CLI 读取已有配置</summary>
        <p>只读取受支持的默认值并保存脱敏副本；不会修改 Claude Code、Codex、OpenCode 或 Pi 的全局配置。</p>
        <div className="settings-actions">
          {["claude", "codex", "opencode", "pi"].map((runtimeId) => (
            <button className="settings-button settings-button--secondary" type="button" key={runtimeId}
              disabled={!desktop || importing !== null} onClick={() => void importRuntime(runtimeId)}>
              {importing === runtimeId ? "读取中…" : `读取 ${runtimeId}`}
            </button>
          ))}
        </div>
      </details>

      {showDialog ? (
        <div className="settings-modal-backdrop" role="presentation" onMouseDown={() => setShowDialog(false)}>
          <section className="settings-modal settings-modal--provider" role="dialog" aria-modal="true"
            aria-labelledby="provider-dialog-title" ref={dialogRef}
            onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h3 id="provider-dialog-title">{editingId ? "编辑模型供应商" : "添加模型供应商"}</h3>
                <p>填写连接信息，并列出这个供应商提供的模型。</p>
              </div>
              <button className="settings-icon-button" type="button" aria-label="关闭" onClick={() => setShowDialog(false)}>
                <X size={20} />
              </button>
            </header>
            <div className="settings-modal__body">
              {dialogError ? <div className="settings-alert settings-alert--error" role="alert">{dialogError}</div> : null}
              <label className="settings-field"><span>名称</span>
                <input ref={firstFieldRef} value={draft.displayName} placeholder="例如：团队 DeepSeek"
                  onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} />
              </label>
              <label className="settings-field"><span>供应商</span>
                <select value={preset} onChange={(event) => applyPreset(event.target.value as ProviderPreset)}>
                  {Object.entries(PROVIDER_PRESETS).map(([value, item]) => (
                    <option key={value} value={value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className="settings-field"><span>接口类型</span>
                <select value={draft.apiKind} onChange={(event) => setDraft({ ...draft, apiKind: event.target.value })}>
                  {API_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="settings-field"><span>API 地址</span>
                <input value={draft.canonicalOrigin} placeholder="https://api.example.com"
                  onChange={(event) => setDraft({ ...draft, canonicalOrigin: event.target.value })} />
              </label>
              <label className="settings-field"><span>API Key</span>
                <div className="settings-secret-field"><KeyRound size={17} />
                  <input type="password" autoComplete="off" value={draft.credentialValue}
                    disabled={!canWriteSecret}
                    placeholder={!canWriteSecret
                      ? "局域网浏览器不能新增或更换 API Key"
                      : editingId ? "留空则保持现有密钥" : "留空表示这个地址不需要密钥"}
                    onChange={(event) => setDraft({ ...draft, credentialValue: event.target.value })} />
                </div>
              </label>

              <section className="provider-dialog-models">
                <div className="settings-subsection__heading">
                  <div><h4>模型</h4><p>填写用户看到的名称和供应商要求的模型 ID。</p></div>
                </div>
                <div className="provider-dialog-models__list">
                  {modelDrafts.map((model, index) => (
                    <div className="provider-dialog-model-row" key={model.key}>
                      <input aria-label={`模型 ${index + 1} 显示名称`} value={model.displayName}
                        placeholder="显示名称"
                        onChange={(event) => setModelDrafts((current) => current.map((item) =>
                          item.key === model.key ? { ...item, displayName: event.target.value } : item))} />
                      <input aria-label={`模型 ${index + 1} ID`} value={model.modelId}
                        placeholder="模型 ID，例如 deepseek-v4-pro"
                        onChange={(event) => setModelDrafts((current) => current.map((item) =>
                          item.key === model.key ? { ...item, modelId: event.target.value } : item))} />
                      <button className="settings-icon-button" type="button" aria-label={`移除模型 ${index + 1}`}
                        onClick={() => setModelDrafts((current) => current.filter((item) => item.key !== model.key))}>
                        <X size={17} />
                      </button>
                    </div>
                  ))}
                </div>
                <button className="settings-button settings-button--quiet" type="button"
                  onClick={() => setModelDrafts((current) => [...current, {
                    key: crypto.randomUUID(),
                    displayName: "",
                    modelId: "",
                  }])}>
                  <Plus size={16} />添加模型
                </button>
              </section>
            </div>
            <footer>
              <button className="settings-button settings-button--secondary" type="button" onClick={() => setShowDialog(false)}>取消</button>
              <button className="settings-button settings-button--primary" type="button"
                disabled={busy === "save" || !draft.displayName || !draft.canonicalOrigin}
                onClick={() => void saveProvider()}>
                {busy === "save" ? "保存中…" : "保存"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
