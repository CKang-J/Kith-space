import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Braces,
  Check,
  CircleAlert,
  CircleHelp,
  Copy,
  Download,
  RefreshCw,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { getDesktopBridge } from "../../desktopBridge.ts";
import { copyText } from "../../clipboard.ts";
import "./modelSettings.css";

type Api = (method: string, path: string, body?: unknown) => Promise<any>;
type RuntimeId = "claude" | "codex" | "opencode" | "pi";

const RUNTIMES: Array<{ id: RuntimeId; label: string; icon: typeof Bot }> = [
  { id: "claude", label: "Claude Code", icon: Bot },
  { id: "codex", label: "Codex", icon: TerminalSquare },
  { id: "opencode", label: "OpenCode", icon: Braces },
  { id: "pi", label: "Pi", icon: CircleHelp },
];

type SetupSnapshot = {
  runtimeId: RuntimeId;
  label: string;
  summary: string;
  installation: {
    state: "installed" | "not_installed";
    source: "kith_managed" | "system" | null;
    version: string | null;
    executablePath: string | null;
    testedVersion: string;
  };
  account: {
    state: "ready" | "signed_out" | "unknown";
    label: string;
    help: string;
    loginCommand: string;
  };
  managedInstall: {
    packageName: string;
    canInstall: boolean;
    canRemove: boolean;
    restartRequiredAfterChange: boolean;
  };
};

function statusFor(setup?: SetupSnapshot, profile?: any) {
  if (!setup) {
    return { tone: "loading", label: "检查中", icon: RefreshCw };
  }
  if (setup.installation.state === "not_installed") {
    return { tone: "missing", label: "未安装", icon: CircleAlert };
  }
  const usesKithModel = profile?.defaultBinding?.mode === "kith_model_configuration";
  if (setup.account.state === "signed_out" && !usesKithModel) {
    return { tone: "warning", label: "需要登录", icon: CircleAlert };
  }
  if (setup.account.state === "unknown" && !usesKithModel) {
    return { tone: "warning", label: "待确认", icon: CircleHelp };
  }
  return { tone: "ready", label: "可使用", icon: Check };
}

function RuntimeStatusRow({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "ready" | "warning" | "neutral";
}) {
  return (
    <div className="runtime-status-row">
      <span>{label}</span>
      <strong className={`is-${tone}`}>{value}</strong>
    </div>
  );
}

export function RuntimeSettings({ api }: { api: Api }) {
  const desktop = getDesktopBridge() !== null;
  const [profiles, setProfiles] = useState<Record<string, any>>({});
  const [setups, setSetups] = useState<Record<string, SetupSnapshot>>({});
  const [models, setModels] = useState<any[]>([]);
  const [selected, setSelected] = useState<RuntimeId>("claude");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<RuntimeId | null>(null);
  const [restartRequired, setRestartRequired] = useState<Record<string, boolean>>({});

  const reload = async () => {
    const [modelResult, ...results] = await Promise.all([
      api("GET", "/api/settings/model-configurations"),
      ...RUNTIMES.flatMap(({ id }) => [
        api("GET", `/api/settings/runtimes/${id}`),
        api("GET", `/api/settings/runtimes/${id}/setup`),
      ]),
    ]);
    setModels((modelResult.items ?? []).filter((item: any) => item.status === "active"));
    const nextProfiles: Record<string, any> = {};
    const nextSetups: Record<string, SetupSnapshot> = {};
    RUNTIMES.forEach(({ id }, index) => {
      nextProfiles[id] = results[index * 2];
      nextSetups[id] = results[index * 2 + 1];
    });
    setProfiles(nextProfiles);
    setSetups(nextSetups);
  };

  useEffect(() => {
    void reload().catch((cause) => setError(cause?.message ?? "无法读取运行器"));
  }, []);

  const probe = async (runtimeId?: RuntimeId) => {
    setError("");
    setNotice("");
    setBusy(runtimeId ? `probe:${runtimeId}` : "probe:all");
    try {
      const targets = runtimeId ? [runtimeId] : RUNTIMES.map(({ id }) => id);
      await Promise.all(targets.map((id) => api("POST", `/api/settings/runtimes/${id}/probe`, {})));
      await reload();
      setNotice(runtimeId ? "检查完成，状态已更新。" : "所有运行器的状态都已更新。");
    } catch (cause: any) {
      setError(cause?.message ?? "运行器检查失败");
    } finally {
      setBusy("");
    }
  };

  const updateProfile = async (
    runtimeId: RuntimeId,
    changes: { enabled?: boolean; mode?: string; configurationId?: string | null },
  ) => {
    const current = profiles[runtimeId];
    if (!current) return;
    const mode = changes.mode ?? current.defaultBinding?.mode ?? "unset";
    const configurationId = changes.configurationId === undefined
      ? current.defaultBinding?.modelConfigurationId ?? null
      : changes.configurationId;
    const model = models.find((item) => item.id === configurationId);
    setError("");
    setNotice("");
    setBusy(`save:${runtimeId}`);
    try {
      await api("PATCH", `/api/settings/runtimes/${runtimeId}`, {
        enabled: changes.enabled ?? current.enabled,
        defaultBinding: {
          mode,
          modelConfigurationId: mode === "kith_model_configuration" ? configurationId : null,
          modelConfigurationRevision: mode === "kith_model_configuration"
            ? model?.currentRevision ?? current.defaultBinding?.modelConfigurationRevision ?? 1
            : null,
        },
        executablePreference: current.executablePreference ?? null,
        runtimeOptions: current.runtimeOptions ?? {},
      });
      await reload();
      setNotice("设置已保存。已经运行的 Agent 会在重新启动后使用新配置。");
    } catch (cause: any) {
      setError(cause?.message ?? "无法保存运行器设置");
    } finally {
      setBusy("");
    }
  };

  const changeManagedInstall = async (runtimeId: RuntimeId, remove = false) => {
    setError("");
    setNotice("");
    setBusy(`${remove ? "remove" : "install"}:${runtimeId}`);
    try {
      await api(remove ? "DELETE" : "POST", `/api/settings/runtimes/${runtimeId}/setup`, {});
      await reload();
      setRestartRequired((current) => ({ ...current, [runtimeId]: true }));
      setConfirmRemove(null);
      setNotice(remove
        ? "Kith 管理的版本已移除。若本机另有安装，重启桌面端后会自动使用它。"
        : "安装完成。请重启 Kith-space，让本地运行器进程载入新版本。");
    } catch (cause: any) {
      setError(cause?.message ?? (remove ? "无法移除运行器" : "安装失败"));
    } finally {
      setBusy("");
    }
  };

  const copyLoginCommand = async (command: string) => {
    if (await copyText(command)) {
      setNotice(`已复制：${command}`);
    } else {
      setError("无法访问剪贴板，请手动复制登录命令。");
    }
  };

  const currentMeta = RUNTIMES.find((item) => item.id === selected)!;
  const currentProfile = profiles[selected];
  const currentSetup = setups[selected];
  const compatibleModels = useMemo(
    () => models.filter((model) => model.compatibility?.[selected]?.supported),
    [models, selected],
  );
  const binding = currentProfile?.defaultBinding;
  const selectedBinding = binding?.mode === "kith_model_configuration"
    ? binding.modelConfigurationId
    : binding?.mode ?? "unset";
  const currentStatus = statusFor(currentSetup, currentProfile);
  const CurrentIcon = currentMeta.icon;

  return (
    <div className="model-settings model-settings--wide">
      <header className="settings-page-heading">
        <div>
          <h2>运行器</h2>
          <p>安装并连接本机 Agent，然后为它选择默认的模型使用方式。</p>
        </div>
        <button className="settings-button settings-button--secondary" type="button"
          onClick={() => void probe()} disabled={Boolean(busy)}>
          <RefreshCw size={16} className={busy === "probe:all" ? "is-spinning" : ""} />
          {busy === "probe:all" ? "检查中…" : "检查全部"}
        </button>
      </header>

      {error ? <div className="settings-alert settings-alert--error" role="alert">{error}</div> : null}
      {notice ? <div className="settings-alert settings-alert--success" role="status" aria-live="polite">{notice}</div> : null}

      <div className="settings-workbench">
        <aside className="settings-catalog" aria-label="运行器列表">
          <div className="settings-catalog__title">本机 Agent</div>
          <div className="settings-catalog__items">
            {RUNTIMES.map((runtime) => {
              const Icon = runtime.icon;
              const status = statusFor(setups[runtime.id], profiles[runtime.id]);
              const StatusIcon = status.icon;
              return (
                <button type="button" key={runtime.id}
                  className={`settings-catalog-row${selected === runtime.id ? " is-selected" : ""}`}
                  onClick={() => setSelected(runtime.id)} aria-current={selected === runtime.id ? "true" : undefined}>
                  <span className="runtime-logo"><Icon size={19} /></span>
                  <span className="settings-catalog-row__name">{runtime.label}</span>
                  <span className={`settings-status-pill is-${status.tone}`}>
                    <StatusIcon size={13} />{status.label}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="settings-catalog__footnote">Kith 只管理自己安装的副本，不会改写你原有 CLI 的全局配置。</p>
        </aside>

        <section className="settings-detail-panel" aria-label={`${currentMeta.label} 设置`}>
          <header className="runtime-detail-header">
            <div className="runtime-detail-title">
              <span className="runtime-logo runtime-logo--large"><CurrentIcon size={22} /></span>
              <div>
                <h3>{currentMeta.label}</h3>
                <p>{currentSetup?.summary ?? "正在读取本机状态…"}</p>
              </div>
            </div>
            <label className="settings-switch">
              <input type="checkbox" checked={Boolean(currentProfile?.enabled)}
                disabled={!currentProfile || busy === `save:${selected}`}
                onChange={(event) => void updateProfile(selected, { enabled: event.target.checked })} />
              <span aria-hidden="true" />
              <b>{currentProfile?.enabled ? "已启用" : "已停用"}</b>
            </label>
          </header>

          <div className="runtime-overview">
            <div>
              <span className="settings-eyebrow">当前状态</span>
              <strong className={`runtime-overview__state is-${currentStatus.tone}`}>
                {currentStatus.label}
              </strong>
              <p>{!currentSetup
                ? "正在检查安装、账号和版本信息。"
                : currentSetup.installation.state === "not_installed"
                ? "先安装运行器，才能用它创建和运行 Agent。"
                : currentSetup?.account.state === "signed_out"
                  ? currentSetup.account.help
                  : "安装和账号状态已检查，可以继续选择默认模型。"}</p>
            </div>
            <div className="runtime-overview__actions">
              {currentSetup?.installation.state === "not_installed" ? (
                <button className="settings-button settings-button--primary" type="button"
                  disabled={!desktop || Boolean(busy)}
                  onClick={() => void changeManagedInstall(selected)}>
                  <Download size={16} />{busy === `install:${selected}` ? "安装中…" : "由 Kith 安装"}
                </button>
              ) : (
                <button className="settings-button settings-button--secondary" type="button"
                  disabled={Boolean(busy)} onClick={() => void probe(selected)}>
                  <RefreshCw size={16} className={busy === `probe:${selected}` ? "is-spinning" : ""} />
                  {busy === `probe:${selected}` ? "检查中…" : "重新检查"}
                </button>
              )}
              {currentSetup?.account.state !== "ready" && currentSetup?.installation.state === "installed" ? (
                <button className="settings-button settings-button--secondary" type="button"
                  onClick={() => void copyLoginCommand(currentSetup.account.loginCommand)}>
                  <Copy size={16} />复制登录命令
                </button>
              ) : null}
            </div>
          </div>

          {!desktop && currentSetup?.installation.state === "not_installed" ? (
            <div className="settings-inline-note">安装会修改本机文件，请在 Kith-space 桌面端完成。</div>
          ) : null}
          {restartRequired[selected] ? (
            <div className="settings-alert settings-alert--warning" role="status">
              这项变更会在重启 Kith-space 后生效；正在运行的 Agent 不会被热切换。
            </div>
          ) : null}

          <section className="settings-subsection">
            <div className="settings-subsection__heading">
              <div>
                <h4>可用性</h4>
                <p>安装与账号是两件事；使用 Kith 模型配置时，不要求 CLI 自己已经登录。</p>
              </div>
            </div>
            <div className="runtime-status-table">
              <RuntimeStatusRow label="安装"
                value={currentSetup?.installation.state === "installed"
                  ? currentSetup.installation.source === "kith_managed" ? "Kith 管理版本" : "本机已有版本"
                  : "未安装"}
                tone={currentSetup?.installation.state === "installed" ? "ready" : "warning"} />
              <RuntimeStatusRow label="版本" value={currentSetup?.installation.version ?? "尚未读取"} />
              <RuntimeStatusRow label="CLI 账号" value={currentSetup?.account.label ?? "尚未读取"}
                tone={currentSetup?.account.state === "ready" ? "ready" : "warning"} />
            </div>
          </section>

          <section className="settings-subsection">
            <div className="settings-subsection__heading">
              <div>
                <h4>Agent 默认模型</h4>
                <p>创建 Agent 时可再单独覆盖。Kith 配置不会写回 CLI 的全局文件。</p>
              </div>
            </div>
            <label className="settings-field">
              <span>默认使用</span>
              <select value={selectedBinding} disabled={!currentProfile || Boolean(busy)}
                onChange={(event) => {
                  const value = event.target.value;
                  void updateProfile(selected, {
                    mode: value === "unset" || value === "unmanaged_cli_native"
                      ? value
                      : "kith_model_configuration",
                    configurationId: value === "unset" || value === "unmanaged_cli_native" ? null : value,
                  });
                }}>
                <option value="unset">每次创建 Agent 时再选择</option>
                <option value="unmanaged_cli_native">使用 CLI 自己的账号和默认模型</option>
                {compatibleModels.map((model) => (
                  <option key={model.id} value={model.id}>{model.displayName} · {model.provider.displayName}</option>
                ))}
              </select>
            </label>
            {!compatibleModels.length ? (
              <div className="settings-inline-note">还没有兼容的 Kith 模型配置。可先到“模型与供应商”添加。</div>
            ) : null}
          </section>

          <details className="settings-advanced">
            <summary>安装位置与高级信息</summary>
            <dl>
              <div><dt>程序位置</dt><dd>{currentSetup?.installation.executablePath ?? "未找到"}</dd></div>
              <div><dt>Kith 支持版本</dt><dd>{currentSetup?.installation.testedVersion ?? "—"}</dd></div>
              <div><dt>登录命令</dt><dd><code>{currentSetup?.account.loginCommand ?? "—"}</code></dd></div>
              {selected === "pi" ? <div><dt>工具支持</dt><dd>Kith 命令工具可用；Pi RPC 暂不支持 MCP 直连。</dd></div> : null}
            </dl>
            {currentSetup?.managedInstall.canRemove ? (
              confirmRemove === selected ? (
                <div className="settings-confirm-remove" role="alert">
                  <p>只会删除 Kith 安装的 {currentMeta.label} 副本，不会删除系统 CLI 或账号配置。重启 Kith-space 后生效。</p>
                  <div className="settings-actions">
                    <button className="settings-button settings-button--secondary" type="button"
                      onClick={() => setConfirmRemove(null)}>取消</button>
                    <button className="settings-button settings-button--danger" type="button"
                      disabled={!desktop || Boolean(busy)}
                      onClick={() => void changeManagedInstall(selected, true)}>
                      <Trash2 size={16} />确认移除
                    </button>
                  </div>
                </div>
              ) : (
                <button className="settings-button settings-button--danger" type="button"
                  disabled={!desktop || Boolean(busy)}
                  onClick={() => setConfirmRemove(selected)}>
                  <Trash2 size={16} />移除 Kith 管理版本
                </button>
              )
            ) : null}
          </details>
        </section>
      </div>
    </div>
  );
}
