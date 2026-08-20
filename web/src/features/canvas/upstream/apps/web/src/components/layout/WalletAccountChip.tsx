/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/layout/WalletAccountChip.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useState, memo } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HiOutlineBolt, HiOutlineUser } from 'react-icons/hi2';
import { Dropdown } from '@recombyn-native/components/base';
import type { MenuItemType } from '@recombyn-native/components/base/dropdown/MenuItem';
import UserAccountPanel, { UserAvatar } from '@recombyn-native/components/layout/UserAccountPanel';
import { useBillingEnabled, useWalletSnapshot } from '@recombyn-native/service/wallet';
import { formatTokens } from '@recombyn-native/utils/wallet';
import { buildLoginUrl } from '@recombyn-native/utils/authReturnTo';
import { isDesktopLocal } from '@recombyn-native/utils/apiBase';
import { cn } from '@recombyn-native/utils/classnames';

type Props = {
  className?: string;
};

/** Credit balance + avatar pill. */
function WalletAccountChip({ className }: Props) {
  const { t } = useTranslation();
  const user = useSelector((state: any) => state.auth.user);
  const { tokens } = useWalletSnapshot();
  const billingEnabled = useBillingEnabled();
  const navigate = useNavigate();
  const [accountOpen, setAccountOpen] = useState(false);

  const tip = `${user?.name || user?.email || ''} · ${t('wallet.tokensLeft', {
    count: formatTokens(tokens),
  })}`;


  const guestMenu: MenuItemType[] = [
    {
      key: 'login',
      label: (
        <span className="inline-flex items-center gap-2">
          <HiOutlineUser className="h-4 w-4" />
          {t('home.login')}
        </span>
      ),
    },
  ];

  if (user) {
    // Local desktop or WALLET_BILLING_ENABLED=false → no credit chip.
    const hideCredits = isDesktopLocal() || !billingEnabled;
    return (
      <UserAccountPanel open={accountOpen} onOpenChange={setAccountOpen}>
        <button
          type="button"
          className={cn(
            'pointer-events-auto flex h-8 items-center transition hover:opacity-90',
            hideCredits
              ? 'w-8 justify-center rounded-full bg-[var(--accent-soft)]'
              : 'max-w-[12rem] gap-2 rounded-full bg-[var(--accent-soft)] pl-2.5 pr-0.5',
            className
          )}
          title={hideCredits ? user?.name || user?.email || t('home.account') : tip}
        >
          {!hideCredits ? (
            <span className="inline-flex min-w-0 items-center gap-1 text-[var(--ink)]">
              <HiOutlineBolt className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" aria-hidden />
              <span className="min-w-0 truncate text-[12px] font-semibold tabular-nums tracking-tight">
                {formatTokens(tokens)}
              </span>
            </span>
          ) : null}
          <UserAvatar name={user.name} email={user.email} avatar={user.avatar} size={28} />
        </button>
      </UserAccountPanel>
    );
  }


  return (
    <Dropdown
      trigger="click"
      placement="bottom-end"
      offset={6}
      items={guestMenu}
      onClick={(key) => {
        if (key === 'login') navigate(buildLoginUrl());
      }}
      popupClassName="rounded-lg min-w-[140px] !bg-[var(--surface)] shadow-[0_8px_28px_rgba(12,12,13,0.12)] ring-1 ring-[var(--line)]"
      floatingClassName="z-50"
    >
      <button
        type="button"
        title={t('home.account')}
        className={cn(
          'pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full',
          'bg-[var(--surface)] text-[var(--muted)] ring-1 ring-[var(--line)]',
          'transition hover:text-[var(--ink)] hover:ring-[var(--ink)]/25',
          className
        )}
      >
        <HiOutlineUser className="h-4 w-4" strokeWidth={1.5} aria-hidden />
      </button>
    </Dropdown>
  );
}

export default memo(WalletAccountChip);
