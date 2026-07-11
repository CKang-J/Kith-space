// Request context threaded through the per-domain route handlers. Each gate in
// handleApi (index.ts) widens the context: public → +userId → +spaceId. Handlers
// destructure exactly the fields they use. `member` is intentionally NOT carried —
// the membership check lives in the orchestrator's gate, not in the handlers.
import type { IncomingMessage, ServerResponse } from "node:http";

export interface BaseCtx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  p: string;
}
export interface UserCtx extends BaseCtx {
  userId: string;
}
export interface SpaceCtx extends UserCtx {
  spaceId: string;
}

/** @deprecated A2 adapter for handlers removed or migrated in A2.3/A2.4. */
export interface ServerCtx extends SpaceCtx {
  serverId: string;
}
