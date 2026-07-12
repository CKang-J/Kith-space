import { AlertTriangle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store.tsx";
import { SpaceFolderForm } from "./SpaceFolderForm.tsx";

/** Keeps relocation reachable even when no Space database can be activated. */
export function SpaceRecovery() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { spaces, relocateSpace } = useStore();
  const unavailable = useMemo(() => spaces.filter((space) => space.status !== "ready"), [spaces]);
  const [targetId, setTargetId] = useState(unavailable[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!unavailable.some((space) => space.id === targetId)) setTargetId(unavailable[0]?.id ?? "");
  }, [targetId, unavailable]);

  const submit = async ({ rootPath }: { rootPath?: string }) => {
    if (!targetId || !rootPath || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await relocateSpace(targetId, rootPath);
      if (!result.space) {
        setError(result.error || t("space.operationFailed"));
        return;
      }
      navigate(`/s/${result.space.slug}/channel`, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("space.operationFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="space-recovery">
      <section className="space-recovery-card">
        <AlertTriangle size={28} aria-hidden="true" />
        <h1>{t("space.recoveryTitle")}</h1>
        <p>{t("space.recoveryIntro")}</p>
        {unavailable.length > 0 ? (
          <div className="space-recovery-list" aria-label={t("space.recoveryListLabel")}>
            {unavailable.map((space) => (
              <button
                type="button"
                key={space.id}
                className={space.id === targetId ? "on" : ""}
                onClick={() => { setTargetId(space.id); setError(""); }}
              >
                <strong>{space.name}</strong>
                <span>{space.rootPath}</span>
                <small>{space.rootError || t("space.rootError")}</small>
              </button>
            ))}
          </div>
        ) : <div className="sw-form-error">{t("space.noRecoverableSpace")}</div>}
        {targetId && (
          <SpaceFolderForm intent="relocate" busy={busy} error={error} onSubmit={submit} />
        )}
      </section>
    </main>
  );
}
