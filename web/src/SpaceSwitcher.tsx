// Top-left brand button = Space switcher. It also hosts the minimal H3 create/attach/reconnect entry.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Check, FolderOpen, FolderPlus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SpaceFolderForm, type SpaceFolderIntent } from "./spaces/SpaceFolderForm.tsx";
import { useStore, type SpaceInfo } from "./store.tsx";

type SwitcherFlow = "choose" | SpaceFolderIntent | null;

export function SpaceSwitcher({ targetPathForSlug }: { targetPathForSlug?: (slug: string) => string } = {}) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { spaces, slug, spaceAvatar, createSpace, relocateSpace, refreshSpaces } = useStore();
  const [open, setOpen] = useState(false);
  const [flow, setFlow] = useState<SwitcherFlow>(null);
  const [relocateTargetId, setRelocateTargetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cur = spaces.find((space) => space.slug === slug);

  const resetFlow = () => {
    setFlow(null);
    setRelocateTargetId(null);
    setError("");
  };
  const close = () => {
    setOpen(false);
    resetFlow();
  };
  const toggleOpen = async () => {
    if (open) return close();
    setOpen(true);
    setError("");
    try {
      await refreshSpaces();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("space.operationFailed"));
    }
  };
  const go = (space: SpaceInfo) => {
    if (space.status !== "ready") {
      setRelocateTargetId(space.id);
      setFlow("relocate");
      setError("");
      return;
    }
    close();
    if (space.slug !== slug) nav(targetPathForSlug?.(space.slug) ?? `/s/${space.slug}/channel`);
  };
  const submit = async (input: { name?: string; rootPath?: string }) => {
    if (busy || flow === null || flow === "choose") return;
    setBusy(true);
    setError("");
    try {
      const result = flow === "relocate" && relocateTargetId
        ? await relocateSpace(relocateTargetId, input.rootPath || "")
        : await createSpace(input);
      if (!result.space) {
        setError(result.error || t("space.operationFailed"));
        return;
      }
      close();
      nav(`/s/${result.space.slug}/channel`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("space.operationFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sw-wrap">
      <button className="brand" title={cur?.name || "Kith-space"} aria-label={t("space.switchAriaLabel")} onClick={toggleOpen}>
        {spaceAvatar ? <img className="brand-img" src={spaceAvatar} alt="" /> : (cur?.name?.[0]?.toUpperCase() || "K")}
        <span className="dot" />
      </button>
      {open && (<>
        <div className="sw-backdrop" onClick={close} />
        <div className="sw-pop">
          <div className="sw-title">{t("space.menuTitle")}</div>
          {spaces.map((space) => {
            const unavailable = space.status !== "ready";
            return (
              <button
                key={space.id}
                className={`sw-item${space.slug === slug ? " on" : ""}${unavailable ? " unavailable" : ""}`}
                onClick={() => go(space)}
                title={space.rootPath}
              >
                <span className="sw-ava">{(space.name?.[0] || "?").toUpperCase()}</span>
                <span className="sw-item-copy">
                  <span className="sw-name">{space.name}</span>
                  {unavailable && <span className="sw-state">{space.rootError || t(space.status === "missing" ? "space.rootMissing" : "space.rootError")}</span>}
                </span>
                {unavailable ? <AlertTriangle size={14} className="sw-warning" /> : space.slug === slug && <Check size={14} className="sw-check" />}
              </button>
            );
          })}

          {flow === "choose" && (
            <div className="sw-create-options">
              <button type="button" onClick={() => setFlow("default")}><FolderPlus size={15} /><span><strong>{t("space.createDefault")}</strong><small>{t("space.createDefaultHint")}</small></span></button>
              <button type="button" onClick={() => setFlow("attach")}><FolderOpen size={15} /><span><strong>{t("space.attachExisting")}</strong><small>{t("space.attachExistingHint")}</small></span></button>
              <button type="button" className="sw-cancel" onClick={resetFlow}>{t("confirm.cancel")}</button>
            </div>
          )}
          {(flow === "default" || flow === "attach" || flow === "relocate") && (
            <SpaceFolderForm intent={flow} busy={busy} error={error} onCancel={resetFlow} onSubmit={submit} />
          )}
          {flow === null && (
            <>
              {error && <div className="sw-form-error" role="alert">{error}</div>}
              <button className="sw-add" onClick={() => setFlow("choose")}><Plus size={14} /> {t("space.createSpace")}</button>
            </>
          )}
        </div>
      </>)}
    </div>
  );
}
