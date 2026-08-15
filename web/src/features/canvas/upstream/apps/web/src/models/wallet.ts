/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/models/wallet.ts
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
/**
 * Wallet DTO types — HTTP via `apiClient` / `apiQuery`.
 */

import type { PlanId } from '@recombyn-native/utils/wallet';

export type WalletLedgerDto = {
  id: string;
  kind: 'redeem' | 'spend' | 'plan' | 'recharge';
  amount: number;
  balanceAfter: number;
  detail?: string;
  createdAt: number;
};

export type WalletDto = {
  tokens: number;
  planId?: PlanId | string;
  /** Unix seconds; null when free / unset. */
  planExpiresAt?: number | null;
  /** True while a paid plan is still within its term. */
  planLocked?: boolean;
  /** Platform credit billing (WALLET_BILLING_ENABLED); false on self-host / local. */
  billingEnabled?: boolean;
  ledger: WalletLedgerDto[];
};

export type RedeemResultDto = {
  kind?: 'token' | 'plan' | string;
  tokensAdded: number;
  tokens: number;
  planId?: PlanId | string;
  planExpiresAt?: number | null;
  planLocked?: boolean;
  ledger: WalletLedgerDto[];
};

export type WalletLedgerKindFilter = 'all' | 'redeem' | 'spend';

export type PaginatedWalletLedger = {
  tokens: number;
  planId?: PlanId | string;
  planExpiresAt?: number | null;
  planLocked?: boolean;
  items: WalletLedgerDto[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  kind: WalletLedgerKindFilter | string;
};
