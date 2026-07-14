import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ChevronRight, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AGENT_RESPONSE_MODES, type AgentResponseMode, type ChannelAgentResponseMode } from "./responseModeModel.ts";
import { RESPONSE_MODE_COPY } from "./responseModeCopy.ts";

interface MenuPosition {
  left: number;
  top: number;
  side: "above" | "below";
  ready: boolean;
}

interface ChannelAgentResponseModeMenuProps {
  agentName: string;
  member: ChannelAgentResponseMode;
  triggerRef: RefObject<HTMLButtonElement>;
  rootRef: RefObject<HTMLDivElement>;
  autoFocus: boolean;
  onChange(value: AgentResponseMode | null): Promise<unknown>;
  onChangeDefault(value: AgentResponseMode): Promise<unknown>;
  onPointerEnter(): void;
  onPointerLeave(): void;
}

type MenuView = "channel" | "agent-default";

const VIEWPORT_MARGIN = 8;
const HOVER_CORRIDOR = 6;

export function ChannelAgentResponseModeMenu({
  agentName,
  member,
  triggerRef,
  rootRef,
  autoFocus,
  onChange,
  onChangeDefault,
  onPointerEnter,
  onPointerLeave,
}: ChannelAgentResponseModeMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const previousViewRef = useRef<MenuView>("channel");
  const [position, setPosition] = useState<MenuPosition>({ left: VIEWPORT_MARGIN, top: VIEWPORT_MARGIN, side: "below", ready: false });
  const [view, setView] = useState<MenuView>("channel");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const canFitBelow = window.innerHeight - triggerRect.bottom >= menuRect.height + HOVER_CORRIDOR + VIEWPORT_MARGIN;
    const canFitAbove = triggerRect.top >= menuRect.height + HOVER_CORRIDOR + VIEWPORT_MARGIN;
    const side: MenuPosition["side"] = canFitBelow || !canFitAbove ? "below" : "above";
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - menuRect.width - VIEWPORT_MARGIN);
    const left = Math.max(VIEWPORT_MARGIN, Math.min(triggerRect.left, maxLeft));
    const top = side === "below"
      ? Math.max(VIEWPORT_MARGIN, Math.min(triggerRect.bottom, window.innerHeight - menuRect.height - HOVER_CORRIDOR - VIEWPORT_MARGIN))
      : Math.max(VIEWPORT_MARGIN, triggerRect.top - menuRect.height - HOVER_CORRIDOR);
    setPosition({ left, top, side, ready: true });
  }, [triggerRef]);

  useLayoutEffect(() => place(), [error, place, view]);

  useEffect(() => {
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [place]);

  useEffect(() => {
    const viewChanged = previousViewRef.current !== view;
    previousViewRef.current = view;
    if ((!autoFocus && !viewChanged) || !position.ready) return;
    const selected = menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitemradio'][aria-checked='true']");
    const first = menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    (selected ?? first)?.focus();
  }, [autoFocus, position.ready, view]);

  const pickChannelMode = async (value: AgentResponseMode | null) => {
    if (busy) return;
    if (member.responseModeOverride === value) return;
    setBusy(true);
    setError("");
    try {
      await onChange(value);
    } catch {
      setError(t("responseMode.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const pickDefaultMode = async (value: AgentResponseMode) => {
    if (busy || member.defaultResponseMode === value) return;
    setBusy(true);
    setError("");
    try {
      await onChangeDefault(value);
    } catch {
      setError(t("responseMode.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (!items.length) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = currentIndex;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else if (event.key === "ArrowDown" || event.key === "ArrowRight") nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    else nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  return createPortal(
    <div
      ref={rootRef}
      className={`channel-response-mode-menu-corridor is-${position.side}`}
      style={{ left: position.left, top: position.top, visibility: position.ready ? "visible" : "hidden" }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div
        ref={menuRef}
        className="channel-response-mode-menu"
        role="menu"
        aria-label={t("responseMode.menuDescription", { name: agentName })}
        aria-busy={busy}
        onKeyDown={onKeyDown}
      >
        {view === "channel" ? (
          <>
            <div className="channel-response-mode-menu__header">
              <span>{t("responseMode.menuTitle")}</span>
              <small>{t("responseMode.defaultSummary", { mode: t(RESPONSE_MODE_COPY[member.defaultResponseMode].shortLabelKey) })}</small>
            </div>
            <div className="channel-response-mode-menu__segments is-channel" role="group" aria-label={t("responseMode.channelSelection")}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={member.responseModeOverride === null}
                className={member.responseModeOverride === null ? "is-selected" : ""}
                disabled={busy}
                onClick={() => void pickChannelMode(null)}
              >
                {t("responseMode.defaultShort")}
              </button>
              {AGENT_RESPONSE_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="menuitemradio"
                  aria-checked={member.responseModeOverride === mode}
                  className={member.responseModeOverride === mode ? "is-selected" : ""}
                  disabled={busy}
                  onClick={() => void pickChannelMode(mode)}
                >
                  {t(RESPONSE_MODE_COPY[mode].shortLabelKey)}
                </button>
              ))}
            </div>
            <div className="channel-response-mode-menu__separator" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="channel-response-mode-menu__settings-link"
              disabled={busy}
              onClick={() => {
                setError("");
                setView("agent-default");
              }}
            >
              <Settings2 size={16} aria-hidden="true" />
              <span>{t("responseMode.changeDefault")}</span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </>
        ) : (
          <>
            <div className="channel-response-mode-menu__drill-header">
              <button
                type="button"
                role="menuitem"
                aria-label={t("responseMode.backToChannelSelection")}
                disabled={busy}
                onClick={() => {
                  setError("");
                  setView("channel");
                }}
              >
                <ArrowLeft size={18} aria-hidden="true" />
              </button>
              <span>{t("responseMode.defaultMenuTitle")}</span>
            </div>
            <div className="channel-response-mode-menu__segments is-default" role="group" aria-label={t("responseMode.defaultSelection")}>
              {AGENT_RESPONSE_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="menuitemradio"
                  aria-checked={member.defaultResponseMode === mode}
                  className={member.defaultResponseMode === mode ? "is-selected" : ""}
                  disabled={busy}
                  onClick={() => void pickDefaultMode(mode)}
                >
                  {t(RESPONSE_MODE_COPY[mode].shortLabelKey)}
                </button>
              ))}
            </div>
            <p className="channel-response-mode-menu__scope">{t("responseMode.defaultScope")}</p>
          </>
        )}
        {error ? <div className="channel-response-mode-menu__error" role="alert">{error}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
