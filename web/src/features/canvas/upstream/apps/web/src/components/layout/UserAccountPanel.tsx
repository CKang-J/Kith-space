/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/layout/UserAccountPanel.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  memo,
} from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
} from '@/features/canvas/adapters/recombynFloatingUi';
import {
  HiOutlineArrowRightOnRectangle,
  HiOutlineBolt,
  HiOutlineChevronLeft,
  HiOutlineChevronRight,
  HiOutlineGlobeAlt,
  HiOutlineInformationCircle,
  HiOutlineUserCircle,
} from 'react-icons/hi2';
import { TbShirt } from 'react-icons/tb';
import { message } from '@recombyn-native/components/base';
import AccountSettingsDialog, {
  type AccountSettingsTab,
} from '@recombyn-native/components/layout/AccountSettingsDialog';
import PlansDialog from '@recombyn-native/components/layout/PlansDialog';
import { apiQuery, queryClient } from '@recombyn-native/service/client';
import { logout as logoutRemote } from '@recombyn-native/service/auth';
import { clearProjectsListCache } from '@recombyn-native/service/projects';
import { clearWalletCache, useBillingEnabled, useWalletSnapshot } from '@recombyn-native/service/wallet';
import { logout, setSession, clearSessionCaches } from '@recombyn-native/store/modules/auth';
import { clearProjectsLibrary } from '@recombyn-native/store/modules/editor';
import { formatTokens, planLabelKey, type PlanId } from '@recombyn-native/utils/wallet';
import { getToken } from '@recombyn-native/utils/token';
import { docsUrl, openExternalUrl } from '@recombyn-native/utils/docsUrl';
import { SUPPORTED_LANGS } from '@recombyn-native/i18n';
import { buildLocaleSwitchUrl, normalizeI18nLang, writeStoredI18nLang } from '@recombyn-native/i18n/localePath';
import { applyTheme, getStoredThemeMode, type ThemeMode } from '@recombyn-native/theme';
import { isDesktopLocal } from '@recombyn-native/utils/apiBase';
import { cn } from '@recombyn-native/utils/classnames';

const NARROW_MQ = '(max-width: 767px)';

function useNarrowViewport() {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(NARROW_MQ).matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia(NARROW_MQ);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return narrow;
}
function userInitial(name?: string, email?: string) {
  const raw = (name || email || 'U').trim();
  return (raw[0] || 'U').toUpperCase();
}

/** OAuth / system placeholders — show initials instead of a generic silhouette. */
function isPlaceholderAvatarUrl(url: string | null | undefined): boolean {
  const raw = (url || '').trim();
  if (!raw) return true;
  const low = raw.toLowerCase();
  if (low === 'null' || low === 'undefined' || low === 'none') return true;
  // Google OAuth default photo (…/a/default)
  if (low.includes('googleusercontent.com') && /\/a\/default(?:[/?#]|$)/i.test(low)) {
    return true;
  }
  if (/\/a\/default(?:[/?#]|$)/i.test(low)) return true;
  return false;
}

/** Shared avatar — same image / brand fallback everywhere (chip + menu). */
function UserAvatar({
  name,
  email,
  avatar,
  size = 40,
  className,
}: {
  name?: string | null;
  email?: string | null;
  avatar?: string | null;
  size?: number;
  className?: string;
}) {
  const url = typeof avatar === 'string' && avatar.trim() ? avatar.trim() : null;
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    setImgFailed(false);
  }, [url]);

  const dim = `${size}px`;
  const isBrandLogo =
    url != null && /\/logo(-mark|192|512)?\.png(?:\?|$)/i.test(url.split('?')[0] || '');
  if (url && isBrandLogo) {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-[var(--line)]',
          className
        )}
        style={{ width: dim, height: dim, backgroundColor: '#ffffff' }}
      >
        <img
          src="/logo-mark.png"
          alt=""
          className="h-[86%] w-[86%] object-contain"
          draggable={false}
        />
      </span>
    );
  }
  if (url && !isPlaceholderAvatarUrl(url) && !imgFailed) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        className={cn(
          'shrink-0 rounded-full object-cover ring-1 ring-[var(--line)]',
          className
        )}
        style={{ width: dim, height: dim }}
        onError={() => setImgFailed(true)}
      />
    );
  }
  const fontSize = Math.max(11, Math.round(size * 0.36));
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--accent)] font-semibold text-[var(--on-brand)]',
        className
      )}
      style={{ width: dim, height: dim, fontSize }}
    >
      {userInitial(name || undefined, email || undefined)}
    </span>
  );
}

const LANG_LABEL: Record<string, string> = {
  en: 'English',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  ja: '日本語',
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
};

type FlyoutKind = 'lang' | 'theme' | null;

const MENU_ICON = 'h-[18px] w-[18px] shrink-0';
const MENU_STROKE = 1.6;
/** Same width as Back chevron so option labels line up with "Back" text. */
const DRILL_LEAD = 'inline-flex h-4 w-4 min-w-4 shrink-0 items-center justify-center';

function MenuRow({
  icon,
  label,
  onClick,
  trailing,
  active,
}: {
  icon?: ReactNode;
  label: string;
  onClick?: () => void;
  trailing?: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-[13px] text-[var(--ink)] transition hover:bg-[var(--accent-soft)]',
        active && 'bg-[var(--accent-soft)]'
      )}
    >
      {icon ? <span className="inline-flex shrink-0 text-[var(--ink)]">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}

/** Drill option / back row. Lead (e.g. Back chevron) only when provided — no empty icon slot. */
function DrillListRow({
  label,
  onClick,
  active,
  leading,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  leading?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-1 rounded-lg px-2.5 py-2.5 text-left text-[13px] text-[var(--ink)] transition hover:bg-[var(--accent-soft)]',
        active && 'bg-[var(--accent-soft)] font-medium'
      )}
    >
      {leading ? (
        <span className={DRILL_LEAD} aria-hidden>
          {leading}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function DrillBackRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="mb-1">
      <DrillListRow
        label={label}
        onClick={onClick}
        leading={
          <HiOutlineChevronLeft className="h-4 w-4" strokeWidth={MENU_STROKE} aria-hidden />
        }
      />
    </div>
  );
}

/** Prefer opening to the right (chevron direction); flip left only when clipped. */
function SideFlyout({ children }: { children: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [side, setSide] = useState<'right' | 'left'>('right');

  useLayoutEffect(() => {
    const el = wrapRef.current;
    const row = el?.parentElement;
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const need = 160;
    const spaceRight = window.innerWidth - rect.right - 8;
    setSide(spaceRight >= need ? 'right' : 'left');
  }, []);

  const sideClass =
    side === 'right'
      ? 'left-full pl-[calc(0.5rem+10px)]'
      : 'right-full pr-[calc(0.5rem+10px)]';

  return (
    <div ref={wrapRef} className={cn('absolute top-0 z-10', sideClass)}>
      <div
        className={cn(
          'min-w-[148px] overflow-hidden rounded-lg bg-[var(--surface)] py-1',
          'shadow-[0_12px_40px_rgba(12,12,13,0.16)] ring-1 ring-[var(--line)]'
        )}
        style={{ backgroundColor: 'var(--surface)' }}
      >
        {children}
      </div>
    </div>
  );
}

function UserAccountPanel({ open, onOpenChange, children }: Props) {
  const { t, i18n } = useTranslation();
  const user = useSelector((state: any) => state.auth.user);
  const { tokens, planId } = useWalletSnapshot();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const desktopLocal = isDesktopLocal();
  const billingEnabled = useBillingEnabled();
  /** Hide plans / redeem / balance when local desktop or WALLET_BILLING_ENABLED=false. */
  const hideBillingUi = desktopLocal || !billingEnabled;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<AccountSettingsTab>(
    hideBillingUi ? 'profile' : 'billing'
  );

  const [plansOpen, setPlansOpen] = useState(false);
  const [flyout, setFlyout] = useState<FlyoutKind>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredThemeMode());
  const narrow = useNarrowViewport();

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange,
    placement: narrow ? 'bottom' : 'bottom-end',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
    ],
  });
  const click = useClick(context);
  // mousedown: remounting lang/theme drill-in on click must not count as outsidePress
  // (detached click target would close the whole menu on small screens).
  const dismiss = useDismiss(context, { outsidePressEvent: 'mousedown' });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);

  useEffect(() => {
    if (!open) setFlyout(null);
  }, [open]);

  useEffect(() => {
    if (!open || !user || !getToken()) return;
    let cancelled = false;
    async function hydrateAccount() {
      try {
        const meRes = (await queryClient.ensureQueryData({
          ...apiQuery.authAuthMe.queryOptions(),
          staleTime: 30_000,
        })) as {
          user: {
            id?: string;
            email: string;
            name: string;
            avatar?: string | null;
            provider: string;
            bio?: string | null;
            role?: string;
          };
        };
        if (cancelled || !getToken()) return;
        dispatch(
          setSession({
            user: {
              id: meRes.user.id,
              email: meRes.user.email,
              name: meRes.user.name,
              avatar: meRes.user.avatar,
              provider: meRes.user.provider,
              bio: meRes.user.bio,
              role: meRes.user.role,
            },
            token: getToken() || undefined,
          })
        );
      } catch {
        /* ignore */
      }
      try {
        await queryClient.ensureQueryData({
          ...apiQuery.walletWalletMe.queryOptions(),
          staleTime: 30_000,
        });
      } catch {
        /* ignore */
      }
    }
    hydrateAccount();
    return () => {
      cancelled = true;
    };
  }, [open, user?.id, dispatch]);

  const close = () => onOpenChange(false);

  const currentLang = normalizeI18nLang(i18n.resolvedLanguage || i18n.language);
  const currentLangLabel = LANG_LABEL[currentLang] || LANG_LABEL.en;

  const themeOptions: { mode: ThemeMode; label: string }[] = [
    { mode: 'light', label: t('theme.light') },
    { mode: 'dark', label: t('theme.dark') },
    { mode: 'system', label: t('theme.system') },
  ];
  const themeOption =
    themeOptions.find((o) => o.mode === themeMode) || themeOptions[themeOptions.length - 1];
  const themeLabel = themeOption.label;
  const planLabel = t(planLabelKey(planId as PlanId));

  const doLogout = () => {
    dispatch(logout());
    dispatch(clearProjectsLibrary());
    clearSessionCaches();
    clearProjectsListCache();
    clearWalletCache();
    async function logoutRemoteSession() {
      try {
        await logoutRemote();
      } catch {
        /* ignore */
      }
    }
    logoutRemoteSession();
    message.success(t('home.loggedOut'));
    close();
    navigate('/home', { replace: true });
  };

  const changeLang = (code: string) => {
    setFlyout(null);
    close();
    if (normalizeI18nLang(code) === currentLang) return;
    writeStoredI18nLang(code);
    // Remount Router with new basename (`/zh/home` ↔ `/home`).
    window.location.assign(buildLocaleSwitchUrl(code));
  };

  const changeTheme = (next: ThemeMode) => {
    applyTheme(next);
    setThemeMode(next);
    setFlyout(null);
    close();
  };

  const openSettings = (tab: AccountSettingsTab = hideBillingUi ? 'profile' : 'billing') => {
    close();
    setSettingsTab(
      hideBillingUi && (tab === 'billing' || tab === 'plans' || tab === 'redeem')
        ? 'profile'
        : tab
    );
    setSettingsOpen(true);
  };

  const openPlans = () => {
    if (hideBillingUi) return;
    close();
    setPlansOpen(true);
  };


  return (
    <>
      <div ref={refs.setReference} {...getReferenceProps()} className="inline-flex">
        {children}
      </div>
      {open ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className={cn(
              'z-[600] max-w-[calc(100vw-16px)]',
              narrow ? 'w-[min(100vw-1.5rem,280px)]' : 'w-[250px]'
            )}
          >
            <div
              className={cn(
                'rounded-xl shadow-[0_12px_40px_rgba(12,12,13,0.16)] ring-1 ring-[var(--line)]',
                // Narrow: drill-in; desktop: overflow-visible so side flyouts can paint outside.
                narrow ? 'overflow-hidden' : 'overflow-visible'
              )}
              style={{ backgroundColor: 'var(--surface)' }}
            >
              {/* Header */}
              <div className="flex items-center gap-3 px-3.5 pb-3 pt-3.5">
                <UserAvatar
                  name={user?.name}
                  email={user?.email}
                  avatar={user?.avatar}
                  size={40}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold text-[var(--ink)]">
                    {user?.name || user?.email || t('home.account')}
                  </div>
                  {user?.email ? (
                    <div className="mt-0.5 truncate text-[12px] text-[var(--muted)]">
                      {user.email}
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Plan + upgrade — cloud / web only; hide while narrow drill-in */}
              {!(narrow && flyout) && !hideBillingUi ? (

                <div className="border-t border-[var(--line)] px-3.5 py-3">
                  <button
                    type="button"
                    onClick={() => openSettings('billing')}
                    className="mb-2.5 flex w-full items-center gap-2 text-left"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--ink)]">
                      {planLabel}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-[13px] tabular-nums text-[var(--muted)]">
                      <HiOutlineBolt className="h-3.5 w-3.5" strokeWidth={MENU_STROKE} aria-hidden />
                      {formatTokens(tokens)}
                      <HiOutlineChevronRight className="h-3.5 w-3.5" aria-hidden />
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={openPlans}
                    className="flex w-full items-center justify-center rounded-xl bg-[var(--ink)] px-3 py-2.5 text-[13px] font-medium text-[var(--on-brand)] transition hover:opacity-90"
                  >
                    {t('wallet.upgrade')}
                  </button>
                </div>
              ) : null}

              {/* Menu — narrow: drill-in; desktop: side flyout */}
              <div
                className={cn(
                  'border-t border-[var(--line)]',
                  narrow && (flyout === 'lang' || flyout === 'theme')
                    ? 'px-2 py-2'
                    : 'px-1.5 py-1.5'
                )}
              >
                {narrow && flyout === 'lang' ? (
                  <>
                    <DrillBackRow label={t('common.back')} onClick={() => setFlyout(null)} />
                    {SUPPORTED_LANGS.map(({ code }) => (
                      <DrillListRow
                        key={code}
                        label={LANG_LABEL[code]}
                        active={currentLang === code}
                        onClick={() => changeLang(code)}
                      />
                    ))}
                  </>
                ) : narrow && flyout === 'theme' ? (
                  <>
                    <DrillBackRow label={t('common.back')} onClick={() => setFlyout(null)} />
                    {themeOptions.map(({ mode, label }) => (
                      <DrillListRow
                        key={mode}
                        label={label}
                        active={themeMode === mode}
                        onClick={() => changeTheme(mode)}
                      />
                    ))}
                  </>
                ) : (
                  <>
                    <div
                      className="relative"
                      onMouseEnter={() => {
                        if (!narrow) setFlyout('lang');
                      }}
                      onMouseLeave={() => {
                        if (!narrow) setFlyout((v) => (v === 'lang' ? null : v));
                      }}
                    >
                      <MenuRow
                        icon={
                          <HiOutlineGlobeAlt
                            className={MENU_ICON}
                            strokeWidth={MENU_STROKE}
                            aria-hidden
                          />
                        }
                        label={currentLangLabel}
                        active={flyout === 'lang'}
                        onClick={() => setFlyout((v) => (v === 'lang' ? null : 'lang'))}
                        trailing={
                          <HiOutlineChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                        }
                      />
                      {!narrow && flyout === 'lang' ? (
                        <SideFlyout>
                          {SUPPORTED_LANGS.map(({ code }) => (
                            <button
                              key={code}
                              type="button"
                              onClick={() => changeLang(code)}
                              className={cn(
                                'flex w-full items-center px-3 py-2 text-left text-[13px] text-[var(--ink)] transition hover:bg-[var(--accent-soft)]',
                                currentLang === code && 'font-medium'
                              )}
                            >
                              {LANG_LABEL[code]}
                            </button>
                          ))}
                        </SideFlyout>
                      ) : null}
                    </div>

                    <div
                      className="relative"
                      onMouseEnter={() => {
                        if (!narrow) setFlyout('theme');
                      }}
                      onMouseLeave={() => {
                        if (!narrow) setFlyout((v) => (v === 'theme' ? null : v));
                      }}
                    >
                      <MenuRow
                        icon={
                          <TbShirt className={MENU_ICON} strokeWidth={MENU_STROKE} aria-hidden />
                        }
                        label={`${t('theme.label')} · ${themeLabel}`}
                        active={flyout === 'theme'}
                        onClick={() => setFlyout((v) => (v === 'theme' ? null : 'theme'))}
                        trailing={
                          <HiOutlineChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                        }
                      />
                      {!narrow && flyout === 'theme' ? (
                        <SideFlyout>
                          {themeOptions.map(({ mode, label }) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => changeTheme(mode)}
                              className={cn(
                                'flex w-full items-center px-3 py-2 text-left text-[13px] text-[var(--ink)] transition hover:bg-[var(--accent-soft)]',
                                themeMode === mode && 'font-medium'
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </SideFlyout>
                      ) : null}
                    </div>

                    <MenuRow
                      icon={
                        <HiOutlineUserCircle
                          className={MENU_ICON}
                          strokeWidth={MENU_STROKE}
                          aria-hidden
                        />
                      }
                      label={t('wallet.menuManageAccount')}
                      onClick={() => openSettings('profile')}
                    />

                    <MenuRow
                      icon={
                        <HiOutlineInformationCircle
                          className={MENU_ICON}
                          strokeWidth={MENU_STROKE}
                          aria-hidden
                        />
                      }
                      label={t('about.title')}
                      onClick={() => {
                        close();
                        openExternalUrl(docsUrl('/legal/about'));
                      }}
                    />
                  </>
                )}
              </div>

              {/* Logout — hide while narrow drill-in */}
              {!(narrow && flyout) ? (
                <div className="border-t border-[var(--line)] px-1.5 py-1.5">
                  <MenuRow
                    icon={
                      <HiOutlineArrowRightOnRectangle
                        className={MENU_ICON}
                        strokeWidth={MENU_STROKE}
                        aria-hidden
                      />
                    }
                    label={t('home.logout')}
                    onClick={doLogout}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </FloatingPortal>
      ) : null}

      <AccountSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialTab={settingsTab}
      />
      <PlansDialog open={plansOpen} onClose={() => setPlansOpen(false)} />
    </>
  );
}

export { userInitial, UserAvatar };

export default memo(UserAccountPanel);
