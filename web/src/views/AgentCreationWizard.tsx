import { useEffect, useMemo, useState } from "react";
import { Bot, Check, ChevronLeft, ChevronRight, KeyRound, RefreshCw, Server, Sparkles, Upload, X } from "lucide-react";
import { useStore } from "../store.tsx";
import { useToast } from "../toast.tsx";
import {
  bindRuntimeDefaultModel,
  completeAgentOnboarding,
  createOnboardingAgent,
  createOnboardingModel,
  loadOnboardingModelConfigurations,
  loadOnboardingRuntimes,
  type OnboardingModelConfiguration,
  type OnboardingPiImportProvider,
  type OnboardingRuntime,
} from "../agentOnboarding.ts";
import {
  adoptLocalModel,
  loadLocalRuntimeConfig,
  type LocalConfigIssue,
  type LocalProvider,
  type LocalRuntimeConfig,
} from "../data/localRuntimeConfig.ts";
import "./AgentCreationWizard.css";

interface AgentCreationWizardProps {
  api: (method: string, path: string, body?: unknown) => Promise<any>;
  onClose(): void;
  /** onboarding: 首次进入 Home 的一次性向导；create: Agents 页面的常规创建弹窗。 */
  mode: "onboarding" | "create";
  prefill?: { name?: string; description?: string };
  onCreated?: (r: { id: string; name: string }) => void;
}

type ModelConfigTab = "local" | "existing" | "new" | "import";

type ModelChoice =
  | { kind: "runtime_default"; label: string }
  | { kind: "pinned"; configurationId: string; configurationRevision: number; label: string };

const API_KIND_LABELS: Record<string, string> = {
  "openai-responses": "OpenAI Responses",
  "openai-completions": "OpenAI 兼容接口",
  "anthropic-messages": "Anthropic Messages",
  "google-generative-ai": "Google Generative AI",
};

/** 与 src/model-control/modelConfigurationService.ts 的 SUPPORTED 保持同步（未知 apiKind 回退到 Pi 家族）。 */
const API_KIND_RUNTIMES: Record<string, readonly string[]> = {
  "anthropic-messages": ["claude", "opencode", "pi", "pi-builtin"],
  "openai-responses": ["codex", "opencode", "pi", "pi-builtin"],
  "openai-completions": ["opencode", "pi", "pi-builtin"],
  "google-generative-ai": ["opencode", "pi", "pi-builtin"],
};

const V2_RUNTIMES = new Set(["claude", "codex", "opencode", "pi", "pi-builtin"]);

const STEPS = ["选择运行时", "配置模型", "创建 Agent"];

const DRAFT_KEY = "kith-agent-create-draft";

export function AgentCreationWizard({ api, onClose, mode, prefill, onCreated }: AgentCreationWizardProps) {
  const isCreate = mode === "create";
  const storeReload = useStore().reload;
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [runtimes, setRuntimes] = useState<OnboardingRuntime[]>([]);
  const [runtimesLoading, setRuntimesLoading] = useState(true);
  const [runtimeId, setRuntimeId] = useState("");
  const [runtimeError, setRuntimeError] = useState("");

  const [modelTab, setModelTab] = useState<ModelConfigTab>(isCreate ? "local" : "new");
  const [existingModels, setExistingModels] = useState<OnboardingModelConfiguration[]>([]);
  const [existingModelId, setExistingModelId] = useState("");
  const [runtimeDefaultLabel, setRuntimeDefaultLabel] = useState<string | null>(null);
  const [runtimeDefaultLoading, setRuntimeDefaultLoading] = useState(false);
  const [localProviders, setLocalProviders] = useState<LocalProvider[]>([]);
  const [localProvidersLoading, setLocalProvidersLoading] = useState(false);
  const [localProvidersError, setLocalProvidersError] = useState("");
  /** 运行器没有本机配置适配器时的说明，与「读到了但是空的」区分开。 */
  const [localUnsupported, setLocalUnsupported] = useState("");
  /** 本机配置的主文件路径与读取过程中的非致命问题，用于界面显示「读自 xxx」。 */
  const [localConfigMeta, setLocalConfigMeta] = useState<{ primaryPath: string; issues: LocalConfigIssue[] } | null>(null);
  const [localSelection, setLocalSelection] = useState<{ providerId: string; modelId: string } | null>(null);
  const [piImport, setPiImport] = useState<{
    providers: OnboardingPiImportProvider[];
    warnings: string[];
    sourceMtimeDigest: string;
  } | null>(null);
  const [piImportLoading, setPiImportLoading] = useState(false);
  const [piImportError, setPiImportError] = useState("");
  const [importSelection, setImportSelection] = useState<{ providerId: string; modelId: string } | null>(null);

  const [manualDraft, setManualDraft] = useState({
    displayName: "",
    backendId: "",
    apiKind: "openai-completions",
    canonicalOrigin: "",
    credentialValue: "",
    modelId: "",
  });

  const [modelBusy, setModelBusy] = useState("");
  const [modelError, setModelError] = useState("");
  const [modelChoice, setModelChoice] = useState<ModelChoice | null>(null);

  const [agentDraft, setAgentDraft] = useState({
    name: prefill?.name ?? (isCreate ? "" : "assistant"),
    displayName: prefill?.name ?? (isCreate ? "" : "助手"),
    description: prefill?.description ?? "",
  });
  const [fast, setFast] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentError, setAgentError] = useState("");

  const selectedRuntimeIsV2 = V2_RUNTIMES.has(runtimeId);

  useEffect(() => {
    let cancelled = false;
    loadOnboardingRuntimes(api)
      .then((available) => {
        if (cancelled) return;
        const ordered = [...available].sort((left, right) =>
          Number(right.builtIn ?? false) - Number(left.builtIn ?? false));
        setRuntimes(ordered);
        const draftRuntime = isCreate
          ? JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null")?.runtime
          : null;
        const preferred = (typeof draftRuntime === "string"
          ? ordered.find((item) => item.id === draftRuntime && item.installed)
          : undefined)
          ?? ordered.find((item) => item.id === "pi-builtin" && item.installed)
          ?? ordered.find((item) => item.installed);
        setRuntimeId(preferred?.id ?? "");
        setRuntimeError(preferred ? "" : "没有检测到可用的运行时");
      })
      .catch(() => { if (!cancelled) setRuntimeError("无法检测本机运行时"); })
      .finally(() => { if (!cancelled) setRuntimesLoading(false); });
    if (isCreate) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null");
        if (saved) {
          setAgentDraft((current) => ({
            name: prefill?.name ?? (typeof saved.name === "string" && saved.name ? saved.name : current.name),
            displayName: prefill?.name ?? (typeof saved.displayName === "string" && saved.displayName ? saved.displayName : current.displayName),
            description: prefill?.description ?? (typeof saved.description === "string" ? saved.description : current.description),
          }));
        }
      } catch { /* ignore stale draft */ }
    }
    return () => { cancelled = true; };
  }, [api, isCreate, prefill?.name, prefill?.description]);

  useEffect(() => {
    if (isCreate) {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        name: agentDraft.name, displayName: agentDraft.displayName, description: agentDraft.description, runtime: runtimeId,
      }));
    }
  }, [agentDraft, isCreate, runtimeId]);

  // The create flow needs the existing model configurations for both the
  // "follow runtime default" hint and the "pick an existing model" tab.
  useEffect(() => {
    if (!isCreate || step !== 1) return;
    let cancelled = false;
    setExistingModels([]);
    setExistingModelId("");
    loadOnboardingModelConfigurations(api)
      .then((items) => { if (!cancelled) setExistingModels(items.filter((item) => item.status !== "disabled")); })
      .catch(() => { if (!cancelled) setModelError("无法读取已有模型配置"); });
    return () => { cancelled = true; };
  }, [api, isCreate, step, runtimeId]);

  /**
   * 把服务端读到的本机配置铺进界面状态，并默认选中第一个「带模型」的供应商。
   * 跳过 models 为空的供应商：Pi 的 models-store.json 可能缓存了一个还没拉过模型列表的
   * 供应商，把它选中会让「使用这个模型」按钮永远点不动。
   */
  const applyLocalConfig = (config: LocalRuntimeConfig) => {
    setLocalProviders(config.providers);
    setLocalConfigMeta({ primaryPath: config.primaryPath, issues: config.issues });
    const firstWithModel = config.providers.find((provider) => provider.models.length > 0);
    if (firstWithModel) {
      const preferred = firstWithModel.defaultModelId
        && firstWithModel.models.some((model) => model.id === firstWithModel.defaultModelId)
        ? firstWithModel.defaultModelId
        : firstWithModel.models[0]!.id;
      setLocalSelection({ providerId: firstWithModel.id, modelId: preferred });
    } else {
      setLocalSelection(null);
    }
  };

  // Load local runtime providers (from config files)
  useEffect(() => {
    if (step !== 1 || !runtimeId) return;
    let cancelled = false;
    setLocalProviders([]);
    setLocalSelection(null);
    setLocalUnsupported("");
    setLocalConfigMeta(null);
    setLocalProvidersLoading(true);
    setLocalProvidersError("");
    loadLocalRuntimeConfig(api, runtimeId)
      .then((result) => {
        if (cancelled) return;
        if (!result.supported) {
          setLocalUnsupported(result.reason);
          return;
        }
        applyLocalConfig(result.config);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Failed to load local runtime config:", error);
          setLocalProvidersError("无法读取本机配置");
        }
      })
      .finally(() => { if (!cancelled) setLocalProvidersLoading(false); });
    return () => { cancelled = true; };
  }, [api, step, runtimeId]);

  // Runtime-default state drives the "follow default" option in create mode.
  useEffect(() => {
    if (!isCreate || step !== 1 || !runtimeId) return;
    if (!selectedRuntimeIsV2) {
      setRuntimeDefaultLabel(null);
      return;
    }
    let cancelled = false;
    setRuntimeDefaultLoading(true);
    void api("GET", `/api/settings/runtimes/${encodeURIComponent(runtimeId)}`)
      .then(async (profile: any) => {
        const binding = profile?.defaultBinding;
        if (binding?.mode === "kith_model_configuration" && binding.modelConfigurationId) {
          const configurations = existingModels.length ? existingModels : await loadOnboardingModelConfigurations(api);
          const match = configurations.find((item) => item.id === binding.modelConfigurationId);
          if (!cancelled) setRuntimeDefaultLabel(match ? `${match.displayName} · ${match.provider.backendId}` : "已配置（模型已删除）");
        } else if (!cancelled) {
          setRuntimeDefaultLabel(null);
        }
      })
      .catch(() => { if (!cancelled) setRuntimeDefaultLabel(null); })
      .finally(() => { if (!cancelled) setRuntimeDefaultLoading(false); });
    return () => { cancelled = true; };
  }, [api, existingModels, isCreate, runtimeId, selectedRuntimeIsV2, step]);

  useEffect(() => {
    if (step !== 1 || modelTab !== "new" || !runtimeId) return;
    // Initialize manual draft with runtime-appropriate API kind
    const preferredApiKind = selectedRuntimeIsV2 ? "openai-completions" : "openai-completions";
    setManualDraft((current) => ({ ...current, apiKind: preferredApiKind }));
  }, [step, modelTab, runtimeId, selectedRuntimeIsV2]);

  // Reset model tab if current tab becomes invalid after runtime change
  useEffect(() => {
    const isPiRuntime = runtimeId === "pi" || runtimeId === "pi-builtin";
    if (modelTab === "import" && !isPiRuntime) {
      setModelTab(isCreate ? "existing" : "new");
    }
  }, [runtimeId, modelTab, isCreate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const existingModelOptions = useMemo(
    () => existingModels.filter((item) => item.compatibility?.[runtimeId]?.supported),
    [existingModels, runtimeId],
  );
  const selectedExistingModel = existingModelOptions.find((item) => item.id === existingModelId);
  const localModelCount = useMemo(
    () => localProviders.reduce((total, provider) => total + provider.models.length, 0),
    [localProviders],
  );
  const selectedLocalProvider = localProviders.find((item) => item.id === localSelection?.providerId);
  const selectedLocalModel = selectedLocalProvider?.models.find((item) => item.id === localSelection?.modelId);

  const startPiImportPreview = () => {
    setPiImportError("");
    setPiImportLoading(true);
    setPiImport(null);
    void api("POST", "/api/settings/pi-config-import/preview", {})
      .then((result) => {
        setPiImport(result as any);
        const first = (result?.providers ?? [])[0] as OnboardingPiImportProvider | undefined;
        if (first) setImportSelection({ providerId: first.backendId, modelId: first.models[0]?.id ?? "" });
      })
      .catch((cause: any) => setPiImportError(cause?.message ?? "无法读取本机 Pi 配置"))
      .finally(() => setPiImportLoading(false));
  };

  const finishModelStep = async (configurationId: string, configurationRevision: number, label: string) => {
    setModelBusy("bind");
    setModelError("");
    try {
      if (isCreate) {
        // Pin the new configuration to this Agent instead of changing the
        // runtime-wide default other Agents may already follow.
        setModelChoice({ kind: "pinned", configurationId, configurationRevision, label });
      } else {
        await bindRuntimeDefaultModel(api, { runtimeId, configurationId, configurationRevision });
        setModelChoice({ kind: "runtime_default", label });
      }
    } catch (cause: any) {
      setModelError(cause?.message ?? "无法把模型设为该运行时的默认配置");
    } finally {
      setModelBusy("");
    }
  };

  const useExistingModel = () => {
    if (!selectedExistingModel) return;
    setModelChoice({
      kind: "pinned",
      configurationId: selectedExistingModel.id,
      configurationRevision: selectedExistingModel.currentRevision,
      label: `${selectedExistingModel.displayName} · ${selectedExistingModel.provider.backendId}`,
    });
  };

  /**
   * 本机配置里的「供应商 + 模型」不是数据库里的模型配置，Agent 绑定需要真实的
   * configurationId，所以这里必须走 adopt 接口让服务端落库，不能前端自己拼 id。
   */
  const useLocalModel = async () => {
    if (!localSelection || !runtimeId) return;
    const provider = localProviders.find((item) => item.id === localSelection.providerId);
    const model = provider?.models.find((item) => item.id === localSelection.modelId);
    if (!provider || !model) return;
    setModelBusy("local");
    setModelError("");
    try {
      const adopted = await adoptLocalModel(api, {
        runtimeId,
        providerId: provider.id,
        modelId: model.id,
      });
      setModelChoice({
        kind: "pinned",
        configurationId: adopted.configurationId,
        configurationRevision: adopted.configurationRevision,
        label: adopted.displayName,
      });
      if (adopted.credentialNotice) {
        toast.info(adopted.credentialNotice);
      }
    } catch (error) {
      const cause = error as { message?: string };
      setModelError(cause?.message ?? "无法采用这个本机模型");
    } finally {
      setModelBusy("");
    }
  };

  const refreshLocalProviders = () => {
    if (!runtimeId) return;
    setLocalProvidersLoading(true);
    setLocalProvidersError("");
    setLocalUnsupported("");
    loadLocalRuntimeConfig(api, runtimeId)
      .then((result) => {
        if (!result.supported) {
          setLocalProviders([]);
          setLocalConfigMeta(null);
          setLocalSelection(null);
          setLocalUnsupported(result.reason);
          return;
        }
        applyLocalConfig(result.config);
      })
      .catch((error) => {
        console.error("Failed to refresh local runtime config:", error);
        setLocalProvidersError("无法刷新本机配置");
      })
      .finally(() => setLocalProvidersLoading(false));
  };

  const applyPiImportAndSelect = async () => {
    if (!piImport || !importSelection) return;
    setModelBusy("import");
    setModelError("");
    try {
      await api("POST", "/api/settings/pi-config-import/apply", {
        sourceMtimeDigest: piImport.sourceMtimeDigest,
      });
      const configurations = await loadOnboardingModelConfigurations(api);
      const match = configurations.find((item) =>
        item.provider.backendId === importSelection.providerId && item.modelId === importSelection.modelId);
      if (!match) throw new Error("导入完成，但没有找到所选模型配置");
      await finishModelStep(match.id, match.currentRevision, importSelection.modelId);
    } catch (cause: any) {
      setModelError(cause?.message ?? "Pi 配置导入失败");
    } finally {
      setModelBusy("");
    }
  };

  const useManualModel = async () => {
    const draft = manualDraft;
    if (!draft.backendId.trim() || !draft.canonicalOrigin.trim() || !draft.modelId.trim()) {
      setModelError("请填写供应商 ID、API 地址和模型 ID");
      return;
    }
    setModelBusy("new");
    setModelError("");
    try {
      const created = await createOnboardingModel(api, {
        displayName: draft.displayName.trim() || draft.backendId.trim(),
        backendId: draft.backendId.trim(),
        apiKind: draft.apiKind,
        canonicalOrigin: draft.canonicalOrigin.trim(),
        ...(draft.credentialValue ? { credentialValue: draft.credentialValue } : {}),
        modelId: draft.modelId.trim(),
      });
      await finishModelStep(created.configurationId, created.configurationRevision, draft.modelId.trim());
    } catch (cause: any) {
      setModelError(cause?.message ?? "无法保存模型配置");
    } finally {
      setModelBusy("");
    }
  };

  const createAgent = async () => {
    const name = agentDraft.name.trim();
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name) || name.length > 64) {
      setAgentError("名称需以字母开头，仅含字母、数字、- 和 _（最长 64 字符）");
      return;
    }
    setAgentBusy(true);
    setAgentError("");
    try {
      const result = await createOnboardingAgent(api, {
        name,
        displayName: agentDraft.displayName.trim() || name,
        description: agentDraft.description.trim(),
        runtime: runtimeId,
        modelBinding: modelChoice?.kind === "pinned"
          ? {
            mode: "pinned",
            modelConfigurationId: modelChoice.configurationId,
            modelConfigurationRevision: modelChoice.configurationRevision,
          }
          : { mode: "runtime_default" },
        fastMode: fast,
      });
      if (result?.error) {
        setAgentError(result.code === "model_binding_setup_required"
          ? "所选运行时还没有默认模型，请返回上一步为其指定模型。"
          : String(result.error));
        setAgentBusy(false);
        return;
      }
      if (isCreate) {
        await storeReload();
        if (result?.started === false) toast.info("Agent 已创建，运行器暂不可用，稍后会自动启动。");
        onCreated?.({ id: result.id, name: result.name ?? name });
        sessionStorage.removeItem(DRAFT_KEY);
      } else {
        await completeAgentOnboarding(api);
      }
      onClose();
    } catch (cause: any) {
      setAgentError(cause?.message ?? "无法创建 Agent");
      setAgentBusy(false);
    }
  };

  const skip = async () => {
    if (mode === "onboarding") {
      try { await completeAgentOnboarding(api); } catch { /* stay dismissible locally */ }
    }
    onClose();
  };

  const canNext = step === 0
    ? Boolean(runtimeId)
    : step === 1
      ? Boolean(modelChoice) || (isCreate && !selectedRuntimeIsV2)
      : Boolean(agentDraft.name.trim() && agentDraft.displayName.trim());

  const isPiRuntime = runtimeId === "pi" || runtimeId === "pi-builtin";
  const tabs: Array<[ModelConfigTab, string]> = isCreate
    ? [
        ["local", "使用本机配置"],
        ["existing", "使用现有配置"],
        ["new", "添加新配置"],
        ...(isPiRuntime ? [["import", "导入本地配置"] as [ModelConfigTab, string]] : []),
      ]
    : [
        ["new", "添加新配置"],
        ...(isPiRuntime ? [["import", "导入本地配置"] as [ModelConfigTab, string]] : []),
      ];

  return (
    <div className="onboarding-backdrop" role="presentation" onClick={skip}>
      <section className="onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="onboarding-title"
        onClick={(event) => event.stopPropagation()}>
        <header className="onboarding-header">
          <div>
            <p className="onboarding-eyebrow"><Sparkles size={14} />{isCreate ? "创建 Agent" : "首次引导"}</p>
            <h2 id="onboarding-title">{isCreate ? "创建 Agent" : "创建你的第一个 Agent"}</h2>
            <p>{isCreate ? "选择运行时和模型，然后为它命名。" : "即使本机没有安装 Claude Code 等工具，内置的 Pi Agent 也能直接开工。"}</p>
          </div>
          <button className="onboarding-icon-button" type="button" aria-label="关闭" onClick={() => void skip()}>
            <X size={18} />
          </button>
        </header>

        <ol className="onboarding-steps" aria-label="步骤">
          {STEPS.map((label, index) => (
            <li key={label} className={index < step ? "done" : index === step ? "current" : ""}>
              <span className="onboarding-step-dot">{index < step ? <Check size={12} /> : index + 1}</span>
              {label}
            </li>
          ))}
        </ol>

        <div className="onboarding-body">
          {step === 0 ? (
            <section>
              <h3>选择运行时</h3>
              <p className="onboarding-hint">运行时是 Agent 的执行引擎。内置 Pi Agent 随 Kith-space 一起安装，随时可用。</p>
              {runtimesLoading ? <p className="onboarding-muted">正在检测本机运行时…</p> : (
                <>
                  <label className="onboarding-field"><span>运行时</span>
                    <select value={runtimeId} onChange={(event) => { setRuntimeId(event.target.value); setModelChoice(null); }}>
                      {runtimes.map((runtime) => (
                        <option key={runtime.id} value={runtime.id} disabled={!runtime.installed}>
                          {runtime.label}{runtime.builtIn ? "（内置）" : runtime.installed ? "" : " — 未安装"}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(() => {
                    const runtime = runtimes.find((item) => item.id === runtimeId);
                    if (!runtime) return null;
                    return (
                      <div className="onboarding-runtime-card selected" aria-live="polite">
                        <span className="onboarding-runtime-logo"><Bot size={18} /></span>
                        <span className="onboarding-runtime-main">
                          <strong>{runtime.label}</strong>
                          <small>{runtime.installed ? "已可用" : "未安装"}</small>
                        </span>
                        {runtime.builtIn ? <span className="onboarding-badge">内置 · 推荐</span> : null}
                      </div>
                    );
                  })()}
                </>
              )}
              {runtimeError ? <p className="onboarding-error" role="alert">{runtimeError}</p> : null}
            </section>
          ) : null}

          {step === 1 ? (
            <section>
              <h3>配置模型</h3>
              <p className="onboarding-hint">
                {isCreate && !selectedRuntimeIsV2
                  ? "此运行时使用自身的本机配置，无需在这里选择模型。"
                  : isCreate
                    ? `为「${runtimes.find((item) => item.id === runtimeId)?.label ?? runtimeId}」选择模型。`
                    : `为「${runtimes.find((item) => item.id === runtimeId)?.label ?? runtimeId}」选择默认模型。`}
              </p>

              {isCreate && !selectedRuntimeIsV2 ? (
                <p className="onboarding-muted">直接进入下一步即可；如需调整，请在对应 CLI 的配置中修改。</p>
              ) : (
                <>
                  {isCreate ? (
                    <div className="onboarding-default-follow">
                      <button type="button"
                        className={`onboarding-follow-card${modelChoice?.kind === "runtime_default" ? " selected" : ""}`}
                        disabled={runtimeDefaultLoading || !runtimeDefaultLabel}
                        onClick={() => setModelChoice({ kind: "runtime_default", label: runtimeDefaultLabel! })}>
                        <span className="onboarding-runtime-logo"><Server size={16} /></span>
                        <span className="onboarding-runtime-main">
                          <strong>跟随运行器默认</strong>
                          <small>{runtimeDefaultLoading ? "检查中…" : runtimeDefaultLabel ?? "尚未设置默认模型"}</small>
                        </span>
                        {modelChoice?.kind === "runtime_default" ? <span className="onboarding-badge">已选</span> : null}
                      </button>
                      <p className="onboarding-muted">或为这个 Agent 单独指定一个模型：</p>
                    </div>
                  ) : null}

                  <div className="onboarding-tabs" role="tablist">
                    {tabs.map(([value, label]) => (
                      <button key={value} type="button" role="tab" aria-selected={modelTab === value}
                        className={modelTab === value ? "active" : ""} onClick={() => { setModelTab(value); setModelChoice(null); }}>
                        {label}
                      </button>
                    ))}
                  </div>

                  {modelTab === "local" ? (
                    <div className="onboarding-model-panel">
                      {localProvidersLoading ? (
                        <p className="onboarding-muted">正在读取本机配置...</p>
                      ) : localProviders.length > 0 ? (
                        <>
                          <div className="onboarding-field" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <p className="onboarding-muted" style={{ margin: 0, flex: 1 }}>
                              读到 {localProviders.length} 个供应商、{localModelCount} 个可用模型
                              {localConfigMeta ? ` · ${localConfigMeta.primaryPath}` : ""}
                            </p>
                            <button
                              type="button"
                              className="onboarding-icon-button"
                              onClick={refreshLocalProviders}
                              disabled={localProvidersLoading}
                              title="刷新本机配置"
                            >
                              <RefreshCw size={16} />
                            </button>
                          </div>
                          <label className="onboarding-field"><span>供应商</span>
                            <select value={localSelection?.providerId ?? ""}
                              onChange={(event) => {
                                const provider = localProviders.find((p) => p.id === event.target.value);
                                setLocalSelection({
                                  providerId: event.target.value,
                                  modelId: provider?.models[0]?.id ?? "",
                                });
                              }}>
                              {localProviders.map((provider) => (
                                <option key={provider.id} value={provider.id}>
                                  {provider.displayName}
                                  {provider.models.length ? `（${provider.models.length} 个模型）` : "（未缓存模型）"}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="onboarding-field"><span>模型</span>
                            <select value={localSelection?.modelId ?? ""} disabled={!selectedLocalProvider?.models.length}
                              onChange={(event) => setLocalSelection((current) =>
                                current ? { ...current, modelId: event.target.value } : current)}>
                              {selectedLocalProvider?.models.length ? (
                                selectedLocalProvider.models.map((model) => (
                                  <option key={model.id} value={model.id}>
                                    {model.tierLabel ? `${model.tierLabel} · ` : ""}{model.displayName || model.id}
                                  </option>
                                ))
                              ) : (
                                <option value="">该供应商的配置文件里没有模型列表</option>
                              )}
                            </select>
                          </label>
                          {selectedLocalProvider ? (
                            <div className="onboarding-model-info">
                              {selectedLocalProvider.baseUrl
                                ? <p><strong>API 地址：</strong>{selectedLocalProvider.baseUrl}</p>
                                : null}
                              {selectedLocalProvider.apiFormat
                                ? <p><strong>接口类型：</strong>{selectedLocalProvider.apiFormat}</p>
                                : null}
                              <p><strong>密钥：</strong>
                                {selectedLocalProvider.credential.configured
                                  ? `已在本机配置${selectedLocalProvider.credential.source ? `（${selectedLocalProvider.credential.source}）` : ""}`
                                  : "本机配置里没有密钥，采用后可能需要单独填写"}
                              </p>
                              {selectedLocalModel?.contextWindow
                                ? <p><strong>上下文窗口：</strong>{selectedLocalModel.contextWindow.toLocaleString()}</p>
                                : null}
                              {selectedLocalProvider.sourcePaths.length
                                ? <p className="onboarding-muted">读自 {selectedLocalProvider.sourcePaths.join("、")}</p>
                                : null}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="onboarding-import-empty">
                          <Server size={18} />
                          {localUnsupported ? (
                            <p>{localUnsupported}</p>
                          ) : (
                            <>
                              <p>
                                本机配置里还没有可用的供应商
                                {localConfigMeta ? `（已检查 ${localConfigMeta.primaryPath}）` : ""}
                                。可以先在运行器里配置好，或切换到其他 Tab 手动添加。
                              </p>
                              <button type="button" className="onboarding-secondary-button"
                                onClick={refreshLocalProviders} disabled={localProvidersLoading}>
                                <RefreshCw size={14} /> 重新读取
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      {localConfigMeta?.issues.length ? (
                        <ul className="onboarding-muted" style={{ margin: "8px 0 0", paddingLeft: "18px" }}>
                          {localConfigMeta.issues.map((issue) => (
                            <li key={`${issue.kind}:${issue.path}`}>{issue.message}</li>
                          ))}
                        </ul>
                      ) : null}
                      {localProvidersError ? <p className="onboarding-error" role="alert">{localProvidersError}</p> : null}
                    </div>
                  ) : null}

                  {modelTab === "existing" ? (
                    <div className="onboarding-model-panel">
                      <label className="onboarding-field"><span>已有模型配置</span>
                        <select value={existingModelId} disabled={!existingModelOptions.length}
                          onChange={(event) => setExistingModelId(event.target.value)}>
                          <option value="">{existingModelOptions.length ? "选择模型…" : "暂无兼容的模型配置"}</option>
                          {existingModelOptions.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.displayName} · {item.provider.backendId}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ) : null}

                  {modelTab === "import" ? (
                    <div className="onboarding-model-panel">
                      {piImport ? (
                        <>
                          <p className="onboarding-muted">发现 {piImport.providers.length} 个本机 Pi 配置中的供应商，选择要使用的模型后导入。</p>
                          <label className="onboarding-field"><span>供应商</span>
                            <select value={importSelection?.providerId ?? ""}
                              onChange={(event) => {
                                const provider = piImport.providers.find((item) => item.backendId === event.target.value);
                                setImportSelection({ providerId: event.target.value, modelId: provider?.models[0]?.id ?? "" });
                              }}>
                              {piImport.providers.map((provider) => (
                                <option key={provider.backendId} value={provider.backendId}>{provider.backendId}</option>
                              ))}
                            </select>
                          </label>
                          <label className="onboarding-field"><span>模型</span>
                            <select value={importSelection?.modelId ?? ""}
                              onChange={(event) => setImportSelection((current) =>
                                current ? { ...current, modelId: event.target.value } : current)}>
                              {(piImport.providers.find((item) => item.backendId === importSelection?.providerId)?.models ?? [])
                                .map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}
                            </select>
                          </label>
                          {piImport.warnings.length ? (
                            <ul className="onboarding-warnings">
                              {piImport.warnings.slice(0, 6).map((warning) => <li key={warning}>{warning}</li>)}
                            </ul>
                          ) : null}
                        </>
                      ) : (
                        <div className="onboarding-import-empty">
                          <Upload size={18} />
                          <p>读取 ~/.pi/agent 中的供应商、模型与凭据。不会执行命令式凭据，也不会写回任何 Pi 配置。</p>
                        </div>
                      )}
                      {piImportError ? <p className="onboarding-error" role="alert">{piImportError}</p> : null}
                    </div>
                  ) : null}

                  {modelTab === "new" ? (
                    <div className="onboarding-model-panel">
                      <label className="onboarding-field"><span>供应商 ID</span>
                        <input value={manualDraft.backendId} placeholder="例如 my-provider"
                          onChange={(event) => setManualDraft({ ...manualDraft, backendId: event.target.value })} />
                      </label>
                      <label className="onboarding-field"><span>接口类型</span>
                        <select value={manualDraft.apiKind}
                          onChange={(event) => setManualDraft({ ...manualDraft, apiKind: event.target.value })}>
                          {Object.entries(API_KIND_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="onboarding-field"><span>API 地址</span>
                        <input value={manualDraft.canonicalOrigin} placeholder="https://api.example.com"
                          onChange={(event) => setManualDraft({ ...manualDraft, canonicalOrigin: event.target.value })} />
                      </label>
                      <label className="onboarding-field"><span>API Key <small>（可选）</small></span>
                        <input type="password" autoComplete="off" value={manualDraft.credentialValue}
                          placeholder="留空表示无需密钥或稍后再填"
                          onChange={(event) => setManualDraft({ ...manualDraft, credentialValue: event.target.value })} />
                      </label>
                      <label className="onboarding-field"><span>模型 ID</span>
                        <input value={manualDraft.modelId} placeholder="例如 deepseek-v4-pro"
                          onChange={(event) => setManualDraft({ ...manualDraft, modelId: event.target.value })} />
                      </label>
                    </div>
                  ) : null}

                  {modelError ? <p className="onboarding-error" role="alert">{modelError}</p> : null}
                  {modelChoice ? (
                    <p className="onboarding-success" role="status">
                      <Check size={14} />
                      {modelChoice.kind === "runtime_default"
                        ? <>将跟随运行器默认模型：<strong>{modelChoice.label}</strong></>
                        : <>将为这个 Agent 固定模型：<strong>{modelChoice.label}</strong>，可以进入下一步。</>}
                    </p>
                  ) : (
                    <div className="onboarding-model-actions">
                      {modelTab === "local" ? (
                        <button className="onboarding-button onboarding-button--primary" type="button"
                          disabled={Boolean(modelBusy) || !selectedLocalModel} onClick={() => void useLocalModel()}>
                          {modelBusy === "local" ? "采用中…" : "使用此模型"}
                        </button>
                      ) : null}
                      {modelTab === "existing" ? (
                        <button className="onboarding-button onboarding-button--primary" type="button"
                          disabled={Boolean(modelBusy) || !selectedExistingModel} onClick={useExistingModel}>
                          使用此模型
                        </button>
                      ) : null}
                      {modelTab === "new" ? (
                        <button className="onboarding-button onboarding-button--primary" type="button"
                          disabled={Boolean(modelBusy)} onClick={() => void useManualModel()}>
                          {modelBusy === "new" ? "保存中…" : modelBusy === "bind" ? "绑定中…" : "使用此模型"}
                        </button>
                      ) : null}
                      {modelTab === "import" ? (
                        <button className="onboarding-button onboarding-button--primary" type="button"
                          disabled={Boolean(modelBusy) || piImportLoading || (Boolean(piImport) && !importSelection)}
                          onClick={() => (piImport ? void applyPiImportAndSelect() : startPiImportPreview())}>
                          {piImportLoading ? "读取中…" : piImport ? (modelBusy ? "导入中…" : "导入并选择此模型") : "读取本机 Pi 配置"}
                        </button>
                      ) : null}
                    </div>
                  )}
                </>
              )}
            </section>
          ) : null}

          {step === 2 ? (
            <section>
              <h3>创建 Agent</h3>
              <p className="onboarding-hint">{isCreate ? "Agent 将加入当前 Space 的 #all 频道，随时可以 @ 它。" : "Agent 将加入 Home Space 的 #all 频道，随时可以 @ 它。"}</p>
              <label className="onboarding-field"><span>名称（英文标识）</span>
                <input value={agentDraft.name} maxLength={64} autoFocus
                  onChange={(event) => setAgentDraft({ ...agentDraft, name: event.target.value })} />
              </label>
              <label className="onboarding-field"><span>显示名称</span>
                <input value={agentDraft.displayName} maxLength={64}
                  onChange={(event) => setAgentDraft({ ...agentDraft, displayName: event.target.value })} />
              </label>
              <label className="onboarding-field"><span>职责描述 <small>（可选）</small></span>
                <textarea rows={3} maxLength={3000} value={agentDraft.description}
                  placeholder="例如：负责整理笔记、起草文档和跟进任务"
                  onChange={(event) => setAgentDraft({ ...agentDraft, description: event.target.value })} />
              </label>
              <div className="onboarding-summary">
                <p><Server size={14} />运行时：{runtimes.find((item) => item.id === runtimeId)?.label ?? runtimeId}</p>
                <p><Check size={14} />模型：
                  {modelChoice?.kind === "pinned"
                    ? `固定 ${modelChoice.label}`
                    : modelChoice?.kind === "runtime_default"
                      ? `跟随运行器默认（${modelChoice.label}）`
                      : isCreate && !selectedRuntimeIsV2 ? "使用运行时本机配置" : "未选择"}
                </p>
              </div>
              {isCreate ? (
                <label className="onboarding-field onboarding-fast-row">
                  <input type="checkbox" checked={fast} onChange={(event) => setFast(event.target.checked)} />
                  <span>快速模式 <small>（跳过深度思考，更快响应）</small></span>
                </label>
              ) : null}
              {agentError ? <p className="onboarding-error" role="alert">{agentError}</p> : null}
            </section>
          ) : null}
        </div>

        <footer className="onboarding-footer">
          <button className="onboarding-button" type="button" onClick={() => void skip()}>{isCreate ? "取消" : "稍后再说"}</button>
          <div className="onboarding-footer__right">
            {step > 0 ? (
              <button className="onboarding-button" type="button" onClick={() => setStep((current) => current - 1)}>
                <ChevronLeft size={15} />上一步
              </button>
            ) : null}
            {step < 2 ? (
              <button className="onboarding-button onboarding-button--primary" type="button"
                disabled={!canNext || Boolean(modelBusy)} onClick={() => setStep((current) => current + 1)}>
                下一步<ChevronRight size={15} />
              </button>
            ) : (
              <button className="onboarding-button onboarding-button--primary" type="button"
                disabled={!canNext || agentBusy} onClick={() => void createAgent()}>
                {agentBusy ? "创建中…" : "创建 Agent"}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
