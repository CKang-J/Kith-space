import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgentResponseMode, ChannelAgentResponseMode } from "./responseModeModel.ts";
import { RESPONSE_MODE_COPY } from "./responseModeCopy.ts";
import { ChannelAgentResponseModeMenu } from "./ChannelAgentResponseModeMenu.tsx";

interface ChannelAgentResponseModeBadgeProps {
  agentName: string;
  member: ChannelAgentResponseMode;
  readOnly?: boolean;
  onChange(value: AgentResponseMode | null): Promise<unknown>;
  onChangeDefault(value: AgentResponseMode): Promise<unknown>;
}

const HOVER_OPEN_DELAY_MS = 250;
const HOVER_CLOSE_DELAY_MS = 140;

export function ChannelAgentResponseModeBadge({
  agentName,
  member,
  readOnly = false,
  onChange,
  onChangeDefault,
}: ChannelAgentResponseModeBadgeProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [autoFocusMenu, setAutoFocusMenu] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRootRef = useRef<HTMLDivElement>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const focusTimerRef = useRef<number | null>(null);
  const suppressFocusOpenRef = useRef(false);
  const label = t(RESPONSE_MODE_COPY[member.effectiveResponseMode].labelKey);

  const clearTimers = () => {
    if (openTimerRef.current !== null) window.clearTimeout(openTimerRef.current);
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
    openTimerRef.current = null;
    closeTimerRef.current = null;
    focusTimerRef.current = null;
  };

  const openMenu = (autoFocus = false) => {
    if (readOnly) return;
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    setAutoFocusMenu(autoFocus);
    setOpen(true);
  };

  const closeMenu = (restoreFocus = false) => {
    clearTimers();
    setOpen(false);
    setAutoFocusMenu(false);
    if (restoreFocus) {
      suppressFocusOpenRef.current = true;
      window.requestAnimationFrame(() => {
        triggerRef.current?.focus();
        window.requestAnimationFrame(() => { suppressFocusOpenRef.current = false; });
      });
    }
  };

  const scheduleClose = () => {
    if (readOnly) return;
    if (openTimerRef.current !== null) window.clearTimeout(openTimerRef.current);
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    openTimerRef.current = null;
    closeTimerRef.current = window.setTimeout(() => closeMenu(false), HOVER_CLOSE_DELAY_MS);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || menuRootRef.current?.contains(target)) return;
      closeMenu(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeMenu(true);
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || menuRootRef.current?.contains(target)) return;
      closeMenu(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open]);

  useEffect(() => () => clearTimers(), []);

  if (readOnly) {
    return (
      <span
        className={`channel-response-mode-badge mode-${member.effectiveResponseMode} is-readonly`}
        title={`${label} · ${t("responseMode.readOnly")}`}
      >
        {label}
      </span>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`channel-response-mode-badge mode-${member.effectiveResponseMode}`}
        aria-label={t("responseMode.badgeLabel", { name: agentName, mode: label })}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerEnter={(event) => {
          if (event.pointerType && event.pointerType !== "mouse") return;
          clearTimers();
          openTimerRef.current = window.setTimeout(() => openMenu(false), HOVER_OPEN_DELAY_MS);
        }}
        onPointerLeave={scheduleClose}
        onFocus={() => {
          if (suppressFocusOpenRef.current) {
            suppressFocusOpenRef.current = false;
            return;
          }
          if (open || focusTimerRef.current !== null) return;
          focusTimerRef.current = window.setTimeout(() => openMenu(false), 0);
        }}
        onClick={() => {
          if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
          focusTimerRef.current = null;
          if (open) closeMenu(false);
          else openMenu(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            closeMenu(true);
          } else if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openMenu(true);
          }
        }}
      >
        {label}
      </button>
      {open ? (
        <ChannelAgentResponseModeMenu
          agentName={agentName}
          member={member}
          triggerRef={triggerRef}
          rootRef={menuRootRef}
          autoFocus={autoFocusMenu}
          onChange={onChange}
          onChangeDefault={onChangeDefault}
          onPointerEnter={() => {
            if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
          }}
          onPointerLeave={scheduleClose}
        />
      ) : null}
    </>
  );
}
