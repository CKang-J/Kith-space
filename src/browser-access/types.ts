export type BrowserAccessMode = "off" | "local" | "lan";

export type BrowserAccessErrorCode =
  | "BROWSER_ACCESS_MODE_INVALID"
  | "BROWSER_ACCESS_PORT_INVALID"
  | "ACCESS_TOKEN_INVALID";

export class BrowserAccessError extends Error {
  constructor(public readonly code: BrowserAccessErrorCode, message: string) {
    super(message);
    this.name = "BrowserAccessError";
  }
}

export interface BrowserAccessSettings {
  mode: BrowserAccessMode;
  port: number;
  hasAccessToken: boolean;
  tokenRevision: number;
}

export interface BrowserListenerPolicy {
  browserEnabled: boolean;
  host: "127.0.0.1" | "0.0.0.0";
  port: number;
}

export interface BrowserSession {
  tokenRevision: number;
  createdAt: Date;
  lastSeenAt: Date;
}

export interface CreatedBrowserSession extends BrowserSession {
  token: string;
}
