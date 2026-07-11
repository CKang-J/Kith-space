// Request context threaded through the per-domain route handlers. Each gate in
// handleApi (index.ts) widens the context: public → +humanId → +spaceId. Handlers
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
export interface HumanCtx extends BaseCtx {
  humanId: string;
}
export interface SpaceCtx extends HumanCtx {
  spaceId: string;
}
