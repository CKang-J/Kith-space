/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/layout/WalletLedgerPanel.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useMemo, useState, type ReactNode, memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type {
  PaginatedWalletLedger,
  WalletLedgerDto,
  WalletLedgerKindFilter,
} from '@recombyn-native/models/wallet';
import PlansDialog from '@recombyn-native/components/layout/PlansDialog';
import RedeemDialog from '@recombyn-native/components/layout/RedeemDialog';
import { apiQuery } from '@recombyn-native/service/client';
import { usePlanCatalog, useWalletSnapshot, type WalletSnapshot } from '@recombyn-native/service/wallet';
import {
  formatTokens,
  isTopOfferedPlan,
  normalizePlanId,
  planLabelKey,
  type LedgerEntry,
  type PlanId,
} from '@recombyn-native/utils/wallet';
import { isDesktopLocal } from '@recombyn-native/utils/apiBase';
import { cn } from '@recombyn-native/utils/classnames';
import ProgressBar from '@recombyn-native/components/base/progress';
import { SegmentedControl } from '@recombyn-native/components/base';
import { BrandWordmarkLoader } from '@recombyn-native/components/base/AppLogo';

type Filter = WalletLedgerKindFilter;

const PAGE_SIZE = 15;

type LedgerHeader = {
  tokens: number;
  planId: PlanId;
  planLocked: boolean;
  planExpiresAt: number | null;
};

/** Prefer fields on the ledger page response; else fall back to wallet.me snapshot. */
function ledgerHeaderFromPage(
  page: PaginatedWalletLedger | undefined,
  fallback: Pick<WalletSnapshot, 'tokens' | 'planId' | 'planLocked' | 'planExpiresAt'>
): LedgerHeader {
  let tokens = fallback.tokens;
  if (typeof page?.tokens === 'number') tokens = page.tokens;

  let planId = fallback.planId;
  if (page?.planId) planId = normalizePlanId(page.planId);

  let planLocked = fallback.planLocked;
  if (page?.planLocked !== undefined) planLocked = Boolean(page.planLocked);

  let planExpiresAt = fallback.planExpiresAt;
  if (page?.planExpiresAt !== undefined) {
    if (page.planExpiresAt == null) planExpiresAt = null;
    else planExpiresAt = Number(page.planExpiresAt);
  }

  return { tokens, planId, planLocked, planExpiresAt };
}

function formatPlanExpiry(ts: number, locale?: string) {
  const ms = ts > 1e12 ? ts : ts * 1000;
  try {
    return new Date(ms).toLocaleDateString(locale || undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return new Date(ms).toLocaleDateString();
  }
}

function formatTime(ts: number) {
  try {
    return new Date(ts).toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return String(ts);
  }
}

function toLedgerEntry(row: WalletLedgerDto): LedgerEntry {
  return {
    id: row.id,
    kind: row.kind as LedgerEntry['kind'],
    amount: row.amount,
    balanceAfter: row.balanceAfter,
    detail: row.detail || '',
    createdAt: row.createdAt,
  };
}

function kindLabel(kind: LedgerEntry['kind'], t: (key: string) => string) {
  if (kind === 'redeem') return t('wallet.typeRedeem');
  if (kind === 'recharge') return t('wallet.typeRecharge');
  if (kind === 'plan') return t('wallet.typePlan');
  return t('wallet.typeSpend');
}

/** Optional subtype label for spend rows (all amounts are 积分). */
function isImageCreditSpend(row: LedgerEntry) {
  const d = `${row.detail || ''} ${row.model || ''}`.toLowerCase();
  return (
    d.includes('image') ||
    d.includes('seedream') ||
    d.includes('image tool') ||
    d.includes('removebg') ||
    d.includes('upscale') ||
    d.includes('hydrate')
  );
}

function amountUnitLabel(_row: LedgerEntry, t: (key: string) => string) {
  return t('wallet.unitCredits');
}

function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-xl bg-[var(--account-card)] ring-1 ring-[var(--line)]',
        className
      )}
    >
      {children}
    </div>
  );
}

type Props = {
  /** Rendered inside AccountSettingsDialog — no nested plans/redeem dialogs. */
  embedded?: boolean;
  onRequestPlans?: () => void;
  onRequestRedeem?: () => void;
};

/**
 * Usage & billing — Free / Plus / Pro / Ultra + top-up entry,
 * laid out as plan card → included credits → redeem → ledger.
 */
function WalletLedgerPanel({
  embedded = false,
  onRequestPlans,
  onRequestRedeem,
}: Props = {}) {
  const { t, i18n } = useTranslation();
  const desktopLocal = isDesktopLocal();
  const [searchParams, setSearchParams] = useSearchParams();
  const { tokens: walletTokens, planId: walletPlanId, planLocked: walletPlanLocked, planExpiresAt: walletExpires } =
    useWalletSnapshot();
  const catalog = usePlanCatalog();
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [plansOpen, setPlansOpen] = useState(false);

  const ledgerQuery = useQuery({
    ...apiQuery.walletWalletLedger.queryOptions({
      input: {
        query: { page, pageSize: PAGE_SIZE, kind: filter },
      },
    }),
  });

  const ledgerRes = ledgerQuery.data as PaginatedWalletLedger | undefined;
  const rows = (ledgerRes?.items || []).map(toLedgerEntry);
  const total = Number(ledgerRes?.total) || 0;
  const loading = ledgerQuery.isFetching && !ledgerQuery.data;

  const { tokens, planId, planLocked, planExpiresAt } = ledgerHeaderFromPage(ledgerRes, {
    tokens: walletTokens,
    planId: walletPlanId,
    planLocked: walletPlanLocked,
    planExpiresAt: walletExpires,
  });

  /** Deep-link ?redeem=1 still opens redeem (legacy) 鈥?skip when embedded / local desktop. */
  useEffect(() => {
    if (embedded || desktopLocal) return;
    const flag = (searchParams.get('redeem') || '').trim();
    if (!flag || flag === '0' || flag.toLowerCase() === 'false') return;
    setRedeemOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('redeem');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, embedded, desktopLocal]);

  const openPlans = () => {
    if (desktopLocal) return;
    if (embedded && onRequestPlans) onRequestPlans();
    else setPlansOpen(true);
  };
  const openRedeem = () => {
    if (desktopLocal) return;
    if (embedded && onRequestRedeem) onRequestRedeem();
    else setRedeemOpen(true);
  };

  const plan = catalog[planId] || catalog.free;
  const planLabel = t(planLabelKey(planId));
  const planBlurb = t(`wallet.planBlurb.${planId}`);
  const priceLabel =
    plan.priceCny === 0
      ? t('wallet.priceFree')
      : t('wallet.priceMonthly', { price: plan.priceCny });
  const isFreeDaily = planId === 'free' && (plan.dailyRuns ?? 0) > 0;
  const quotaLabel = isFreeDaily
    ? t('wallet.metaDailyRunsValue', { count: plan.dailyRuns ?? 1 })
    : t('wallet.creditsIncluded', { count: formatTokens(plan.creditsIncluded) });
  const expiresLabel = useMemo(() => {
    if (planId === 'free') return null;
    if (!planExpiresAt || !Number.isFinite(planExpiresAt)) return null;
    return formatPlanExpiry(planExpiresAt, i18n.language);
  }, [planId, planExpiresAt, i18n.language]);
  const creditCap = Math.max(1, plan.creditsIncluded);
  const balance = Math.max(0, Number(tokens) || 0);
  /** Against monthly allotment only (extra card-key credits sit above the bar). */
  const planRemaining = Math.min(balance, creditCap);
  const planUsed = Math.max(0, creditCap - planRemaining);
  const usedPct = Math.min(100, Math.round((planUsed / creditCap) * 100));
  const hasExtra = balance > creditCap;

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: t('wallet.filterAll') },
    { id: 'redeem', label: t('wallet.typeRedeem') },
    { id: 'spend', label: t('wallet.typeSpend') },
  ];

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);
  const canPrev = page > 1;
  const canNext = page < pageCount;

  const goPage = (next: number) => {
    setPage(next);
  };

  const ghostBtn =
    'shrink-0 rounded-xl border border-[var(--line)] bg-[var(--account-card)] px-3 py-1.5 text-[13px] font-medium text-[var(--ink)] transition hover:bg-[var(--accent-soft)]';
  const primaryBtn =
    'shrink-0 rounded-xl bg-[var(--ink)] px-3 py-1.5 text-[13px] font-medium text-[var(--on-brand)] transition hover:opacity-90';

  return (
    <>
      <div className="space-y-4">
        {/* Current plan — Free / Plus / Pro / Ultra */}
        <Card className="flex flex-wrap items-start justify-between gap-4 px-5 py-5">
          <div className="min-w-0 space-y-1">
            <div className="text-[15px] font-medium text-[var(--ink)]">{planLabel}</div>
            <div className="text-[13px] text-[var(--muted)]">
              {priceLabel}
              <span className="mx-1.5 text-[var(--line)]">·</span>
              {quotaLabel}
            </div>
            <p className="pt-1 text-[13px] leading-relaxed text-[var(--muted)]">{planBlurb}</p>
            {expiresLabel ? (
              <p className="pt-1 text-[12px] font-medium text-[var(--ink)]">
                {t('wallet.planExpiresOn', { date: expiresLabel })}
                {planLocked ? (
                  <span className="ml-1.5 font-normal text-[var(--muted)]">
                    · {t('wallet.planExpiresLockedHint')}
                  </span>
                ) : null}
              </p>
            ) : planId !== 'free' ? (
              <p className="pt-1 text-[12px] text-[var(--muted)]">{t('wallet.planExpiresUnknown')}</p>
            ) : null}
          </div>
          {!desktopLocal ? (
            <button type="button" onClick={openPlans} className={ghostBtn}>
              {isTopOfferedPlan(planId) ? t('wallet.adjustPlan') : t('wallet.upgrade')}
            </button>
          ) : null}
        </Card>

        {/* Plan credits (included) */}
        <Card className="overflow-hidden">
          <div className="border-b border-[var(--line)] px-5 py-3.5">
            <h2 className="text-[15px] font-medium text-[var(--ink)]">
              {t('wallet.includedCreditsTitle')}
            </h2>
            <p className="mt-0.5 text-[12px] text-[var(--muted)]">{t('wallet.creditsTip')}</p>
          </div>
          <div className="px-5 py-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-[12px] text-[var(--muted)]">{t('wallet.creditsBalanceItem')}</div>
                <div className="mt-1 text-[22px] font-medium tabular-nums tracking-tight text-[var(--ink)]">
                  {formatTokens(balance)}
                </div>
              </div>
              <div className="text-right text-[12px] text-[var(--muted)]">
                {quotaLabel}
              </div>
            </div>

            {isFreeDaily ? (
              <p className="mt-4 text-[13px] leading-relaxed text-[var(--muted)]">
                {t('wallet.freeDailyHint', { count: plan.dailyRuns ?? 1 })}
              </p>
            ) : (
              <div className="mt-4">
                <div
                  className="mb-1.5 flex items-center justify-between gap-2 text-[12px]"
                >
                  <span className="text-[var(--muted)]">
                    {t('wallet.creditsUsedLabel', { count: formatTokens(planUsed) })}
                  </span>
                  <span className="font-medium text-[var(--ink)]">
                    {t('wallet.creditsRemainLabel', { count: formatTokens(planRemaining) })}
                  </span>
                </div>
                <ProgressBar
                  percent={usedPct}
                  active
                  height={8}
                  aria-label={t('wallet.creditsBarAria', {
                    used: formatTokens(planUsed),
                    remain: formatTokens(planRemaining),
                    total: formatTokens(creditCap),
                  })}
                />
                <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
                  {hasExtra
                    ? t('wallet.creditsExtraHint', {
                        extra: formatTokens(balance - creditCap),
                      })
                    : t('wallet.creditsBarHint', {
                        total: formatTokens(creditCap),
                      })}
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* Card-key redeem — cloud payment channel only */}
        {!desktopLocal ? (
          <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="min-w-0">
              <div className="text-[15px] font-medium text-[var(--ink)]">{t('wallet.redeemTitle')}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">
                {t('wallet.redeemSectionHint')}
              </p>
            </div>
            <button type="button" onClick={openRedeem} className={primaryBtn}>
              {t('wallet.redeem')}
            </button>
          </Card>
        ) : null}

        {/* Ledger */}
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3.5">
            <h2 className="text-[15px] font-medium text-[var(--ink)]">
              {t('wallet.usageActivityTitle')}
            </h2>
            <SegmentedControl
              aria-label={t('wallet.usageActivityTitle')}
              value={filter}
              onChange={(next) => {
                setFilter(next as Filter);
                setPage(1);
              }}
              options={filters.map(({ id, label }) => ({ value: id, label }))}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  <th className="whitespace-nowrap px-5 py-2.5 text-[12px] font-medium text-[var(--muted)]">
                    {t('wallet.colTime')}
                  </th>
                  <th className="min-w-[7.5rem] whitespace-nowrap px-5 py-2.5 text-[12px] font-medium text-[var(--muted)]">
                    {t('wallet.colType')}
                  </th>
                  <th className="min-w-[12rem] px-5 py-2.5 text-[12px] font-medium text-[var(--muted)]">
                    {t('wallet.colDetail')}
                  </th>
                  <th className="min-w-[6.5rem] whitespace-nowrap px-5 py-2.5 text-right text-[12px] font-medium text-[var(--muted)]">
                    {t('wallet.colAmount')}
                  </th>
                  <th className="min-w-[5.5rem] whitespace-nowrap px-5 py-2.5 text-right text-[12px] font-medium text-[var(--muted)]">
                    {t('wallet.colBalance')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-12">
                      <BrandWordmarkLoader label={t('common.loading')} />
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-5 py-12 text-center text-[13px] text-[var(--muted)]"
                    >
                      {t('wallet.billingEmpty')}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const positive =
                      row.kind === 'redeem' || row.kind === 'recharge' || row.kind === 'plan';
                    const amountText = formatTokens(Math.abs(Number(row.amount) || 0));
                    const unit = amountUnitLabel(row, t);
                    return (
                      <tr key={row.id} className="border-b border-[var(--line)] last:border-b-0">
                        <td className="whitespace-nowrap px-5 py-3 text-[13px] text-[var(--ink)]">
                          {formatTime(row.createdAt)}
                        </td>
                        <td className="min-w-[7.5rem] whitespace-nowrap px-5 py-3 text-[13px] text-[var(--ink)]">
                          <span className="inline-flex flex-col gap-0.5">
                            <span>{kindLabel(row.kind, t)}</span>
                            {row.kind === 'spend' ? (
                              <span className="text-[11px] text-[var(--muted)]">
                                {isImageCreditSpend(row)
                                  ? t('wallet.spendAsCredits')
                                  : t('wallet.spendAsChat')}
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="max-w-[300px] px-5 py-3">
                          {row.kind === 'redeem' ? (
                            <span className="text-[13px] text-[var(--ink)]">
                              {row.detail || t('wallet.typeRedeem')}
                            </span>
                          ) : (
                            <div className="min-w-0">
                              <div className="truncate text-[13px] text-[var(--ink)]">
                                {row.model ||
                                  (isImageCreditSpend(row)
                                    ? t('wallet.imageSpendLabel')
                                    : t('wallet.modelUnknown'))}
                              </div>
                              <div className="truncate text-[12px] text-[var(--muted)]">
                                {[
                                  row.detail,
                                  row.usageTokens != null
                                    ? t('wallet.tokensCount', { count: row.usageTokens })
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ') || '—'}
                              </div>
                            </div>
                          )}
                        </td>
                        <td
                          className={cn(
                            'whitespace-nowrap px-5 py-3 text-right text-[13px] tabular-nums',
                            positive ? 'text-[var(--ink)]' : 'text-[var(--muted)]'
                          )}
                        >
                          {positive ? `+${amountText}` : `-${amountText}`}
                          <span className="ml-1 text-[11px] text-[var(--muted)]">{unit}</span>
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right text-[13px] tabular-nums text-[var(--ink)]">
                          {formatTokens(row.balanceAfter)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {total > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] px-5 py-3">
              <div className="text-[12px] text-[var(--muted)]">
                {t('wallet.ledgerShowing', {
                  start: rangeStart,
                  end: rangeEnd,
                  total,
                })}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!canPrev}
                  onClick={() => goPage(page - 1)}
                  className="rounded-xl border border-[var(--line)] px-3 py-1 text-[12px] text-[var(--ink)] transition hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t('wallet.ledgerPrev')}
                </button>
                <span className="text-[12px] tabular-nums text-[var(--muted)]">
                  {page} / {pageCount}
                </span>
                <button
                  type="button"
                  disabled={!canNext}
                  onClick={() => goPage(page + 1)}
                  className="rounded-xl border border-[var(--line)] px-3 py-1 text-[12px] text-[var(--ink)] transition hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t('wallet.ledgerNext')}
                </button>
              </div>
            </div>
          ) : null}
        </Card>
      </div>

      {!embedded ? (
        <>
          <RedeemDialog
            open={redeemOpen}
            onClose={() => setRedeemOpen(false)}
            onRedeemed={() => {
              setPage(1);
              ledgerQuery.refetch();
            }}
          />
          <PlansDialog open={plansOpen} onClose={() => setPlansOpen(false)} />
        </>
      ) : null}
    </>
  );
}

export default memo(WalletLedgerPanel);
