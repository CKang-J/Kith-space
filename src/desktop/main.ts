import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  session,
  Tray,
  type IpcMainInvokeEvent,
} from "electron";
import os from "node:os";
import path from "node:path";
import { generateInternalProcessCredentials } from "../local-runtime/internalCredentials.js";
import { DesktopCoreClient } from "./coreClient.js";
import { parseBrowserAccessUpdate, parseLifecycleUpdate } from "./ipcValidation.js";
import { isPortAvailable } from "./portAvailability.js";
import { buildDesktopProcessCommands } from "./processCommands.js";
import { DesktopProcessSupervisor } from "./processSupervisor.js";
import {
  DESKTOP_TRUST_HEADER,
  isAllowedDesktopUrl,
  shouldAttachDesktopTrust,
  type DesktopOriginPolicy,
} from "./securityPolicy.js";

const isDevelopment = process.env.KITH_SPACE_DESKTOP_DEV === "1";
const startHidden = process.argv.includes("--hidden") || process.env.KITH_SPACE_DESKTOP_START_HIDDEN === "1";
const repoRoot = process.env.KITH_SPACE_REPO_ROOT?.trim() || path.resolve(__dirname, "../..");
const kithSpaceHome = process.env.KITH_SPACE_HOME?.trim() || path.join(os.homedir(), ".kith-space");
const uiPort = requirePort(process.env.VITE_PORT ?? "5273", "VITE_PORT");
let activeCredentials = generateInternalProcessCredentials();
const originPolicy: DesktopOriginPolicy = { corePort: 0, ...(isDevelopment ? { uiPort } : {}) };

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let closeBehavior: "tray" | "quit" = "tray";
let coreState: Awaited<ReturnType<DesktopProcessSupervisor["start"]>> | null = null;
let coreClient: DesktopCoreClient | null = null;
let quitting = false;
let shutdownComplete = false;
let pendingProductReload = false;

class DesktopStartupCancelled extends Error {}

const supervisor = new DesktopProcessSupervisor({
  kithSpaceHome,
  commands: processCommands(),
  parentEnv: process.env,
  credentials: () => {
    activeCredentials = generateInternalProcessCredentials();
    return activeCredentials;
  },
  coreReadyTimeoutMs: 30_000,
  onDiagnostic: (diagnostic) => {
    console.error("[desktop]", diagnostic);
    if (diagnostic.type === "process-failure" && mainWindow && !quitting) {
      dialog.showErrorBox("A Kith-space service stopped", diagnostic.failure.message);
      requestQuit();
    }
  },
});

function requirePort(value: string, name: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer from 1 to 65535`);
  }
  return port;
}

function requiredDevelopmentPath(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required by pnpm run desktop:dev`);
  return value;
}

function processCommands() {
  return isDevelopment
    ? buildDesktopProcessCommands({
        mode: "development",
        appRoot: repoRoot,
        resourcesPath: process.resourcesPath,
        executable: requiredDevelopmentPath("KITH_SPACE_NODE_BINARY"),
        tsxCli: requiredDevelopmentPath("KITH_SPACE_TSX_CLI"),
        viteCli: requiredDevelopmentPath("KITH_SPACE_VITE_CLI"),
        uiPort,
      })
    : buildDesktopProcessCommands({
        mode: "packaged",
        appRoot: repoRoot,
        resourcesPath: process.resourcesPath,
        executable: process.execPath,
        uiPort,
      });
}

function launchAtLoginSupported(): boolean {
  return app.isPackaged && (process.platform === "win32" || process.platform === "darwin");
}

function applyLaunchAtLogin(enabled: boolean): void {
  if (!launchAtLoginSupported()) return;
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: ["--hidden"],
  });
}

function trustedSender(event: IpcMainInvokeEvent): boolean {
  const senderUrl = event.senderFrame?.url ?? "";
  return !!mainWindow
    && event.sender.id === mainWindow.webContents.id
    && isAllowedDesktopUrl(senderUrl, originPolicy);
}

function requireTrustedSender(event: IpcMainInvokeEvent): void {
  if (!trustedSender(event)) throw new Error("Desktop settings are unavailable from this renderer");
}

function requireCoreClient(): DesktopCoreClient {
  if (!coreClient || !coreState) throw new Error("Core Service is not ready");
  return coreClient;
}

async function settingsSnapshot() {
  const client = requireCoreClient();
  const [lifecycle, browser] = await Promise.all([
    client.getLifecycleSettings(),
    client.getBrowserAccess(),
  ]);
  closeBehavior = lifecycle.closeBehavior;
  return {
    lifecycle: {
      ...lifecycle,
      launchAtLoginSupported: launchAtLoginSupported(),
    },
    browser: {
      ...browser,
      lanWarning: browser.lanWarning ?? "",
    },
  };
}

function registerDesktopIpc(): void {
  ipcMain.handle("desktop:settings:get", async (event) => {
    requireTrustedSender(event);
    return settingsSnapshot();
  });

  ipcMain.handle("desktop:settings:update-lifecycle", async (event, value: unknown) => {
    requireTrustedSender(event);
    const input = parseLifecycleUpdate(value);
    if (input.launchAtLogin !== undefined && !launchAtLoginSupported()) {
      throw new Error("Launch at login is unavailable in this Desktop build");
    }
    const lifecycle = await requireCoreClient().updateLifecycleSettings(input);
    closeBehavior = lifecycle.closeBehavior;
    if (input.launchAtLogin !== undefined) applyLaunchAtLogin(lifecycle.launchAtLogin);
    return settingsSnapshot();
  });

  ipcMain.handle("desktop:settings:update-browser-access", async (event, value: unknown) => {
    requireTrustedSender(event);
    const input = parseBrowserAccessUpdate(value);
    const client = requireCoreClient();
    const before = await client.getBrowserAccess();
    if (input.port !== undefined && input.port !== before.port) {
      const targetMode = input.mode ?? before.mode;
      const host = targetMode === "lan" ? "0.0.0.0" : "127.0.0.1";
      if (!(await isPortAvailable(input.port, host))) {
        throw new Error(`Port ${input.port} is already in use`);
      }
    }
    const updated = await client.updateBrowserAccess(input);
    let restarted = false;
    if (updated.restartRequired) {
      coreState = await supervisor.restart();
      originPolicy.corePort = coreState.port;
      coreClient = new DesktopCoreClient(() => coreState!.port, activeCredentials.desktopTrustToken);
      restarted = true;
      if (!isDevelopment) {
        pendingProductReload = !!updated.accessToken;
        if (!pendingProductReload) scheduleProductReload();
      }
    }
    return {
      ...(await settingsSnapshot()),
      ...(updated.accessToken ? { accessToken: updated.accessToken } : {}),
      restartRequired: updated.restartRequired,
      restarted,
    };
  });

  ipcMain.handle("desktop:settings:revoke-browser-sessions", async (event) => {
    requireTrustedSender(event);
    await requireCoreClient().revokeBrowserSessions();
    return settingsSnapshot();
  });

  ipcMain.handle("desktop:settings:complete-browser-update", (event) => {
    requireTrustedSender(event);
    if (pendingProductReload) {
      pendingProductReload = false;
      scheduleProductReload();
    }
  });
}

function configureDesktopSession(): Electron.Session {
  const desktopSession = session.fromPartition("persist:kith-space-desktop");
  desktopSession.setPermissionCheckHandler(() => false);
  desktopSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  desktopSession.webRequest.onBeforeSendHeaders(
    { urls: ["http://127.0.0.1/*", "ws://127.0.0.1/*"] },
    (details, callback) => {
      const requestHeaders = { ...details.requestHeaders };
      if (shouldAttachDesktopTrust(details.url, originPolicy)) {
        requestHeaders[DESKTOP_TRUST_HEADER] = activeCredentials.desktopTrustToken;
      }
      callback({ requestHeaders });
    },
  );
  return desktopSession;
}

function showMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray(): void {
  const iconPath = isDevelopment
    ? path.join(repoRoot, "web", "public", "favicon.ico")
    : path.join(process.resourcesPath, "web", "dist", "favicon.ico");
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  tray.setToolTip("Kith-space");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Kith-space", click: showMainWindow },
    { type: "separator" },
    { label: "Quit", click: requestQuit },
  ]));
  tray.on("click", showMainWindow);
}

async function createMainWindow(desktopSession: Electron.Session): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#f3f2ef",
    webPreferences: {
      session: desktopSession,
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedDesktopUrl(url, originPolicy)) event.preventDefault();
  });
  mainWindow.webContents.on("will-redirect", (event, url) => {
    if (!isAllowedDesktopUrl(url, originPolicy)) event.preventDefault();
  });
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  mainWindow.on("close", (event) => {
    if (quitting || shutdownComplete) return;
    event.preventDefault();
    if (closeBehavior === "tray") mainWindow?.hide();
    else requestQuit();
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.once("ready-to-show", () => {
    if (!startHidden) showMainWindow();
  });

  await loadCurrentProduct();
}

function currentProductUrl(): string {
  return isDevelopment
    ? `http://127.0.0.1:${uiPort}`
    : `http://127.0.0.1:${coreState!.port}`;
}

async function loadCurrentProduct(): Promise<void> {
  const productUrl = currentProductUrl();
  const readyUrl = isDevelopment ? productUrl : `${productUrl}/health`;
  await waitForHttp(readyUrl, 20_000);
  await mainWindow?.loadURL(productUrl);
}

function scheduleProductReload(): void {
  setTimeout(() => {
    void loadCurrentProduct().catch((error) => {
      dialog.showErrorBox("Kith-space could not reload", error instanceof Error ? error.message : String(error));
    });
  }, 100);
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch { /* process may still be starting */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Desktop UI did not become ready at ${url}`);
}

async function startCoreWithRecovery(): Promise<Awaited<ReturnType<DesktopProcessSupervisor["start"]>>> {
  while (true) {
    try {
      return await supervisor.start();
    } catch (error) {
      const failure = (error as { failure?: { reportedCode?: string; port?: number } } | null)?.failure;
      if (failure?.reportedCode !== "EADDRINUSE") throw error;
      await supervisor.stop().catch(() => undefined);
      const choice = await dialog.showMessageBox({
        type: "error",
        title: "Kith-space port is in use",
        message: `Port ${failure.port ?? "configured"} is already in use.`,
        detail: "Close the program using this port, then retry. After Kith-space starts, you can choose a different port in Desktop & Web settings.",
        buttons: ["Retry", "Quit"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (choice.response !== 0) throw new DesktopStartupCancelled();
    }
  }
}

function requestQuit(): void {
  if (quitting) return;
  quitting = true;
  void supervisor.stop().then(() => {
    shutdownComplete = true;
    tray?.destroy();
    tray = null;
    app.quit();
  }).catch((error) => {
    quitting = false;
    console.error("[desktop] failed to stop managed processes", error);
    dialog.showErrorBox(
      "Kith-space could not quit safely",
      "One or more managed processes are still running. Kith-space will stay open so you can retry Quit.\n\n" +
        (error instanceof Error ? error.message : String(error)),
    );
    showMainWindow();
  });
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId("space.kith.desktop");
  coreState = await startCoreWithRecovery();
  originPolicy.corePort = coreState.port;
  coreClient = new DesktopCoreClient(() => coreState!.port, activeCredentials.desktopTrustToken);
  const lifecycle = await coreClient.getLifecycleSettings();
  closeBehavior = lifecycle.closeBehavior;
  applyLaunchAtLogin(lifecycle.launchAtLogin);
  registerDesktopIpc();
  createTray();
  await createMainWindow(configureDesktopSession());
  if (process.env.KITH_SPACE_DESKTOP_SMOKE_EXIT_MS) {
    const delay = Number(process.env.KITH_SPACE_DESKTOP_SMOKE_EXIT_MS);
    if (Number.isFinite(delay) && delay >= 0) setTimeout(requestQuit, delay);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);
  app.on("activate", showMainWindow);
  app.on("window-all-closed", () => { /* tray owns the application lifetime */ });
  app.on("before-quit", (event) => {
    if (shutdownComplete) return;
    event.preventDefault();
    requestQuit();
  });
  process.on("SIGINT", requestQuit);
  process.on("SIGTERM", requestQuit);
  process.on("message", (message: unknown) => {
    if ((message as { type?: unknown } | null)?.type === "kith:quit") requestQuit();
  });
  app.whenReady().then(bootstrap).catch(async (error) => {
    console.error("[desktop] startup failed", error);
    let cleanupError: unknown;
    try { await supervisor.stop(); } catch (stopError) { cleanupError = stopError; }
    if (cleanupError) {
      quitting = false;
      dialog.showErrorBox(
        "Kith-space startup cleanup failed",
        "A managed process is still running. Kith-space will stay in the tray so Quit can be retried.\n\n" +
          (cleanupError instanceof Error ? cleanupError.message : String(cleanupError)),
      );
      if (!tray) createTray();
      return;
    }
    if (!quitting && !(error instanceof DesktopStartupCancelled)) {
      dialog.showErrorBox("Kith-space could not start", error instanceof Error ? error.message : String(error));
    }
    shutdownComplete = true;
    app.quit();
  });
}
