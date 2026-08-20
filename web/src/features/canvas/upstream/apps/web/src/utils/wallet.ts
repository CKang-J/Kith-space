/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/utils/wallet.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Wallet display / catalog helpers — not app state.
 * Balance / plan SoT: TanStack Query via `@/service/wallet`.
 *
 * Unified currency: **积分** (API field `tokens` / `credits` — same balance).
 * Chat, Agent, and image gen all deduct from one wallet.
 */

export type PayMethod = 'wechat' | 'alipay' | 'card';

/** free → plus → pro (3 monthly tiers; ultra kept for legacy accounts). */
export type PlanId = 'free' | 'plus' | 'pro' | 'ultra';

export type LedgerKind = 'redeem' | 'spend' | 'recharge' | 'plan';

export type LedgerEntry = {
  id: string;
  kind: LedgerKind;
  /** Wallet 积分. */
  amount: number;
  method?: PayMethod;
  model?: string;
  detail?: string;
  /** Optional LLM usage metadata (not balance). */
  tokens?: number;
  usageTokens?: number;
  planId?: PlanId;
  balanceAfter: number;
  createdAt: number;
};

export type PlanDef = {
  id: PlanId;
  /** Monthly list price in CNY (0 = free). */
  priceCny: number;
  /** Unified 积分 granted each billing month. */
  creditsIncluded: number;
  /**
   * @deprecated Same as creditsIncluded (unified wallet).
   */
  imageCreditsIncluded?: number;
  /**
   * Free-tier design runs per calendar day (server-enforced when balance < hold).
   */
  dailyRuns?: number;
  recommended?: boolean;
};

/** Free plan may only use Auto + this image model. */
export const FREE_IMAGE_MODEL_ID = 'doubao-seedream-5-0-lite';

/** Align with API ``billing.PLUS_*`` — Plus list ¥49 → 340 积分 face. */
export const PLUS_LIST_PRICE_CNY = 49;
export const PLUS_FACE_CREDITS = 340;

/** How many 积分 equal ¥1 at Plus face value. */
export function creditsPerCny(): number {
  return PLUS_FACE_CREDITS / PLUS_LIST_PRICE_CNY;
}

/** Credit-key face from sell price (no markup). */
export function creditsFromSellPriceCny(priceCny: number): number {
  const n = Number(priceCny);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(1, Math.round(n * creditsPerCny()));
}

/** OSS fallback when `/wallet/plans` is unavailable. Live SKUs come from the API. */
export const PLAN_CATALOG: Record<PlanId, PlanDef> = {
  free: {
    id: 'free',
    priceCny: 0,
    creditsIncluded: 0,
    imageCreditsIncluded: 0,
    dailyRuns: 1,
  },
  /** ¥49 — 340 积分 / mo（与 Intelligence commercial + 扣费锚点一致）. */
  plus: {
    id: 'plus',
    priceCny: 49,
    creditsIncluded: 340,
    imageCreditsIncluded: 340,
    recommended: true,
  },
  pro: {
    id: 'pro',
    priceCny: 149,
    creditsIncluded: 1030,
    imageCreditsIncluded: 1030,
  },
  ultra: {
    id: 'ultra',
    priceCny: 499,
    creditsIncluded: 4000,
    imageCreditsIncluded: 4000,
  },
};

/** Plans shown on the membership picker (3 tiers). */
export const PLAN_ORDER: PlanId[] = ['free', 'plus', 'pro'];

/** Highest plan currently sold in PLAN_ORDER (Pro). Ultra is legacy-only. */
export function isTopOfferedPlan(id: PlanId | string | null | undefined): boolean {
  const pid = normalizePlanId(id);
  const top = PLAN_ORDER[PLAN_ORDER.length - 1] || 'pro';
  return pid === top || pid === 'ultra';
}

/** Map legacy ids → current catalog. */
export function normalizePlanId(raw: unknown): PlanId {
  if (raw === 'free' || raw === 'plus' || raw === 'pro' || raw === 'ultra') return raw;
  if (raw === 'hobby') return 'free';
  if (raw === 'basic') return 'plus';
  if (raw === 'studio' || raw === 'pro_plus' || raw === 'teams' || raw === 'flagship') return 'ultra';
  return 'free';
}

/** Paid plans that unlock Pro-only settings (e.g. custom third-party LLM endpoints later). */
export function planHasProFeatures(id: PlanId | string | null | undefined): boolean {
  const pid = normalizePlanId(id);
  return pid === 'pro' || pid === 'ultra';
}

/** Free: Auto + fixed free image only; paid: any catalog model. */
export function planAllowsModelPick(planId: PlanId | string | null | undefined): boolean {
  return normalizePlanId(planId) !== 'free';
}

/** Any paid membership may add local custom providers (not billed on our wallet). */
export function planAllowsCustomModels(id: PlanId | string | null | undefined): boolean {
  return planAllowsModelPick(id);
}

export function planAllowsModelId(
  planId: PlanId | string | null | undefined,
  modelId: string | null | undefined
): boolean {
  const mid = String(modelId || '').trim();
  if (!mid) return false;
  if (planAllowsModelPick(planId)) return true;
  return mid === 'auto' || mid === FREE_IMAGE_MODEL_ID;
}

export function formatTokens(n: number, opts?: { compact?: boolean }) {
  const v = Number.isFinite(n) ? Math.max(0, n) : 0;
  if (opts?.compact && v >= 1000) return `${Math.round(v / 1000)}k`;
  return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function planLabelKey(id: PlanId) {
  return `wallet.plan.${id}` as const;
}
