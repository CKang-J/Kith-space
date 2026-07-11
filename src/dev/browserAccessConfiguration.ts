import {
  AccessTokenService,
  BrowserAccessError,
  BrowserAccessPolicy,
  type BrowserAccessMode,
  type BrowserAccessSettings,
} from "../browser-access/index.js";

const BROWSER_ACCESS_MODES = new Set<BrowserAccessMode>(["off", "local", "lan"]);

export type DevelopmentBrowserAccessInput = {
  mode: BrowserAccessMode;
  port?: number;
  accessToken?: string | null;
  rotateToken?: boolean;
};

export type DevelopmentBrowserAccessResult = {
  settings: BrowserAccessSettings;
  /** Present only when this invocation configured a new secret. */
  accessToken?: string;
};

function validateInput(input: DevelopmentBrowserAccessInput): void {
  if (!BROWSER_ACCESS_MODES.has(input.mode)) {
    throw new BrowserAccessError("BROWSER_ACCESS_MODE_INVALID", "Browser access mode is invalid");
  }
  if (input.port !== undefined && (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)) {
    throw new BrowserAccessError(
      "BROWSER_ACCESS_PORT_INVALID",
      "Browser access port must be an integer between 1 and 65535",
    );
  }
}

/** Configure app.db for split-process development without introducing a second auth implementation. */
export async function configureDevelopmentBrowserAccess(
  input: DevelopmentBrowserAccessInput,
): Promise<DevelopmentBrowserAccessResult> {
  validateInput(input);
  const policy = new BrowserAccessPolicy();
  const before = policy.getSettings();
  const tokenWasProvided = input.accessToken !== undefined;
  const needsInitialToken = input.mode !== "off" && !before.hasAccessToken;
  const shouldRotate = input.rotateToken === true || tokenWasProvided || needsInitialToken;

  const rotated = shouldRotate
    ? await new AccessTokenService().rotate(tokenWasProvided ? input.accessToken : undefined)
    : undefined;
  const settings = policy.updateSettings({ mode: input.mode, port: input.port });

  return {
    settings,
    ...(rotated ? { accessToken: rotated.token } : {}),
  };
}
