/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/layout/AccountSettingsDialog.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useCallback, useEffect, useState, type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  HiOutlineBell,
  HiOutlineBolt,
  HiOutlineCpuChip,
  HiOutlineDocumentText,
  HiOutlineUser,
  HiOutlineXMark,
  HiOutlineCubeTransparent,
} from 'react-icons/hi2';
import { Dialog as HeadlessDialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react';
import { Fragment } from 'react';
import PlansDialog from '@recombyn-native/components/layout/PlansDialog';
import RedeemDialog from '@recombyn-native/components/layout/RedeemDialog';
import WalletLedgerPanel from '@recombyn-native/components/layout/WalletLedgerPanel';
import AgentModelsPanel from '@recombyn-native/components/editor/panels/agent/AgentModelsPanel';
import AccountProfilePanel from '@recombyn-native/components/layout/AccountProfilePanel';
import { useBillingEnabled } from '@recombyn-native/service/wallet';
import AccountNotificationsPanel from '@recombyn-native/components/layout/AccountNotificationsPanel';
import { FloatingToolbar } from '@recombyn-native/components/editor/chrome/FloatingToolbar';
import { isDesktopLocal } from '@recombyn-native/utils/apiBase';
import { cn } from '@recombyn-native/utils/classnames';

/** Content tabs inside the shell (plans / top-up open as separate dialogs). */
export type AccountSettingsTab =
  | 'plans'
  | 'redeem'
  | 'profile'
  | 'agent'
  | 'billing'
  | 'notices';

type ContentTab = 'profile' | 'agent' | 'billing' | 'notices';

type Props = {
  open: boolean;
  onClose: () => void;
  /** Initial section — plans/redeem open their own dialogs. */
  initialTab?: AccountSettingsTab;
};

const CONTENT_ICONS: Record<ContentTab, ReactNode> = {
  profile: <HiOutlineUser className="h-4 w-4" strokeWidth={1.75} />,
  agent: <HiOutlineCpuChip className="h-4 w-4" strokeWidth={1.75} />,
  billing: <HiOutlineDocumentText className="h-4 w-4" strokeWidth={1.75} />,
  notices: <HiOutlineBell className="h-4 w-4" strokeWidth={1.75} />,
};

function toContentTab(tab: AccountSettingsTab): ContentTab {
  if (tab === 'agent' || tab === 'billing' || tab === 'notices') return tab;
  return 'profile';
}

const MOBILE_NAV_BTN =
  'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-medium transition';

/** Small-screen settings nav — fixed to viewport, below the dialog (~20px from bottom). */
function SettingsMobileNavBar({
  tab,
  contentNav,
  onSelectTab,
  onOpenPlans,
  onOpenRedeem,
  hideCommerce,
}: {
  tab: ContentTab;
  contentNav: { id: ContentTab; label: string }[];
  onSelectTab: (id: ContentTab) => void;
  onOpenPlans?: () => void;
  onOpenRedeem?: () => void;
  hideCommerce?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-5 z-[8910] flex justify-center px-4 md:hidden"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <FloatingToolbar
        role="navigation"
        aria-label={t('wallet.settingsTitle')}
        className="pointer-events-auto max-w-full gap-1 overflow-x-auto px-1.5 py-1"
      >
        {!hideCommerce ? (
          <>
            <button
              type="button"
              title={t('wallet.settingsNavPlans')}
              aria-label={t('wallet.settingsNavPlans')}
              onClick={onOpenPlans}
              className={cn(MOBILE_NAV_BTN, 'text-[var(--muted)] hover:text-[var(--ink)]')}
            >
              <HiOutlineCubeTransparent className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              title={t('wallet.settingsNavRedeem')}
              aria-label={t('wallet.settingsNavRedeem')}
              onClick={onOpenRedeem}
              className={cn(MOBILE_NAV_BTN, 'text-[var(--muted)] hover:text-[var(--ink)]')}
            >
              <HiOutlineBolt className="h-4 w-4" strokeWidth={1.75} />
            </button>

            <span className="mx-0.5 h-4 w-px shrink-0 bg-[var(--line)]" aria-hidden />
          </>
        ) : null}

        {contentNav.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              title={item.label}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelectTab(item.id)}
              className={cn(
                MOBILE_NAV_BTN,
                active
                  ? 'bg-[var(--accent-soft)] text-[var(--ink)]'
                  : 'text-[var(--muted)] hover:text-[var(--ink)]'
              )}
            >
              {CONTENT_ICONS[item.id]}
              {active ? <span className="whitespace-nowrap">{item.label}</span> : null}
            </button>
          );
        })}
      </FloatingToolbar>
    </div>
  );
}

/** Settings modal — left rail; plans & top-up open standalone dialogs. */
function AccountSettingsDialog({
  open,
  onClose,
  initialTab = 'profile',
}: Props) {
  const { t } = useTranslation();
  const desktopLocal = isDesktopLocal();
  const billingEnabled = useBillingEnabled();
  const hideBillingUi = desktopLocal || !billingEnabled;
  const [tab, setTab] = useState<ContentTab>(toContentTab(initialTab));
  const [plansOpen, setPlansOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setPlansOpen(false);
      setRedeemOpen(false);
      return;
    }
    // Never auto-open plans/redeem — user clicks the left rail.
    let nextTab: AccountSettingsTab =
      initialTab === 'plans' || initialTab === 'redeem' ? 'billing' : initialTab;
    if (hideBillingUi && nextTab === 'billing') {
      nextTab = 'profile';
    }
    if (desktopLocal && nextTab === 'notices') {
      nextTab = 'profile';
    }
    setTab(toContentTab(nextTab));
    setPlansOpen(false);
    setRedeemOpen(false);
  }, [open, initialTab, desktopLocal, hideBillingUi]);


  const dismiss = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    onClose();
  }, [onClose]);

  const contentNav: { id: ContentTab; label: string }[] = [
    { id: 'profile', label: t('wallet.settingsNavProfile') },
    { id: 'agent', label: t('wallet.settingsNavAgent') },
    ...(!hideBillingUi
      ? [{ id: 'billing' as const, label: t('wallet.settingsNavBilling') }]
      : []),
    ...(!desktopLocal
      ? [{ id: 'notices' as const, label: t('wallet.settingsNavNotices') }]
      : []),
  ];


  const tabCopy: Record<ContentTab, { title: string; subtitle: string }> = {
    profile: { title: t('account.title'), subtitle: t('account.subtitle') },
    agent: { title: t('account.agentTitle'), subtitle: t('account.agentSubtitle') },
    notices: {
      title: t('account.notices.title'),
      subtitle: t('account.notices.subtitle'),
    },
    billing: { title: t('wallet.billingTitle'), subtitle: t('wallet.billingHint') },
  };
  const { title, subtitle } = tabCopy[tab];

  const actionBtn =
    'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left text-[13px] text-[var(--muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]';

  return (
    <>
      <Transition appear show={open} as={Fragment}>
        <HeadlessDialog className="relative z-[8900]" onClose={dismiss}>
          <TransitionChild
            enter="duration-150 ease-out"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="duration-100 ease-in"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/40 backdrop-blur-[4px]" />
          </TransitionChild>

          <div className="fixed inset-0 overflow-y-auto p-3 pb-[4.5rem] sm:p-6 md:pb-6">
            <div className="flex min-h-full items-center justify-center">
              <TransitionChild
                enter="duration-200 ease-out"
                enterFrom="opacity-0"
                enterTo="opacity-100"
                leave="duration-100 ease-in"
                leaveFrom="opacity-100"
                leaveTo="opacity-0"
              >
                {/*
                  Nav must stay a DialogPanel descendant (else outside-click closes the dialog).
                  No transform on this tree so `fixed` still anchors to the viewport.
                */}
                <DialogPanel className="relative w-full max-w-[min(1080px,96vw)]">
                  <div className="flex h-[min(720px,calc(92dvh-4.5rem))] w-full flex-col overflow-hidden rounded-2xl bg-[var(--surface)] shadow-[0_24px_64px_-16px_rgba(0,0,0,0.28)] ring-1 ring-[var(--line)] md:h-[min(720px,92vh)] md:flex-row">
                  <aside className="hidden w-[160px] shrink-0 flex-col bg-[var(--account-rail)] px-2.5 py-5 md:flex lg:w-[200px] lg:px-3 xl:w-[220px]">
                    <h2 className="mb-4 px-2.5 text-[16px] font-bold tracking-tight text-[var(--ink)]">
                      {t('wallet.settingsTitle')}
                    </h2>
                    <nav className="flex flex-1 flex-col gap-0.5">
                      {!hideBillingUi ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setPlansOpen(true)}
                            className={actionBtn}
                          >
                            <HiOutlineCubeTransparent
                              className="h-4 w-4 shrink-0"
                              strokeWidth={1.75}
                            />
                            {t('wallet.settingsNavPlans')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setRedeemOpen(true)}
                            className={actionBtn}
                          >
                            <HiOutlineBolt className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                            {t('wallet.settingsNavRedeem')}
                          </button>

                          <div className="my-2 border-t border-[var(--line)]" />
                        </>
                      ) : null}


                      {contentNav.map((item) => {
                        const active = tab === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setTab(item.id)}
                            className={cn(
                              'flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left text-[13px] transition',
                              active
                                ? 'bg-[var(--accent-soft)] font-semibold text-[var(--ink)]'
                                : 'text-[var(--muted)] hover:bg-[var(--accent-soft)]/70 hover:text-[var(--ink)]'
                            )}
                          >
                            <span className="shrink-0">{CONTENT_ICONS[item.id]}</span>
                            {item.label}
                          </button>
                        );
                      })}
                    </nav>
                  </aside>

                  <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--account-main)]">
                    <header className="border-b border-[var(--line)] px-4 py-4 pr-14 sm:px-6 sm:py-5">
                      <div className="min-w-0">
                        <h3 className="text-[18px] font-bold tracking-tight text-[var(--ink)]">
                          {title}
                        </h3>
                        <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">
                          {subtitle}
                        </p>
                      </div>
                    </header>

                    <button
                      type="button"
                      onClick={dismiss}
                      className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--ink)] sm:right-4 sm:top-4"
                      aria-label="Close"
                    >
                      <HiOutlineXMark className="h-5 w-5" strokeWidth={1.75} />
                    </button>

                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
                      {tab === 'profile' && <AccountProfilePanel />}
                      {tab === 'agent' && (
                        <AgentModelsPanel
                          onRequestUpgrade={
                            hideBillingUi ? undefined : () => setPlansOpen(true)
                          }
                        />
                      )}
                      {tab === 'billing' && !hideBillingUi ? (
                        <WalletLedgerPanel
                          embedded
                          onRequestPlans={() => setPlansOpen(true)}
                          onRequestRedeem={() => setRedeemOpen(true)}
                        />
                      ) : null}

                      {tab === 'notices' && !desktopLocal ? <AccountNotificationsPanel /> : null}
                    </div>
                  </div>
                  </div>

                  <SettingsMobileNavBar
                    tab={tab}
                    contentNav={contentNav}
                    onSelectTab={setTab}
                    hideCommerce={hideBillingUi}
                    onOpenPlans={hideBillingUi ? undefined : () => setPlansOpen(true)}
                    onOpenRedeem={hideBillingUi ? undefined : () => setRedeemOpen(true)}
                  />

                </DialogPanel>
              </TransitionChild>
            </div>
          </div>
        </HeadlessDialog>
      </Transition>

      <PlansDialog open={plansOpen} onClose={() => setPlansOpen(false)} />
      <RedeemDialog open={redeemOpen} onClose={() => setRedeemOpen(false)} />
    </>
  );
}

export default memo(AccountSettingsDialog);
