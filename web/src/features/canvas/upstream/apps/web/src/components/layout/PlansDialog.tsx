/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/layout/PlansDialog.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { useEffect, useMemo, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineCheck,
  HiOutlineChevronDown,
  HiOutlineFire,
  HiOutlineHandThumbUp,
} from 'react-icons/hi2';
import { Dialog, message } from '@recombyn-native/components/base';
import { usePlanCatalog, useWalletSnapshot } from '@recombyn-native/service/wallet';
import { PLAN_ORDER, type PlanId } from '@recombyn-native/utils/wallet';
import { isDesktopLocal } from '@recombyn-native/utils/apiBase';
import { cn } from '@recombyn-native/utils/classnames';

type PlansPanelProps = {
  /** When false, skip reset-on-open (always mounted in settings shell). */
  active?: boolean;
  /** Compact grid for settings modal. */
  compact?: boolean;
};

const FAQ_IDS = ['units', 'chat', 'image', 'how'] as const;

/** Plan cards — usable inside settings modal or standalone dialog. */
function PlansPanel({ active = true, compact = false }: PlansPanelProps) {
  const { t, i18n } = useTranslation();
  const { planId: current, planLocked, planExpiresAt } = useWalletSnapshot();
  const catalog = usePlanCatalog();
  const [picked, setPicked] = useState<PlanId>(current);
  const [faqOpen, setFaqOpen] = useState<string | null>('units');

  useEffect(() => {
    if (active) {
      setPicked(current);
      setFaqOpen('units');
    }
  }, [active, current]);

  const expiresLabel = useMemo(() => {
    if (!planLocked || !planExpiresAt || !Number.isFinite(planExpiresAt)) return null;
    const ms = planExpiresAt > 1e12 ? planExpiresAt : planExpiresAt * 1000;
    try {
      return new Date(ms).toLocaleDateString(i18n.language || undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return new Date(ms).toLocaleDateString();
    }
  }, [planLocked, planExpiresAt, i18n.language]);

  const rows = useMemo(
    () =>
      PLAN_ORDER.map((id) => {
        const def = catalog[id];
        const credits = def.creditsIncluded;
        const featuresRaw = t(`wallet.planFeatures.${id}`, {
          returnObjects: true,
          count: credits,
        });
        const capability = Array.isArray(featuresRaw)
          ? featuresRaw.map((x) => String(x))
          : [];
        const features =
          id === 'free'
            ? capability
            : [
                t('wallet.planCreditsGift', { count: credits }),
                t('wallet.planUsageEstimateLong', {
                  chats: credits,
                  images: Math.max(1, Math.round(credits / 2)),
                }),
                ...capability,
              ];
        return {
          id,
          def,
          title: t(`wallet.plan.${id}`),
          code: t(`wallet.planCode.${id}`),
          blurb: t(`wallet.planBlurb.${id}`),
          priceNote:
            id === 'free'
              ? t(`wallet.planPriceNote.${id}`)
              : t('wallet.planUsageEstimate', {
                  chats: credits,
                  images: Math.max(1, Math.round(credits / 2)),
                }),
          features,
          featured: id === 'pro',
          popular: Boolean(def.recommended),
          bestValue: id === 'pro',
        };
      }),
    [t, catalog]
  );

  const choose = (id: PlanId) => {
    setPicked(id);
    if (id === current) return;
    if (planLocked) {
      message.warning(
        expiresLabel
          ? t('wallet.planSwitchAfterExpiry', { date: expiresLabel })
          : t('wallet.planSwitchLocked')
      );
      return;
    }
    message.warning(t('wallet.subscribeOnlineUnavailable'));
  };

  return (
    <div>
      {!compact ? (
        <p className="mb-5 max-w-2xl text-[13px] leading-relaxed text-[var(--muted)]">
          {t('wallet.plansHint')}
          {expiresLabel ? (
            <>
              {' '}
              {t('wallet.planActiveUntil', { date: expiresLabel })}
            </>
          ) : null}
        </p>
      ) : expiresLabel ? (
        <p className="mb-4 text-[12px] leading-relaxed text-[var(--muted)]">
          {t('wallet.planActiveUntil', { date: expiresLabel })}
        </p>
      ) : null}

      <div
        className={cn(
          'mx-auto grid w-full max-w-[820px] grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3.5',
          'lg:grid-cols-3 lg:items-stretch',
          /* 4 aligned bands: header | price | cta | features */
          'lg:[grid-template-rows:auto_auto_auto_1fr]'
        )}
      >
        {rows.map(
          (
            { id, def, title, code, blurb, priceNote, features, featured, popular, bestValue },
            index
          ) => {
            const isCurrent = current === id;
            const isPicked = picked === id;
            const switchBlocked = planLocked && !isCurrent;
            const priceLabel =
              def.priceCny === 0
                ? t('wallet.priceFreeDisplay')
                : t('wallet.priceMonthlyDisplay', { price: def.priceCny });

            let ctaLabel = t('wallet.checkoutSubscribe');
            if (isCurrent) ctaLabel = t('wallet.currentSubscribe');
            else if (switchBlocked) ctaLabel = t('wallet.planSwitchLockedShort');

            let cardBorder =
              'border-[var(--line)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]';
            if (featured) {
              cardBorder =
                'border-[#f07818] shadow-[0_8px_24px_-10px_rgba(240,120,24,0.45)]';
            } else if (isPicked) {
              cardBorder =
                'border-[var(--ink)] shadow-[0_8px_24px_-12px_rgba(0,0,0,0.16)]';
            }

            return (
              <article
                key={id}
                role="button"
                tabIndex={0}
                onClick={() => setPicked(id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setPicked(id);
                  }
                }}
                style={{ animationDelay: `${index * 50}ms` }}
                className={cn(
                  'plans-card relative flex min-h-[580px] flex-col rounded-2xl border bg-[var(--surface)] p-4 pb-14 transition duration-200 sm:p-5 sm:pb-16',
                  'hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-12px_rgba(0,0,0,0.18)]',
                  'lg:row-span-4 lg:grid lg:min-h-0 lg:grid-rows-subgrid lg:gap-0',
                  cardBorder
                )}
              >
                {(popular || bestValue) && (
                  <span className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-md bg-[#f07818] px-2 py-0.5 text-[11px] font-semibold text-white">
                    {popular ? (
                      <HiOutlineFire className="h-3.5 w-3.5" strokeWidth={2} />
                    ) : (
                      <HiOutlineHandThumbUp className="h-3.5 w-3.5" strokeWidth={2} />
                    )}
                    {popular ? t('wallet.planBadgePopular') : t('wallet.planBadgeValue')}
                  </span>
                )}

                {/* Band 1 — title */}
                <header className="pr-16">
                  <h4 className="text-[15px] font-bold uppercase tracking-[0.08em] text-[var(--ink)]">
                    {code}
                  </h4>
                  <p className="mt-1 min-h-[2rem] text-[12px] leading-snug text-[var(--muted)]">
                    {blurb}
                  </p>
                </header>

                {/* Band 2 — price (tight stack like reference) */}
                <div className="mt-3">
                  <p className="text-[28px] font-bold leading-none tracking-tight text-[var(--ink)] tabular-nums">
                    {priceLabel}
                    {def.priceCny > 0 ? (
                      <span className="ml-1 text-[14px] font-semibold text-[var(--muted)]">
                        {t('wallet.perMonth')}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 min-h-[2rem] text-[12px] leading-snug text-[var(--muted)]">
                    {priceNote}
                  </p>
                </div>

                {/* Band 3 — CTA */}
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      choose(id);
                    }}
                    disabled={isCurrent}
                    className={cn(
                      'w-full rounded-xl px-3 py-2.5 text-[13px] font-semibold transition',
                      isCurrent &&
                        'cursor-default border border-[var(--line)] bg-[var(--accent-soft)] text-[var(--muted)]',
                      !isCurrent &&
                        switchBlocked &&
                        'border border-[var(--line)] bg-[var(--accent-soft)] text-[var(--muted)] hover:opacity-90',
                      !isCurrent &&
                        !switchBlocked &&
                        'bg-[var(--ink)] text-[var(--on-brand)] hover:opacity-90 active:scale-[0.98]'
                    )}
                  >
                    {ctaLabel}
                  </button>
                </div>

                {/* Band 4 — features; flex-1 keeps extra white space below the list */}
                <ul className="mt-4 flex flex-1 flex-col gap-2.5 border-t border-[var(--line)] pt-4 pb-1">
                  {features.map((line) => (
                    <li
                      key={line}
                      className="flex items-start gap-2 text-[12px] leading-snug text-[var(--ink)]"
                    >
                      <HiOutlineCheck
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#f07818]"
                        strokeWidth={2.5}
                      />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>

                <p className="sr-only">
                  {title}
                  {isPicked ? ` — ${t('wallet.currentPlan')}` : ''}
                </p>
              </article>
            );
          }
        )}
      </div>

      <section className={cn('mt-12', compact && 'mt-10')}>
        <h3 className="mb-3 text-[15px] font-semibold text-[var(--ink)]">
          {t('wallet.plansFaqTitle')}
        </h3>
        <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
          {FAQ_IDS.map((id, index) => {
            const open = faqOpen === id;
            return (
              <div
                key={id}
                className={cn(index > 0 && 'border-t border-[var(--line)]')}
              >
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setFaqOpen(open ? null : id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition hover:bg-[var(--canvas)]/60"
                >
                  <span className="text-[13px] font-medium text-[var(--ink)]">
                    {t(`wallet.plansFaq.${id}.q`)}
                  </span>
                  <HiOutlineChevronDown
                    className={cn(
                      'h-4 w-4 shrink-0 text-[var(--muted)] transition-transform duration-200',
                      open && 'rotate-180'
                    )}
                    strokeWidth={2}
                  />
                </button>
                {open ? (
                  <div className="px-4 pb-4 pt-0">
                    <p className="text-[12px] leading-relaxed text-[var(--muted)]">
                      {t(`wallet.plansFaq.${id}.a`)}
                    </p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <style>{`
        @keyframes plans-card-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .plans-card {
          animation: plans-card-in 0.35s ease both;
        }
        @media (prefers-reduced-motion: reduce) {
          .plans-card { animation: none; }
        }
      `}</style>
    </div>
  );
}

type DialogProps = {
  open: boolean;
  onClose: () => void;
};

/** Standalone membership dialog. */
function PlansDialog({ open, onClose }: DialogProps) {
  const { t } = useTranslation();
  // Local desktop has no cloud subscription — never surface the catalog.
  if (isDesktopLocal()) return null;
  return (
    <Dialog
      show={open}
      onClose={onClose}
      width={900}
      title={t('wallet.plansTitle')}
      titleClassName="!shrink-0 !px-6 !pb-1 !pt-6 !pr-14 !text-[22px] !font-bold !tracking-tight sm:!px-8 sm:!pt-8"
      bodyClassName="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6 pt-0 sm:px-8 sm:pb-8"
      className="!flex !h-auto !max-h-[min(92vh,900px)] !w-full !max-w-[min(900px,96vw)] !flex-col !overflow-hidden !rounded-2xl !bg-[var(--account-main)] !p-0"
    >
      <PlansPanel active={open} />
    </Dialog>
  );
}

export default memo(PlansDialog);

const MemoizedPlansPanel = memo(PlansPanel);
export { MemoizedPlansPanel as PlansPanel };
