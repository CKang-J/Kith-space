// Request context threaded through the per-domain route handlers. Each gate in
// handleApi (index.ts) widens the context: public → +userId → +spaceId. Handlers
// destructure exactly the fields they use. Human authority and local Space registration
// are resolved once by the orchestrator instead of being repeated in handlers.
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
