import type { IncomingMessage } from "node:http";
import { getHumanProfile } from "../app-data/appDatabase.js";
import { BrowserAccessPolicy, BrowserSessionService, type BrowserAccessMode } from "../browser-access/index.js";
import { isDesktopTrustedRequest } from "../local-runtime/internalCredentials.js";
import { browserOriginAllowed, browserSessionToken } from "./browserSessionHttp.js";

const policy = new BrowserAccessPolicy();
const sessions = new BrowserSessionService();

export type HumanRequestAuth = {
  humanId: string;
  kind: "desktop" | "browser";
  mode: BrowserAccessMode;
  sessionToken?: string;
};

/** Resolve the one local Human through either Desktop trust or a persistent browser session. */
export function authenticateHumanRequest(req: IncomingMessage): HumanRequestAuth | null {
  const human = getHumanProfile();
  if (!human) return null;
  const mode = policy.getSettings().mode;
  if (isDesktopTrustedRequest(req)) return { humanId: human.id, kind: "desktop", mode };
  if (mode === "off" || !browserOriginAllowed(req, mode)) return null;
  const token = browserSessionToken(req);
  if (!token || !sessions.authenticate(token)) return null;
  sessions.touch(token);
  return { humanId: human.id, kind: "browser", mode, sessionToken: token };
}
