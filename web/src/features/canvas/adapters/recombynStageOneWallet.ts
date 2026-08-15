import { PLAN_CATALOG, type PlanDef, type PlanId } from "@recombyn-native/utils/wallet";

export interface WalletSnapshot {
  tokens: number;
  planId: PlanId;
  planExpiresAt: number | null;
  planLocked: boolean;
  billingEnabled: boolean;
  creditsIncluded: number;
}

const EMPTY_WALLET: WalletSnapshot = {
  tokens: 0,
  planId: "free",
  planExpiresAt: null,
  planLocked: false,
  billingEnabled: false,
  creditsIncluded: PLAN_CATALOG.free.creditsIncluded,
};

/** Stage 1 wallet seam: the native shell renders without billing or network access. */
export function usePlanCatalog(): Record<PlanId, PlanDef> { return PLAN_CATALOG; }
export function useWalletSnapshot(): WalletSnapshot { return EMPTY_WALLET; }
export function useBillingEnabled(): boolean { return false; }
export function useWalletMeQuery(): any { return { data: undefined, isPending: false, isFetched: true, isError: false }; }
export function useAuthBillingConfigQuery(): any { return { data: { billingEnabled: false }, isPending: false, isFetched: true, isError: false }; }
export function walletDtoToSnapshot(): WalletSnapshot { return EMPTY_WALLET; }
export async function invalidateWalletCache(): Promise<void> {}
export function clearWalletCache(): void {}
