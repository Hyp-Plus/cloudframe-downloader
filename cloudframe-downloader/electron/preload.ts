import { contextBridge, ipcRenderer } from "electron";

type Browser = "none" | "chrome" | "firefox";
type Platform = "bilibili" | "douyin" | "youtube" | "instagram" | "xiaohongshu" | "twitter";
type EnqueueRequest = { id: string; url: string; platform: Platform; folder: string; quality: string; browser: Browser };

const downloadApi = {
  getPlatformAuthStatus: (platform: Platform) => ipcRenderer.invoke("platform:auth-status", platform),
  startPlatformLogin: (platform: Platform) => ipcRenderer.invoke("platform:login", platform),
  logoutPlatform: (platform: Platform) => ipcRenderer.invoke("platform:logout", platform),
  getDefaultFolder: () => ipcRenderer.invoke("folder:default"),
  chooseFolder: () => ipcRenderer.invoke("folder:choose"),
  showInFolder: (folder: string) => ipcRenderer.invoke("folder:show", folder),
  getTasks: () => ipcRenderer.invoke("download:list"),
  enqueue: (request: EnqueueRequest) => ipcRenderer.invoke("download:enqueue", request),
  pause: (id: string) => ipcRenderer.invoke("download:pause", id),
  resume: (id: string) => ipcRenderer.invoke("download:resume", id),
  cancel: (id: string) => ipcRenderer.invoke("download:cancel", id),
  onTaskUpdate: (callback: (item: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, item: unknown) => callback(item);
    ipcRenderer.on("download:progress", listener);
    return () => ipcRenderer.removeListener("download:progress", listener);
  },
  onPlatformAuthUpdate: (callback: (status: { platform: Platform; signedIn: boolean }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: { platform: Platform; signedIn: boolean }) => callback(status);
    ipcRenderer.on("platform:auth-update", listener);
    return () => ipcRenderer.removeListener("platform:auth-update", listener);
  },
};

contextBridge.exposeInMainWorld("downloadApi", downloadApi);
