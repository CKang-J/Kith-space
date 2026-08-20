import { useEffect, useRef, useState, type ReactNode } from "react";

const TAB_PANEL_CROSSFADE_MS = 160;

interface PanelSnapshot {
  tabId: string;
  children: ReactNode;
}

interface WorkspaceTabPanelProps {
  tabId: string;
  children: ReactNode;
}

export function WorkspaceTabPanel({ tabId, children }: WorkspaceTabPanelProps) {
  const [current, setCurrent] = useState<PanelSnapshot>({ tabId, children });
  const [leaving, setLeaving] = useState<PanelSnapshot | null>(null);
  const leaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (tabId === current.tabId) {
      if (current.children !== children) setCurrent({ tabId, children });
      return;
    }

    if (leaveTimerRef.current !== null) window.clearTimeout(leaveTimerRef.current);

    setLeaving(current);
    setCurrent({ tabId, children });

    leaveTimerRef.current = window.setTimeout(() => {
      setLeaving(null);
      leaveTimerRef.current = null;
    }, TAB_PANEL_CROSSFADE_MS);

    return () => {
      if (leaveTimerRef.current !== null) window.clearTimeout(leaveTimerRef.current);
    };
  }, [tabId, children, current.tabId, current.children]);

  return (
    <div className="shell-workspace-tab__panel-stack">
      {leaving ? (
        <div
          key={leaving.tabId}
          className="shell-workspace-tab__panel shell-workspace-tab__panel--leaving"
          aria-hidden="true"
        >
          {leaving.children}
        </div>
      ) : null}
      <div key={current.tabId} className="shell-workspace-tab__panel shell-workspace-tab__panel--entering">
        {current.children}
      </div>
    </div>
  );
}
