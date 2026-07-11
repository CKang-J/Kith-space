export type DesktopCloseBehavior = "tray" | "quit";
export type DesktopBrowserMode = "off" | "local" | "lan";

export interface DesktopLifecycleSettings {
  closeBehavior: DesktopCloseBehavior;
  launchAtLogin: boolean;
}

export interface DesktopBrowserAccessSettings {
  mode: DesktopBrowserMode;
  port: number;
  hasAccessToken: boolean;
  tokenRevision: number;
  activeSessions: number;
  lanWarning: string | null;
}

export interface DesktopBrowserAccessUpdate extends DesktopBrowserAccessSettings {
  accessToken?: string;
  restartRequired: boolean;
}

export class DesktopCoreClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DesktopCoreClientError";
  }
}

type FetchLike = typeof fetch;

export class DesktopCoreClient {
  constructor(
    private readonly corePort: () => number,
    private readonly desktopToken: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async request<T>(method: string, pathname: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`http://127.0.0.1:${this.corePort()}${pathname}`, {
      method,
      headers: {
        "x-kith-desktop-token": this.desktopToken,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const message = typeof payload?.error === "string" ? payload.error : `Core Service request failed (${response.status})`;
      throw new DesktopCoreClientError(response.status, message);
    }
    return payload as T;
  }

  getLifecycleSettings(): Promise<DesktopLifecycleSettings> {
    return this.request("GET", "/api/desktop/settings");
  }

  updateLifecycleSettings(input: Partial<DesktopLifecycleSettings>): Promise<DesktopLifecycleSettings> {
    return this.request("PUT", "/api/desktop/settings", input);
  }

  getBrowserAccess(): Promise<DesktopBrowserAccessSettings> {
    return this.request("GET", "/api/desktop/browser-access");
  }

  updateBrowserAccess(input: {
    mode?: DesktopBrowserMode;
    port?: number;
    accessToken?: string | null;
  }): Promise<DesktopBrowserAccessUpdate> {
    return this.request("PUT", "/api/desktop/browser-access", input);
  }

  async revokeBrowserSessions(): Promise<number> {
    const result = await this.request<{ revoked: number }>("POST", "/api/desktop/browser-access/revoke-sessions");
    return result.revoked;
  }
}
