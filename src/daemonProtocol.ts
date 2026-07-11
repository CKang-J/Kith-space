// Shared local worker/server WebSocket control-plane constants. Imported by both sides so the
// transport contract cannot drift.

// RFC 6455 private close code for a bad development bootstrap key. Retrying an unchanged key
// cannot succeed, so the worker client backs off to its cap and reports the cause.
export const WORKER_REJECTED_CODE = 4001;

// A newer installation-local Worker superseded this connection. Unlike a transient network close,
// retrying from the old process would only evict the new authoritative Worker and create a reconnect loop.
export const WORKER_REPLACED_CODE = 4002;
