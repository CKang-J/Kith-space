import { readFile } from "node:fs/promises";

export class GatewayClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "GatewayClientError";
  }
}

export interface GatewayClientEnvironment {
  endpoint: string;
  sessionHandle: string;
  activationFile: string;
}

export class BrokerGatewayClient {
  constructor(
    private readonly environment: GatewayClientEnvironment,
    private readonly fetcher: typeof fetch = fetch,
    private readonly loadFile: typeof readFile = readFile,
    private readonly transport: "cli" | "mcp" = "cli",
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env, transport: "cli" | "mcp" = "cli"): BrokerGatewayClient {
    return new BrokerGatewayClient({
      endpoint: env.KITH_SPACE_BROKER_ENDPOINT ?? env.KITH_SPACE_SERVER_URL ?? "http://127.0.0.1:7777",
      sessionHandle: env.KITH_SPACE_BROKER_HANDLE ?? "",
      activationFile: env.KITH_SPACE_ACTIVATION_FILE ?? "",
    }, fetch, readFile, transport);
  }

  async request<T = unknown>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers = await this.activationHeaders();
    return this.fetchResult<T>(path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async upload<T = unknown>(path: string, body: FormData): Promise<T> {
    return this.fetchResult<T>(path, { method: "POST", headers: await this.activationHeaders(), body });
  }

  private async activationHeaders(): Promise<Record<string, string>> {
    const { endpoint, sessionHandle, activationFile } = this.environment;
    if (!sessionHandle || !activationFile) throw new GatewayClientError("no active Harness v2 turn", "capability_inactive", 401);
    let activation: { activationId?: unknown; workerGeneration?: unknown };
    try { activation = JSON.parse(await this.loadFile(activationFile, "utf8")); }
    catch { throw new GatewayClientError("turn activation is no longer active", "capability_inactive", 401); }
    if (typeof activation.activationId !== "string" || !Number.isInteger(activation.workerGeneration)) {
      throw new GatewayClientError("turn activation descriptor is invalid", "capability_inactive", 401);
    }
    return {
      "x-kith-session-handle": sessionHandle,
      "x-kith-activation-id": activation.activationId,
      "x-kith-worker-generation": String(activation.workerGeneration),
      "x-kith-gateway-transport": this.transport,
    };
  }

  private async fetchResult<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.fetcher(this.environment.endpoint + path, init);
    const text = await response.text();
    let data: Record<string, unknown> = {};
    try { data = text ? JSON.parse(text) as Record<string, unknown> : {}; }
    catch { data = { raw: text }; }
    if (!response.ok) {
      throw new GatewayClientError(
        typeof data.error === "string" ? data.error : response.statusText,
        typeof data.code === "string" ? data.code : `HTTP_${response.status}`,
        response.status,
        data,
      );
    }
    return data as T;
  }
}
