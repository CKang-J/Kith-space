import {
  countActiveBrowserSessions,
  findActiveBrowserSession,
  insertBrowserSession,
  revokeAllBrowserSessions,
  revokeBrowserSession,
  touchActiveBrowserSession,
} from "../app-data/browserAccessData.js";
import { AccessTokenService } from "./accessTokenService.js";
import { generateSecret, hashSessionToken } from "./tokenCrypto.js";
import type { BrowserSession, CreatedBrowserSession } from "./types.js";

export class BrowserSessionService {
  constructor(private readonly accessTokens = new AccessTokenService()) {}

  async create(accessToken: string): Promise<CreatedBrowserSession | undefined> {
    const tokenRevision = await this.accessTokens.verify(accessToken);
    if (tokenRevision === null) return undefined;

    const token = generateSecret();
    const createdAt = new Date();
    const inserted = insertBrowserSession({
      tokenHash: hashSessionToken(token),
      tokenRevision,
      createdAt,
    });
    if (!inserted) return undefined;
    return { token, tokenRevision, createdAt, lastSeenAt: createdAt };
  }

  authenticate(sessionToken: string): BrowserSession | undefined {
    if (typeof sessionToken !== "string" || sessionToken.length === 0) return undefined;
    return findActiveBrowserSession(hashSessionToken(sessionToken));
  }

  touch(sessionToken: string): boolean {
    if (typeof sessionToken !== "string" || sessionToken.length === 0) return false;
    return touchActiveBrowserSession(hashSessionToken(sessionToken), new Date());
  }

  revoke(sessionToken: string): boolean {
    if (typeof sessionToken !== "string" || sessionToken.length === 0) return false;
    return revokeBrowserSession(hashSessionToken(sessionToken));
  }

  revokeAll(): number {
    return revokeAllBrowserSessions();
  }

  count(): number {
    return countActiveBrowserSessions();
  }
}
