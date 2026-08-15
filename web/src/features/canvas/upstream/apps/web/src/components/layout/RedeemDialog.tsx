/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/layout/RedeemDialog.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useState, memo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Dialog, Input, message } from '@recombyn-native/components/base';
import { apiQuery, getHttpErrorDetail, getHttpErrorMessage, getHttpStatus } from '@recombyn-native/service/client';
import { invalidateWalletCache } from '@recombyn-native/service/wallet';
import { normalizePlanId, type PlanId } from '@recombyn-native/utils/wallet';
import { buildLoginUrl } from '@recombyn-native/utils/authReturnTo';
import { isDesktopLocal } from '@recombyn-native/utils/apiBase';

type RedeemPanelProps = {
  active?: boolean;
  onRedeemed?: () => void;
  /** When set, show cancel that calls this (dialog mode). */
  onCancel?: () => void;
};

type RedeemResult = {
  kind?: string;
  tokensAdded: number;
  tokens: number;
  planId?: string;
  planExpiresAt?: number | null;
  planLocked?: boolean;
};

function redeemErrorMessage(err: unknown, t: (key: string) => string): string {
  const status = getHttpStatus(err);
  const detail = getHttpErrorDetail(err);
  const code =
    detail && typeof detail === 'object' ? String((detail as { code?: unknown }).code || '') : '';
  if (code === 'plan_locked') return t('wallet.planLockedRedeem');
  if (code === 'rate_limited' || status === 429) return t('wallet.redeemRateLimited');
  return getHttpErrorMessage(err, t('wallet.redeemFailed'));
}

/** Redeem form — usable inside settings modal or standalone dialog. */
function RedeemPanel({ active = true, onRedeemed, onCancel }: RedeemPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useSelector((state: any) => state.auth.user);
  const [code, setCode] = useState('');

  const redeemMutation = useMutation(
    apiQuery.walletWalletRedeem.mutationOptions({
      onSuccess: async (raw) => {
        const res = raw as RedeemResult;
        const planId = normalizePlanId(res.planId) as PlanId;
        await invalidateWalletCache();
        if (res.kind === 'plan') {
          message.success(
            t('wallet.redeemPlanSuccess', {
              plan: t(`wallet.plan.${planId}`),
              amount: res.tokensAdded,
            })
          );
        } else {
          message.success(t('wallet.redeemSuccess', { amount: res.tokensAdded }));
        }
        onRedeemed?.();
        setCode('');
      },
    })
  );

  useEffect(() => {
    if (active) setCode('');
  }, [active]);

  const submit = async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      message.error(t('wallet.invalidCardKey'));
      return;
    }
    if (!user) {
      onCancel?.();
      navigate(buildLoginUrl('/home'));
      return;
    }
    try {
      await redeemMutation.mutateAsync({ body: { code: trimmed } });
    } catch (err: unknown) {
      message.error(redeemErrorMessage(err, t));
    }
  };

  const busy = redeemMutation.isPending;

  return (
    <div className="max-w-md">
      <p className="mb-4 text-[13px] leading-relaxed text-[var(--muted)]">
        {t('wallet.redeemHint')}
      </p>
      <div className="mb-1.5 text-[12px] font-medium text-[var(--ink)]">{t('wallet.cardKey')}</div>
      <Input
        value={code}
        onChange={(e: any) => setCode(String(e.target.value || '').toUpperCase())}
        placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
        className="!h-11 !rounded-xl !font-mono !tracking-wider"
        onKeyDown={(e: any) => {
          if (e.key === 'Enter') submit();
        }}
      />
      <div className="mt-5 flex items-center justify-start gap-2">
        {onCancel ? (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-xl border border-[var(--line)] px-3 py-2 text-[12px] font-medium text-[var(--ink)] transition hover:bg-[var(--accent-soft)] disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            submit();
          }}
          className="rounded-xl bg-[var(--ink)] px-3 py-2 text-[12px] font-medium text-[var(--on-brand)] transition hover:opacity-90 disabled:opacity-50"
        >
          {t('wallet.redeemNow')}
        </button>
      </div>
    </div>
  );
}

type DialogProps = {
  open: boolean;
  onClose: () => void;
  onRedeemed?: () => void;
};

/** Standalone redeem dialog (legacy callers). Prefer AccountSettingsDialog. */
function RedeemDialog({ open, onClose, onRedeemed }: DialogProps) {
  const { t } = useTranslation();
  if (isDesktopLocal()) return null;
  const dismiss = () => {
    // Blur before hide — cancel/redeem call parent setState and skip Dialog.onClose blur.
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    onClose();
  };
  return (
    <Dialog
      show={open}
      onClose={dismiss}
      width={440}
      title={t('wallet.redeemTitle')}
      titleClassName="!text-[16px] !font-semibold"
      bodyClassName="pt-1"
      className="!w-full !bg-[var(--surface)] !p-6"
    >
      <RedeemPanel
        active={open}
        onCancel={dismiss}
        onRedeemed={() => {
          onRedeemed?.();
          dismiss();
        }}
      />
    </Dialog>
  );
}

export default memo(RedeemDialog);

const MemoizedRedeemPanel = memo(RedeemPanel);
export { MemoizedRedeemPanel as RedeemPanel };
