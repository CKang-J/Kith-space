/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/layout/DesktopTitlebar.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  memo,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { VscChromeClose, VscChromeMaximize, VscChromeMinimize, VscChromeRestore } from 'react-icons/vsc';
import AppLogo from '@recombyn-native/components/base/AppLogo';
import { cn } from '@recombyn-native/utils/classnames';

function isEditorRoute(pathname: string): boolean {
  return pathname === '/editor' || pathname.startsWith('/editor/');
}

export const DESKTOP_TITLEBAR_H = 35;

type LeadingCtx = {
  leading: ReactNode | null;
  setLeading: (node: ReactNode | null) => void;
};

const DesktopTitlebarLeadingContext = createContext<LeadingCtx | null>(null);

/** Wraps shell so editor (and others) can replace the titlebar brand with page chrome. */
export function DesktopTitlebarProvider({ children }: { children: ReactNode }) {
  const [leading, setLeadingState] = useState<ReactNode | null>(null);
  const setLeading = useCallback((node: ReactNode | null) => {
    setLeadingState(node);
  }, []);
  const value = useMemo(() => ({ leading, setLeading }), [leading, setLeading]);
  return (
    <DesktopTitlebarLeadingContext.Provider value={value}>
      {children}
    </DesktopTitlebarLeadingContext.Provider>
  );
}

/** Register custom leading content; clears on unmount. Null when provider missing. */
export function useSetDesktopTitlebarLeading(): ((node: ReactNode | null) => void) | null {
  return useContext(DesktopTitlebarLeadingContext)?.setLeading ?? null;
}

function useDesktopTitlebarLeading(): ReactNode | null {
  return useContext(DesktopTitlebarLeadingContext)?.leading ?? null;
}

function isTauriShell(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__ || import.meta.env.TAURI_ENV_PLATFORM);
}

/** True when running inside the Tauri desktop shell. */
export function useIsDesktopShell(): boolean {
  return isTauriShell();
}

type WinApi = {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onResized: (cb: () => void) => Promise<() => void>;
};

async function getWin(): Promise<WinApi | null> {
  if (!isTauriShell()) return null;
  try {
    const { getCurrentWindow } = await import('@/features/canvas/adapters/recombynUnavailablePlatform');
    return getCurrentWindow();
  } catch {
    return null;
  }
}

/**
 * Custom titlebar — same `--rail` chrome as the home left nav so the OS bar
 * does not sit as a mismatched light/black strip above the app.
 * Editor can replace the logo/name with home + filename via the leading slot.
 */
function DesktopTitlebar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const leading = useDesktopTitlebarLeading();
  const hideBrand = Boolean(leading) || isEditorRoute(pathname);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    async function subscribeWindowResize() {
      const win = await getWin();
      if (!win || cancelled) return;
      const sync = async () => {
        try {
          setMaximized(await win.isMaximized());
        } catch {
          /* ignore */
        }
      };
      await sync();
      unlisten = await win.onResized(() => {
        sync();
      });
    }
    subscribeWindowResize();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const onMinimize = useCallback(() => {
    async function minimize() {
      const w = await getWin();
      w?.minimize();
    }
    minimize();
  }, []);
  const onToggleMax = useCallback(() => {
    async function toggleMaximize() {
      const w = await getWin();
      w?.toggleMaximize();
    }
    toggleMaximize();
  }, []);
  const onClose = useCallback(() => {
    async function closeWindow() {
      const w = await getWin();
      w?.close();
    }
    closeWindow();
  }, []);

  if (!isTauriShell()) return null;

  return (
    <header
      className="relative z-[80] flex shrink-0 select-none items-stretch border-b border-[var(--line)] bg-[var(--rail)] text-[var(--ink)]"
      style={{ height: DESKTOP_TITLEBAR_H }}
    >
      {hideBrand ? (
        <>
          {leading ? (
            <div className="flex min-w-0 shrink items-center pl-2.5 pr-1">{leading}</div>
          ) : null}
          <div className="min-w-[12px] flex-1" data-tauri-drag-region />
        </>
      ) : (
        <>
          {/* Aligns with 64px home rail — brand mark lives here on desktop. */}
          <div
            className="flex w-16 shrink-0 items-center justify-center"
            data-tauri-drag-region
          >
            <AppLogo size={22} />
          </div>

          <div
            className="flex min-w-0 flex-1 items-center gap-2 pl-0.5"
            data-tauri-drag-region
          >
            <span
              className="truncate text-[13px] font-medium tracking-tight text-[var(--ink)]/90"
              data-tauri-drag-region
            >
              {t('app.name')}
            </span>
          </div>
        </>
      )}

      <div className="flex shrink-0 items-stretch">
        <TitlebarBtn label="Minimize" onClick={onMinimize}>
          <VscChromeMinimize className="h-[14px] w-[14px]" />
        </TitlebarBtn>
        <TitlebarBtn label={maximized ? 'Restore' : 'Maximize'} onClick={onToggleMax}>
          {maximized ? (
            <VscChromeRestore className="h-[14px] w-[14px]" />
          ) : (
            <VscChromeMaximize className="h-[14px] w-[14px]" />
          )}
        </TitlebarBtn>
        <TitlebarBtn label="Close" onClick={onClose} danger>
          <VscChromeClose className="h-[14px] w-[14px]" />
        </TitlebarBtn>
      </div>
    </header>
  );
}

function TitlebarBtn({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'inline-flex w-11 items-center justify-center text-[var(--ink)]/70 transition-colors',
        danger
          ? 'hover:bg-[#e81123] hover:text-white'
          : 'hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] hover:text-[var(--ink)]'
      )}
    >
      {children}
    </button>
  );
}

export default memo(DesktopTitlebar);
