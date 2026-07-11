import { useEffect, useState } from "react";
import { Check, Copy, RefreshCw, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { copyText } from "../clipboard.ts";
import type {
  BrowserAccessMode,
  DesktopBrowserAccessResult,
  DesktopSettingsSnapshot,
  KithDesktopBridge,
} from "../desktopBridge.ts";

interface DesktopSettingsProps {
  bridge: KithDesktopBridge;
}

type BusyAction = "load" | "lifecycle" | "browser" | "token" | "sessions" | null;

const MODES: BrowserAccessMode[] = ["off", "local", "lan"];

export function DesktopSettings({ bridge }: DesktopSettingsProps) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<DesktopSettingsSnapshot | null>(null);
  const [port, setPort] = useState("");
  const [customToken, setCustomToken] = useState("");
  const [revealedToken, setRevealedToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<BusyAction>("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmLan, setConfirmLan] = useState(false);

  useEffect(() => {
    let cancelled = false;
    bridge.getSettings().then((snapshot) => {
      if (cancelled) return;
      setSettings(snapshot);
      setPort(String(snapshot.browser.port));
      setBusy(null);
    }).catch((reason) => {
      if (cancelled) return;
      setError(errorMessage(reason));
      setBusy(null);
    });
    return () => { cancelled = true; };
  }, [bridge]);

  const run = async (action: Exclude<BusyAction, "load" | null>, operation: () => Promise<DesktopSettingsSnapshot | DesktopBrowserAccessResult>, success: string) => {
    setBusy(action);
    setError("");
    setNotice("");
    try {
      const result = await operation();
      setSettings(result);
      setPort(String(result.browser.port));
      if ("accessToken" in result && result.accessToken) {
        setRevealedToken(result.accessToken);
        setCopied(false);
      }
      if ("restartRequired" in result && result.restartRequired && !result.restarted) {
        setNotice(t("desktopSettings.restartRequired"));
      } else {
        setNotice(success);
      }
      return true;
    } catch (reason) {
      setError(errorMessage(reason));
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (busy === "load" && !settings) return <div className="empty">{t("desktopSettings.loading")}</div>;
  if (!settings) return <div className="desktop-settings-error" role="alert">{error || t("desktopSettings.loadFailed")}</div>;

  const { lifecycle, browser } = settings;
  const portNumber = Number(port);
  const portValid = Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535;
  const tokenValid = customToken.length === 0 || (customToken.length >= 16 && customToken.length <= 256);
  const disabled = busy !== null;

  const updateMode = (mode: BrowserAccessMode) => {
    if (mode === "lan" && browser.mode !== "lan") {
      setConfirmLan(true);
      return;
    }
    setConfirmLan(false);
    return run("browser", () => bridge.updateBrowserAccess({ mode }), t("desktopSettings.browserSaved"));
  };
  const enableLan = () => run(
    "browser",
    () => bridge.updateBrowserAccess({ mode: "lan" }),
    t("desktopSettings.browserSaved"),
  ).then((saved) => { if (saved) setConfirmLan(false); });
  const updatePort = () => {
    if (!portValid) return setError(t("desktopSettings.portInvalid"));
    return run("browser", () => bridge.updateBrowserAccess({ port: portNumber }), t("desktopSettings.browserSaved"));
  };
  const rotateToken = () => {
    if (!tokenValid) return setError(t("desktopSettings.tokenInvalid"));
    return run(
      "token",
      () => bridge.updateBrowserAccess({ accessToken: customToken }),
      t("desktopSettings.tokenRotated"),
    ).then((saved) => { if (saved) setCustomToken(""); });
  };
  const copyToken = async () => {
    if (!revealedToken || !(await copyText(revealedToken))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const dismissToken = () => {
    setRevealedToken("");
    void bridge.completeBrowserAccessUpdate().catch((reason) => setError(errorMessage(reason)));
  };

  return (
    <div className="desktop-settings">
      <section className="desktop-settings-section" aria-labelledby="desktop-lifecycle-title">
        <div className="desktop-settings-heading">
          <h2 id="desktop-lifecycle-title">{t("desktopSettings.lifecycleTitle")}</h2>
          <p>{t("desktopSettings.lifecycleDesc")}</p>
        </div>

        <div className="desktop-setting-row">
          <div className="desktop-setting-copy">
            <div className="desktop-setting-title">{t("desktopSettings.closeBehavior")}</div>
            <div className="desktop-setting-desc">{t("desktopSettings.closeBehaviorDesc")}</div>
          </div>
          <div className="seg-pill" role="group" aria-label={t("desktopSettings.closeBehavior")}>
            <button
              className={"seg-opt" + (lifecycle.closeBehavior === "tray" ? " on" : "")}
              disabled={disabled}
              onClick={() => run("lifecycle", () => bridge.updateLifecycle({ closeBehavior: "tray" }), t("desktopSettings.lifecycleSaved"))}
            >{t("desktopSettings.closeToTray")}</button>
            <button
              className={"seg-opt" + (lifecycle.closeBehavior === "quit" ? " on" : "")}
              disabled={disabled}
              onClick={() => run("lifecycle", () => bridge.updateLifecycle({ closeBehavior: "quit" }), t("desktopSettings.lifecycleSaved"))}
            >{t("desktopSettings.closeToQuit")}</button>
          </div>
        </div>

        <div className="toggle-row">
          <div className="toggle-text">
            <div className="toggle-title">{t("desktopSettings.launchAtLogin")}</div>
            <div className="toggle-sub">
              {lifecycle.launchAtLoginSupported ? t("desktopSettings.launchAtLoginDesc") : t("desktopSettings.launchAtLoginUnsupported")}
            </div>
          </div>
          <button
            className={"switch" + (lifecycle.launchAtLogin ? " on" : "")}
            type="button"
            role="switch"
            aria-checked={lifecycle.launchAtLogin}
            aria-label={t("desktopSettings.launchAtLogin")}
            disabled={disabled || !lifecycle.launchAtLoginSupported}
            onClick={() => run("lifecycle", () => bridge.updateLifecycle({ launchAtLogin: !lifecycle.launchAtLogin }), t("desktopSettings.lifecycleSaved"))}
          ><span className="knob" /></button>
        </div>
      </section>

      <section className="desktop-settings-section" aria-labelledby="desktop-browser-title">
        <div className="desktop-settings-heading">
          <h2 id="desktop-browser-title">{t("desktopSettings.browserTitle")}</h2>
          <p>{t("desktopSettings.browserDesc")}</p>
        </div>

        <div className="desktop-mode-grid" role="radiogroup" aria-label={t("desktopSettings.webMode")}>
          {MODES.map((mode) => (
            <button
              key={mode}
              className={"desktop-mode-card" + (browser.mode === mode ? " on" : "")}
              role="radio"
              aria-checked={browser.mode === mode}
              disabled={disabled}
              onClick={() => updateMode(mode)}
            >
              <span>{t(`desktopSettings.mode.${mode}.title`)}</span>
              <small>{t(`desktopSettings.mode.${mode}.desc`)}</small>
            </button>
          ))}
        </div>

        {confirmLan ? (
          <div className="desktop-lan-confirm" role="alertdialog" aria-labelledby="desktop-lan-confirm-title">
            <ShieldAlert size={18} />
            <div>
              <strong id="desktop-lan-confirm-title">{t("desktopSettings.enableLanTitle")}</strong>
              <p>{t("desktopSettings.lanWarning")}</p>
              <div className="desktop-token-actions">
                <button className="cancel" disabled={disabled} onClick={() => setConfirmLan(false)}>{t("desktopSettings.cancelLan")}</button>
                <button className="desktop-danger-button" disabled={disabled} onClick={enableLan}>{t("desktopSettings.enableLan")}</button>
              </div>
            </div>
          </div>
        ) : null}

        {browser.mode === "lan" ? (
          <div className="desktop-lan-warning" role="note">
            <ShieldAlert size={18} />
            <span>{browser.lanWarning || t("desktopSettings.lanWarning")}</span>
          </div>
        ) : null}

        <div className="desktop-setting-block">
          <label htmlFor="desktop-web-port">{t("desktopSettings.port")}</label>
          <div className="desktop-inline-control">
            <input
              id="desktop-web-port"
              type="number"
              min="1"
              max="65535"
              value={port}
              disabled={disabled}
              onChange={(event) => setPort(event.target.value)}
            />
            <button className="cancel" disabled={disabled || !portValid || portNumber === browser.port} onClick={updatePort}>
              {t("desktopSettings.savePort")}
            </button>
          </div>
          <p>{t("desktopSettings.portDesc")}</p>
        </div>

        <div className="desktop-browser-meta" aria-label={t("desktopSettings.accessStatus")}>
          <span>{browser.hasAccessToken ? t("desktopSettings.tokenConfigured") : t("desktopSettings.tokenMissing")}</span>
          <span>{t("desktopSettings.tokenRevision", { revision: browser.tokenRevision })}</span>
          <span>{t("desktopSettings.activeSessions", { count: browser.activeSessions })}</span>
        </div>

        <div className="desktop-setting-block">
          <label htmlFor="desktop-access-token">{t("desktopSettings.customToken")}</label>
          <input
            id="desktop-access-token"
            type="password"
            minLength={16}
            maxLength={256}
            autoComplete="new-password"
            value={customToken}
            disabled={disabled}
            placeholder={t("desktopSettings.customTokenPlaceholder")}
            onChange={(event) => setCustomToken(event.target.value)}
          />
          <p>{t("desktopSettings.customTokenDesc")}</p>
          <button className="desktop-token-action" disabled={disabled || !tokenValid} onClick={rotateToken}>
            <RefreshCw size={14} />
            {browser.hasAccessToken ? t("desktopSettings.rotateToken") : t("desktopSettings.generateToken")}
          </button>
        </div>

        {revealedToken ? (
          <div className="desktop-token-reveal" role="status">
            <div>
              <strong>{t("desktopSettings.oneTimeTokenTitle")}</strong>
              <p>{t("desktopSettings.oneTimeTokenDesc")}</p>
            </div>
            <code>{revealedToken}</code>
            <div className="desktop-token-actions">
              <button className="cancel" onClick={copyToken}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? t("desktopSettings.copied") : t("desktopSettings.copyToken")}</button>
              <button className="cancel" onClick={dismissToken}>{t("desktopSettings.dismissToken")}</button>
            </div>
          </div>
        ) : null}

        <div className="desktop-setting-row desktop-sessions-row">
          <div className="desktop-setting-copy">
            <div className="desktop-setting-title">{t("desktopSettings.sessionsTitle")}</div>
            <div className="desktop-setting-desc">{t("desktopSettings.sessionsDesc")}</div>
          </div>
          <button
            className="desktop-danger-button"
            disabled={disabled || browser.activeSessions === 0}
            onClick={() => run("sessions", () => bridge.revokeBrowserSessions(), t("desktopSettings.sessionsRevoked"))}
          >{t("desktopSettings.revokeSessions")}</button>
        </div>
      </section>

      {error ? <div className="desktop-settings-error" role="alert">{error}</div> : null}
      {notice ? <div className="desktop-settings-notice" role="status">{notice}</div> : null}
    </div>
  );
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason || "Unknown Desktop settings error");
}
