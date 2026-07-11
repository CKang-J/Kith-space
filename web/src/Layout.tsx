import { useEffect, useState, type MouseEvent as RMouseEvent } from "react";
import { Outlet, useLocation, useParams, useNavigate } from "react-router-dom";
import { IconSearch, IconChat, IconTasks, IconUsers, IconSettings, IconInbox } from "./icons.tsx";
import { useStore } from "./store.tsx";
import { SpaceSwitcher } from "./SpaceSwitcher.tsx";
import { QuickSwitcher } from "./QuickSwitcher.tsx";
import { Menu } from "lucide-react";
import { useTranslation } from "react-i18next";

const SECTIONS = [
  { key: "search", Icon: IconSearch, labelKey: "nav.search" },
  { key: "inbox", Icon: IconInbox, labelKey: "nav.inbox" },
  { key: "channel", Icon: IconChat, labelKey: "nav.channel" },
  { key: "tasks", Icon: IconTasks, labelKey: "nav.tasks" },
  { key: "agent", Icon: IconUsers, labelKey: "nav.agents" },
];

export function Layout() {
  const loc = useLocation();
  const { server } = useParams();
  const nav = useNavigate();
  const { unread } = useStore();
  const { t } = useTranslation();
  const [showQS, setShowQS] = useState(false);
  const slug = server || "kith-space";
  const isChat = loc.pathname.includes("/channel");
  const go = (key: string) => nav(`/s/${slug}/${key}`);
  const active = (key: string) => loc.pathname.includes("/" + key);
  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  // Panel drag-to-resize: dragging the divider updates CSS variables (--sb-w sidebar / --traj-w right panel); persisted in localStorage.
  useEffect(() => { for (const v of ["--sb-w", "--traj-w"]) { const s = localStorage.getItem("kith-space" + v); if (s) document.documentElement.style.setProperty(v, s); } }, []);
  useEffect(() => { document.body.classList.remove("sb-open"); }, [loc.pathname]); // mobile: auto-close drawer on route change (channel select / view switch)
  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setShowQS(true); } }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, []); // Cmd/Ctrl+K global quick switcher
  const startResize = (which: "sb" | "traj") => (e: RMouseEvent) => {
    e.preventDefault();
    const varName = which === "sb" ? "--sb-w" : "--traj-w";
    const startX = e.clientX;
    const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue(varName)) || (which === "sb" ? 248 : 320);
    const onMove = (ev: MouseEvent) => { const d = which === "sb" ? ev.clientX - startX : startX - ev.clientX; document.documentElement.style.setProperty(varName, Math.max(180, Math.min(560, cur + d)) + "px"); };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); localStorage.setItem("kith-space" + varName, getComputedStyle(document.documentElement).getPropertyValue(varName).trim()); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };
  return (
    <div className={"app" + (isChat ? " has-traj" : "")}>
      <button className="mobile-burger" aria-label={t("common.menuToggle")} onClick={() => document.body.classList.toggle("sb-open")}><Menu size={18} /></button>
      <div className="mobile-scrim" onClick={() => document.body.classList.remove("sb-open")} />
      {showQS && <QuickSwitcher onClose={() => setShowQS(false)} />}
      <div className="rail">
        <SpaceSwitcher />
        {SECTIONS.map((s) => (
          <a key={s.key} className={"t" + (active(s.key) ? " active" : "")} aria-label={t(s.labelKey)} onClick={() => go(s.key)}>
            <s.Icon size={19} />
            <span className="t-label" aria-hidden="true">{t(s.labelKey)}</span>
            {s.key === "inbox" && totalUnread > 0 && <span className="rail-badge" aria-hidden="true">{totalUnread > 99 ? "99+" : totalUnread}</span>}
          </a>
        ))}
        <div className="spacer" />
        <a className={"t" + (active("settings") ? " active" : "")} aria-label={t("nav.settings")} onClick={() => go("settings")}><IconSettings size={19} /><span className="t-label" aria-hidden="true">{t("nav.settings")}</span></a>
      </div>
      <Outlet />
      <div className="resizer resizer-sb" onMouseDown={startResize("sb")} title={t("common.resizeSidebar")} />
      {isChat && <div className="resizer resizer-traj" onMouseDown={startResize("traj")} title={t("common.resizeTraj")} />}
    </div>
  );
}
