// Top-left brand button = Space switcher. Click to list, switch, or create local Spaces.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Check } from "lucide-react";
import { useStore } from "./store.tsx";
import { useTranslation } from "react-i18next";

export function SpaceSwitcher({ targetPathForSlug }: { targetPathForSlug?: (slug: string) => string } = {}) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { spaces, slug, spaceAvatar, createSpace } = useStore();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const cur = spaces.find((s) => s.slug === slug);
  // Client-side navigation (no full-page reload): the URL change drives the Space switch via the /s/:slug route guard.
  const go = (s: { slug: string }) => {
    setOpen(false);
    if (s.slug !== slug) nav(targetPathForSlug?.(s.slug) ?? `/s/${s.slug}/channel`);
  };
  const submit = async () => { if (!name.trim() || busy) return; setBusy(true); try { const newSlug = await createSpace(name.trim()); if (newSlug) { close(); nav(`/s/${newSlug}/channel`); } } finally { setBusy(false); } };
  const close = () => { setOpen(false); setCreating(false); setName(""); };
  return (
    <div className="sw-wrap">
      <button className="brand" title={cur?.name || "Kith-space"} aria-label={t("space.switchAriaLabel")} onClick={() => setOpen((o) => !o)}>
        {spaceAvatar ? <img className="brand-img" src={spaceAvatar} alt="" /> : (cur?.name?.[0]?.toUpperCase() || "f")}
        <span className="dot" />
      </button>
      {open && (<>
        <div className="sw-backdrop" onClick={close} />
        <div className="sw-pop" role="menu">
          <div className="sw-title">{t("space.menuTitle")}</div>
          {spaces.map((s) => (
            <button key={s.id} className={"sw-item" + (s.slug === slug ? " on" : "")} onClick={() => go(s)}>
              <span className="sw-ava">{(s.name?.[0] || "?").toUpperCase()}</span>
              <span className="sw-name">{s.name}</span>
              {s.slug === slug && <Check size={14} className="sw-check" />}
            </button>
          ))}
          {creating ? (
            <div className="sw-create">
              <input autoFocus value={name} placeholder={t("space.namePlaceholder")} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") close(); }} />
              <button className="sw-go" disabled={busy} onClick={submit}>{busy ? "..." : t("space.createBtn")}</button>
            </div>
          ) : (
            <button className="sw-add" onClick={() => setCreating(true)}><Plus size={14} /> {t("space.createSpace")}</button>
          )}
        </div>
      </>)}
    </div>
  );
}
