import { contextBridge, ipcRenderer } from "electron";

const bridge = Object.freeze({
  platform: process.platform,
  pickSpaceDirectory: () => ipcRenderer.invoke("desktop:spaces:pick-directory"),
  revealSpaceDirectory: (rootPath: string) => ipcRenderer.invoke("desktop:spaces:reveal-directory", rootPath),
  getSettings: () => ipcRenderer.invoke("desktop:settings:get"),
  updateLifecycle: (input: unknown) => ipcRenderer.invoke("desktop:settings:update-lifecycle", input),
  updateBrowserAccess: (input: unknown) => ipcRenderer.invoke("desktop:settings:update-browser-access", input),
  revokeBrowserSessions: () => ipcRenderer.invoke("desktop:settings:revoke-browser-sessions"),
  completeBrowserAccessUpdate: () => ipcRenderer.invoke("desktop:settings:complete-browser-update"),
});

contextBridge.exposeInMainWorld("kithDesktop", bridge);
