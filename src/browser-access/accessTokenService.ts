import {
  readBrowserAccessSettings,
  rotateStoredAccessToken,
} from "../app-data/browserAccessData.js";
import { BrowserAccessError } from "./types.js";
import { encodeAccessToken, generateSecret, verifyAccessToken } from "./tokenCrypto.js";

const MIN_CUSTOM_TOKEN_LENGTH = 16;
const MAX_CUSTOM_TOKEN_LENGTH = 256;

function accessTokenValue(customToken?: string | null): string {
  if (customToken === undefined || customToken === null || customToken.trim() === "") {
    return generateSecret();
  }
  const token = customToken.trim();
  if (token.length < MIN_CUSTOM_TOKEN_LENGTH || token.length > MAX_CUSTOM_TOKEN_LENGTH) {
    throw new BrowserAccessError(
      "ACCESS_TOKEN_INVALID",
      `A custom browser access token must contain between ${MIN_CUSTOM_TOKEN_LENGTH} and ${MAX_CUSTOM_TOKEN_LENGTH} characters`,
    );
  }
  return token;
}

export class AccessTokenService {
  async rotate(customToken?: string | null): Promise<{ token: string; revision: number }> {
    const token = accessTokenValue(customToken);
    const encodedHash = await encodeAccessToken(token);
    const revision = rotateStoredAccessToken(encodedHash);
    return { token, revision };
  }

  async verify(token: string): Promise<number | null> {
    if (typeof token !== "string" || token.length === 0) return null;
    const settings = readBrowserAccessSettings();
    if (!settings.accessTokenHash || settings.tokenRevision < 1) return null;
    return await verifyAccessToken(token, settings.accessTokenHash)
      ? settings.tokenRevision
      : null;
  }
}
