export const HARNESS_ERROR_CODES = [
  "harness_mode_conflict",
  "session_generation_stale",
  "worker_generation_stale",
  "attempt_lease_conflict",
  "attempt_lease_expired",
  "capability_inactive",
  "capability_expired",
  "capability_revoked",
  "capability_scope_denied",
  "delivery_already_bound",
  "delivery_not_actionable",
  "required_input_unresolved",
  "output_missing",
  "idempotency_conflict",
  "stale_context",
  "reply_target_denied",
  "disclosure_denied",
  "context_capacity_exhausted",
  "mcp_bootstrap_failed",
  "hook_bridge_missing",
  "runtime_resume_missing",
  "snapshot_generation_stale",
] as const;

export type HarnessErrorCode = typeof HARNESS_ERROR_CODES[number];

export class HarnessError extends Error {
  constructor(
    public readonly code: HarnessErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "HarnessError";
  }
}
