import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { buildAdvisorProfileRequest, type AdvisorProfileSource } from "./advisorProfileRequest.js";

type Api = (method: string, path: string, body?: unknown) => Promise<any>;
type Descriptor = {
  backendId: string; modelId: string; apiKind: string; canonicalOrigin: string; thinkingLevel: string;
  credentialSourceKind: string; credentialEnvRef?: string; advisorExecutable: boolean;
};

const EMPTY_PROFILE = {
  backendId: "anthropic", modelId: "", apiKind: "anthropic-messages", canonicalOrigin: "https://api.anthropic.com",
  thinkingLevel: "off", credentialSourceKind: "kith_secret", credentialRef: "", credentialValue: "",
  dataPolicyRevision: "human-reviewed-v1", dataPolicyProvenance: "human_asserted", networkClass: "public_cloud",
  allowedEgress: "https://api.anthropic.com",
};

export function AdvisorProviderSettings({ api }: { api: Api }) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<any>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [discover, setDiscover] = useState<any>(null);
  const [piRoot, setPiRoot] = useState("");
  const [authProvider, setAuthProvider] = useState("");
  const [catalog, setCatalog] = useState<any>(null);
  const [imports, setImports] = useState<any[]>([]);
  const [bundledCatalog, setBundledCatalog] = useState<any>(null);
  const [profileSource, setProfileSource] = useState<AdvisorProfileSource>("manual");
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const executable = useMemo<Descriptor[]>(() => (catalog?.descriptors || []).filter((item: Descriptor) => item.advisorExecutable), [catalog]);

  const load = async () => {
    const [nextSummary, nextDiscover, nextDiagnostics, nextRuns, nextCatalog, nextImports] = await Promise.all([
      api("GET", "/api/advisor-provider"), api("GET", "/api/advisor-provider/pi-cli/discover"),
      api("GET", "/api/advisor-provider/diagnostics"), api("GET", "/api/advisor-provider/runs?limit=20"),
      api("GET", "/api/advisor-provider/catalog"),
      api("GET", "/api/advisor-provider/pi-cli/imports"),
    ]);
    if (nextSummary?.error) throw new Error(nextSummary.error);
    setSummary(nextSummary); setDiscover(nextDiscover);
    setDiagnostics(nextDiagnostics); setRuns(Array.isArray(nextRuns?.items) ? nextRuns.items : []);
    setBundledCatalog(nextCatalog);
    setImports(Array.isArray(nextImports?.items) ? nextImports.items : []);
    setPiRoot((value) => value || nextDiscover?.defaultRoot || "");
  };
  useEffect(() => { void load().catch((reason) => setError(String(reason?.message || reason))); }, []);

  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name); setError(""); setNotice("");
    try { await action(); } catch (reason: any) { setError(String(reason?.message || reason)); } finally { setBusy(""); }
  };
  const importPi = () => run("import", async () => {
    const result = await api("POST", "/api/advisor-provider/pi-cli/import", {
      root: piRoot, ...(authProvider.trim() ? { includeAuthProvider: authProvider.trim() } : {}),
    });
    if (result?.error) throw new Error(`${result.code || "error"}: ${result.error}`);
    setCatalog(result);
    const selected = ((result.descriptors || []).find((item: Descriptor) => item.advisorExecutable
      && item.backendId === result.defaults?.provider && item.modelId === result.defaults?.model)
      || (result.descriptors || []).find((item: Descriptor) => item.advisorExecutable)) as Descriptor | undefined;
    if (selected) setProfile((value) => ({ ...value,
      backendId: selected.backendId, modelId: selected.modelId, apiKind: selected.apiKind,
      canonicalOrigin: selected.canonicalOrigin, thinkingLevel: selected.thinkingLevel,
      credentialSourceKind: result.credential && authProvider.trim() === selected.backendId ? "pi_cli_auth" : selected.credentialSourceKind,
      credentialRef: result.credential?.credentialRef || selected.credentialEnvRef || "",
    }));
    if (selected) setProfileSource("pi_cli_import");
    setNotice(t("misc.advisorImportDone", { count: result.descriptors?.length || 0 }));
    await load();
  });
  const selectProvider = (adapterId: string) => run("provider", async () => {
    const result = await api("POST", "/api/advisor-provider/select", { adapterId });
    if (result?.error) throw new Error(`${result.code || "error"}: ${result.error}`);
    setSummary(result); setNotice(t("misc.advisorProviderChanged"));
  });
  const saveProfile = () => run("profile", async () => {
    const result = await api("POST", "/api/advisor-provider/model-profiles", buildAdvisorProfileRequest({
      profileSource, profile, bundledCatalog, importedCatalog: catalog,
    }));
    if (result?.error) throw new Error(`${result.code || "error"}: ${result.error}`);
    setProfile((value) => ({ ...value, credentialValue: "" })); await load(); setNotice(t("misc.advisorProfileSaved"));
  });
  const rollback = () => run("rollback", async () => {
    const result = await api("POST", "/api/advisor-provider/rollback", {});
    if (result?.error) throw new Error(`${result.code || "error"}: ${result.error}`);
    setSummary(result); setNotice(t("misc.advisorRolledBack"));
  });
  const setEnabled = (enabled: boolean) => run("enabled", async () => {
    const result = await api("POST", "/api/advisor-provider/enabled", { enabled });
    if (result?.error) throw new Error(`${result.code || "error"}: ${result.error}`);
    setSummary(result);
  });
  const probe = () => run("probe", async () => {
    const result = await api("POST", "/api/advisor-provider/probe", {});
    if (result?.error) throw new Error(`${result.code || "error"}: ${result.error}`);
    setSummary(result); setNotice(t("misc.advisorProbePassed"));
  });

  if (!summary) return <div className="empty">{t("misc.advisorLoading")}</div>;
  return <div className="setform advisor-provider-settings">
    <section className="advisor-settings-card">
      <div className="advisor-settings-title">{t("misc.advisorSystemTitle")}</div>
      <div className="advisor-settings-grid">
        <span>{t("misc.advisorExecutionMode")}</span><code>{summary.settings.executionMode}</code>
        <span>{t("misc.advisorState")}</span><code>{summary.settings.state}</code>
        <span>{t("misc.advisorProviderRevision")}</span><code>{summary.provider ? `${summary.provider.adapterId}@${summary.provider.adapterVersion} · r${summary.provider.revision}` : "—"}</code>
        <span>{t("misc.advisorModelRevision")}</span><code>{summary.modelProfile ? `${summary.modelProfile.profile.backendId}/${summary.modelProfile.profile.modelId} · r${summary.modelProfile.revision}` : "—"}</code>
        <span>{t("misc.advisorEpoch")}</span><code>{summary.settings.providerEpoch}</code>
      </div>
      <div className="setrow">
        <button className={summary.settings.enabled ? "ok" : "ghost"} disabled={Boolean(busy)} onClick={() => void setEnabled(!summary.settings.enabled)}>
          {summary.settings.enabled ? t("misc.advisorPauseSystem") : t("misc.advisorEnableSystem")}
        </button>
        {(summary.availableProviders || []).map((item: any) => <button key={item.adapterId} className={summary.provider?.adapterId === item.adapterId ? "ok" : "ghost"} disabled={Boolean(busy)} onClick={() => void selectProvider(item.adapterId)}>{item.label}</button>)}
        {summary.settings.executionMode === "provider_v1" ? <button className="cancel" disabled={Boolean(busy)} onClick={() => void rollback()}>{t("misc.advisorRollback")}</button> : null}
      </div>
      <p className="settings-help">{t("misc.advisorNoDefaultEgress")}</p>
    </section>
    <section className="advisor-settings-card">
      <div className="advisor-settings-title">{t("misc.advisorDiagnosticsTitle")}</div>
      <div className="advisor-settings-grid">
        <span>{t("misc.advisorHelper")}</span><code>{diagnostics?.helper?.available ? diagnostics.helper.digestMatchesRevision ? "ready · digest matched" : "blocked · digest mismatch" : "unavailable"}</code>
        <span>{t("misc.advisorClaude")}</span><code>{diagnostics?.claude?.available ? "available" : "unavailable"}</code>
        <span>{t("misc.advisorIsolation")}</span><code>{diagnostics ? `${diagnostics.environmentPolicy} · ambient auth ${diagnostics.ambientAuth} · redirect ${diagnostics.redirects} · DNS ${diagnostics.dns}` : "—"}</code>
      </div>
      <div className="advisor-runs">
        {runs.length ? runs.map((run) => <div className="advisor-run" key={run.id}><span><b>{run.spaceName}</b> · {run.status} · {run.provider?.adapterId}@{run.provider?.adapterVersion}</span><code>p{run.providerRevision}/m{run.modelProfileRevision}/e{run.providerEpoch} · consent {run.consentEpoch}</code><small>{run.model ? `${run.model.backendId}/${run.model.modelId} · ${run.model.canonicalOrigin} · ${run.model.credentialIdentityDigest.slice(0, 12)} · ${run.model.dataPolicyRevision}` : "—"} · {run.errorCode || `${run.latencyMs ?? "—"}ms`}</small></div>) : <div className="meta">{t("misc.advisorNoRuns")}</div>}
      </div>
    </section>

    <section className="advisor-settings-card">
      <div className="advisor-settings-title">{t("misc.advisorPiImportTitle")}</div>
      {bundledCatalog?.descriptors?.length ? <div className="advisor-catalog">
        <div>{t("misc.advisorBundledCatalog", { count: bundledCatalog.descriptors.length })}</div>
        {bundledCatalog.descriptors.slice(0, 200).map((item: any) => <button type="button" key={`bundled:${item.backendId}/${item.modelId}`} className="advisor-model executable" onClick={() => {
          const thinkingLevel = item.thinkingLevels.includes("off") ? "off" : item.thinkingLevels[0];
          const importedCredential = catalog?.credential && authProvider.trim() === item.backendId
            ? catalog.credential
            : null;
          setProfileSource("bundled_catalog");
          setProfile((value) => ({ ...value, backendId: item.backendId, modelId: item.modelId, apiKind: item.apiKind,
            canonicalOrigin: item.canonicalOrigin, thinkingLevel,
            credentialSourceKind: importedCredential ? "pi_cli_auth" : "kith_secret",
            credentialRef: importedCredential?.credentialRef || "",
            dataPolicyRevision: `pi-catalog-${bundledCatalog.sourceSnapshotDigest.slice(0, 12)}`, dataPolicyProvenance: "vendor_verified",
            allowedEgress: item.canonicalOrigin }));
        }}><b>{item.backendId}/{item.modelId}</b><small>{item.apiKind} · {item.thinkingLevels.join(", ")}</small></button>)}
      </div> : null}
      <p className="settings-help">{t("misc.advisorPiImportSafety")}</p>
      <label>{t("misc.advisorPiRoot")}</label><input value={piRoot} onChange={(event) => setPiRoot(event.target.value)} />
      <label>{t("misc.advisorPiAuthProvider")}</label><input value={authProvider} onChange={(event) => setAuthProvider(event.target.value)} placeholder={t("misc.advisorPiAuthOptional")} />
      <div className="setrow"><button className="ghost" disabled={Boolean(busy) || !piRoot} onClick={() => void importPi()}>{busy === "import" ? t("misc.advisorWorking") : t("misc.advisorImport")}</button><span className="meta">{discover?.available ? t("misc.advisorPiFound") : t("misc.advisorPiNotFound")}</span></div>
      {imports.slice(0, 5).map((item) => <div className="meta" key={item.id}>{new Date(item.importedAt).toLocaleString()} · {item.catalogDigest.slice(0, 12)} · {item.warnings.length} warnings</div>)}
      {catalog ? <div className="advisor-catalog">
        <div>{t("misc.advisorCatalogSummary", { total: catalog.descriptors.length, executable: executable.length })}</div>
        {catalog.descriptors.map((item: Descriptor) => <button type="button" key={`${item.backendId}/${item.modelId}`} className={item.advisorExecutable ? "advisor-model executable" : "advisor-model incompatible"} disabled={!item.advisorExecutable} onClick={() => { setProfileSource("pi_cli_import"); setProfile((value) => ({ ...value, backendId: item.backendId, modelId: item.modelId, apiKind: item.apiKind, canonicalOrigin: item.canonicalOrigin, thinkingLevel: item.thinkingLevel, credentialSourceKind: catalog.credential && authProvider.trim() === item.backendId ? "pi_cli_auth" : item.credentialSourceKind, credentialRef: catalog.credential?.credentialRef || item.credentialEnvRef || "", dataPolicyProvenance: "human_asserted" })); }}>
          <b>{item.backendId}/{item.modelId || "?"}</b><small>{item.apiKind || "unknown_api"} · {item.advisorExecutable ? t("misc.advisorExecutable") : t("misc.advisorIncompatible")}</small>
        </button>)}
        {(catalog.warnings || []).map((item: any) => <div className="form-err" key={`${item.code}:${item.pointer}`}>{item.code} · {item.pointer}</div>)}
      </div> : null}
    </section>

    <section className="advisor-settings-card">
      <div className="advisor-settings-title">{t("misc.advisorProfileTitle")}</div>
      <div className="advisor-profile-grid">
        <label>{t("misc.advisorBackend")}<input value={profile.backendId} onChange={(e) => setProfile({ ...profile, backendId: e.target.value })} /></label>
        <label>{t("misc.advisorModel")}<input value={profile.modelId} onChange={(e) => setProfile({ ...profile, modelId: e.target.value })} /></label>
        <label>{t("misc.advisorApi")}<select value={profile.apiKind} onChange={(e) => setProfile({ ...profile, apiKind: e.target.value })}><option>anthropic-messages</option><option>openai-responses</option><option>openai-completions</option><option>google-generative-ai</option><option>mistral-conversations</option><option>pi-messages</option></select></label>
        <label>{t("misc.advisorThinking")}<select value={profile.thinkingLevel} onChange={(e) => setProfile({ ...profile, thinkingLevel: e.target.value })}>{["off","minimal","low","medium","high","xhigh","max"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="advisor-wide">{t("misc.advisorEndpoint")}<input value={profile.canonicalOrigin} onChange={(e) => setProfile({ ...profile, canonicalOrigin: e.target.value })} /></label>
        <label>{t("misc.advisorNetworkClass")}<select value={profile.networkClass} onChange={(e) => setProfile({ ...profile, networkClass: e.target.value })}><option>public_cloud</option><option>loopback</option><option>lan</option><option>custom</option></select></label>
        <label>{t("misc.advisorCredentialSource")}<select value={profile.credentialSourceKind} onChange={(e) => setProfile({ ...profile, credentialSourceKind: e.target.value })}><option>kith_secret</option><option>pi_cli_auth</option><option>env_ref</option><option>keyless_local</option></select></label>
        {profile.credentialSourceKind === "kith_secret" ? <label className="advisor-wide">{t("misc.advisorSecret")}<input type="password" autoComplete="new-password" value={profile.credentialValue} onChange={(e) => setProfile({ ...profile, credentialValue: e.target.value })} /></label> : profile.credentialSourceKind !== "keyless_local" ? <label className="advisor-wide">{t("misc.advisorCredentialRef")}<input value={profile.credentialRef} readOnly={profile.credentialSourceKind === "pi_cli_auth"} onChange={(e) => setProfile({ ...profile, credentialRef: e.target.value })} /></label> : null}
        <label>{t("misc.advisorDataPolicy")}<input value={profile.dataPolicyRevision} onChange={(e) => setProfile({ ...profile, dataPolicyRevision: e.target.value })} /></label>
        <label>{t("misc.advisorPolicyProvenance")}<select disabled={profileSource === "bundled_catalog"} value={profile.dataPolicyProvenance} onChange={(e) => setProfile({ ...profile, dataPolicyProvenance: e.target.value })}>{profileSource === "bundled_catalog" ? <option>vendor_verified</option> : <><option>human_asserted</option><option>unknown</option></>}</select></label>
        <label className="advisor-wide">{t("misc.advisorAllowedEgress")}<input value={profile.allowedEgress} onChange={(e) => setProfile({ ...profile, allowedEgress: e.target.value })} /></label>
      </div>
      <div className="setrow"><button className="ok" disabled={Boolean(busy) || !profile.modelId} onClick={() => void saveProfile()}>{busy === "profile" ? t("misc.advisorWorking") : t("misc.advisorSaveProfile")}</button><button className="ghost" disabled={Boolean(busy) || !summary.modelProfile} onClick={() => void probe()}>{busy === "probe" ? t("misc.advisorWorking") : t("misc.advisorProbe")}</button></div>
    </section>
    {notice ? <div className="saved" role="status">{notice}</div> : null}
    {error ? <div className="form-err" role="alert">{error}</div> : null}
  </div>;
}
