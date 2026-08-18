import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell } from "electron";
import { ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

type Platform = "bilibili" | "douyin" | "youtube" | "instagram" | "xiaohongshu" | "twitter";
type Browser = "none" | "chrome" | "firefox";
type DownloadRequest = { id: string; url: string; platform: Platform; folder: string; quality: string; browser?: Browser };
type DownloadTask = DownloadRequest & { state: "queued" | "downloading" | "paused" | "cancelled" | "completed" | "failed"; progress: number; detail: string; createdAt: string };
const activeWindows = new Set<BrowserWindow>();
const tasks = new Map<string, DownloadTask>();
const processes = new Map<string, ChildProcess>();
const dockIcon = path.join(__dirname, "../assets/icon.iconset/icon_512x512.png");
app.setName("云帧下载器");

function defaultDownloadFolder() {
  return path.join(app.getPath("downloads"), "云帧下载");
}

function resolveExecutable(name: string) {
  const executable = process.platform === "win32" ? `${name}.exe` : name;
  const searchPaths = process.platform === "darwin"
    ? ["/opt/homebrew/bin", "/usr/local/bin", ...((process.env.PATH ?? "").split(path.delimiter))]
    : (process.env.PATH ?? "").split(path.delimiter);
  return searchPaths.map(folder => path.join(folder, executable)).find(existsSync);
}

function resolveYtDlp() { return resolveExecutable("yt-dlp"); }
function resolveFfmpeg() { return resolveExecutable("ffmpeg"); }

type StoredCookie = { domain: string; path: string; secure: boolean; expirationDate?: number; name: string; value: string; httpOnly?: boolean };
const platformDomains: Record<Platform, string[]> = {
  bilibili: ["bilibili.com"], douyin: ["douyin.com", "iesdouyin.com"], youtube: ["youtube.com"],
  instagram: ["instagram.com"], xiaohongshu: ["xiaohongshu.com"], twitter: ["x.com", "twitter.com"],
};
const platformLoginUrls: Record<Platform, string> = {
  bilibili: "https://passport.bilibili.com/login", douyin: "https://www.douyin.com", youtube: "https://www.youtube.com",
  instagram: "https://www.instagram.com", xiaohongshu: "https://www.xiaohongshu.com", twitter: "https://x.com",
};
function isPlatform(value: unknown): value is Platform { return ["bilibili", "douyin", "youtube", "instagram", "xiaohongshu", "twitter"].includes(String(value)); }
function authFilePath(platform: Platform) { return path.join(app.getPath("userData"), platform === "bilibili" ? "bilibili-auth.enc" : `${platform}-auth.enc`); }
function getStoredCookies(platform: Platform): StoredCookie[] {
  try { return safeStorage.isEncryptionAvailable() ? JSON.parse(safeStorage.decryptString(Buffer.from(readFileSync(authFilePath(platform), "utf8"), "base64"))) as StoredCookie[] : []; } catch { return []; }
}
function authStatus(platform: Platform) { return { signedIn: getStoredCookies(platform).length > 0 }; }
function notifyAuth(platform: Platform) { const status = authStatus(platform); activeWindows.forEach(window => window.webContents.send("platform:auth-update", { platform, ...status })); }
function saveCookies(platform: Platform, cookies: StoredCookie[]) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("系统安全存储不可用");
  writeFileSync(authFilePath(platform), safeStorage.encryptString(JSON.stringify(cookies)).toString("base64"), { encoding: "utf8", mode: 0o600 });
  notifyAuth(platform);
}
function cookieFileForYtDlp(platform: Platform) {
  const cookies = getStoredCookies(platform);
  if (!cookies.length) return undefined;
  const rows = cookies.map(cookie => [cookie.httpOnly ? `#HttpOnly_${cookie.domain}` : cookie.domain, cookie.domain.startsWith(".") ? "TRUE" : "FALSE", cookie.path || "/", cookie.secure ? "TRUE" : "FALSE", String(Math.floor(cookie.expirationDate ?? 0)), cookie.name, cookie.value].join("\t"));
  const file = path.join(app.getPath("temp"), `cloudframe-${platform}-cookies.txt`);
  writeFileSync(file, ["# Netscape HTTP Cookie File", ...rows].join("\n"), { encoding: "utf8", mode: 0o600 });
  return file;
}

function openPlatformLogin(platform: Platform) {
  const loginSession = session.fromPartition(`persist:cloudframe-auth-${platform}`);
  const loginWindow = new BrowserWindow({ width: 520, height: 720, title: `登录 ${platform}`, webPreferences: { partition: `persist:cloudframe-auth-${platform}`, contextIsolation: true, nodeIntegration: false } });
  const isPlatformCookie = (cookie: { domain?: string }) => platformDomains[platform].some(domain => (cookie.domain ?? "").replace(/^\./, "").endsWith(domain));
  const capture = async () => {
    const cookies = (await loginSession.cookies.get({})).flatMap(cookie => cookie.domain && isPlatformCookie(cookie) ? [{
      domain: cookie.domain, path: cookie.path ?? "/", secure: !!cookie.secure, expirationDate: cookie.expirationDate,
      name: cookie.name, value: cookie.value, httpOnly: !!cookie.httpOnly,
    }] : []);
    if (cookies.length) saveCookies(platform, cookies);
  };
  const onChanged = (_event: Electron.Event, cookie: Electron.Cookie) => { if (isPlatformCookie(cookie)) void capture(); };
  loginSession.cookies.on("changed", onChanged);
  loginWindow.on("closed", () => { loginSession.cookies.removeListener("changed", onChanged); void capture(); });
  return loginWindow.loadURL(platformLoginUrls[platform], { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" });
}

function createWindow() {
  const window = new BrowserWindow({ width: 1320, height: 860, minWidth: 1040, minHeight: 700, title: "云帧下载器", backgroundColor: "#f6f7f8", webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false } });
  activeWindows.add(window);
  window.on("closed", () => activeWindows.delete(window));
  const url = process.env.VITE_DEV_SERVER_URL;
  if (url) window.loadURL(url); else window.loadFile(path.join(__dirname, "../dist/index.html"));
}

function notify(item: DownloadTask) { activeWindows.forEach((window) => window.webContents.send("download:progress", item)); }

function updateTask(id: string, update: Partial<DownloadTask>) {
  const previous = tasks.get(id);
  if (!previous) return;
  const next = { ...previous, ...update };
  tasks.set(id, next);
  notify(next);
}

function isDownloadRequest(value: unknown): value is DownloadRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return typeof request.id === "string" && typeof request.folder === "string" && typeof request.quality === "string" && typeof request.url === "string" && (request.browser === undefined || ["none", "chrome", "firefox"].includes(String(request.browser))) && /^https?:\/\//i.test(request.url) && ["bilibili", "douyin", "youtube", "instagram", "xiaohongshu", "twitter"].includes(String(request.platform));
}

app.whenReady().then(() => {
  ipcMain.handle("platform:auth-status", (_event, rawPlatform: unknown) => isPlatform(rawPlatform) ? authStatus(rawPlatform) : { signedIn: false });
  ipcMain.handle("platform:logout", (_event, rawPlatform: unknown) => {
    if (!isPlatform(rawPlatform)) return { signedIn: false };
    try { unlinkSync(authFilePath(rawPlatform)); } catch { /* Already signed out. */ }
    notifyAuth(rawPlatform);
    return authStatus(rawPlatform);
  });
  ipcMain.handle("platform:login", async (_event, rawPlatform: unknown) => {
    if (!isPlatform(rawPlatform)) throw new Error("Invalid platform");
    await openPlatformLogin(rawPlatform);
  });
  if (process.platform === "darwin") app.dock?.setIcon(dockIcon);
  ipcMain.handle("folder:default", () => defaultDownloadFolder());
  ipcMain.handle("folder:choose", async () => (await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] })).filePaths[0]);
  ipcMain.handle("folder:show", (_event, folder: unknown) => typeof folder === "string" ? shell.openPath(folder) : "Invalid folder path");
  ipcMain.handle("download:list", () => Array.from(tasks.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  ipcMain.handle("download:pause", (_event, id: unknown) => {
    const task = typeof id === "string" ? tasks.get(id) : undefined;
    const child = task ? processes.get(task.id) : undefined;
    if (!task || !child || task.state !== "downloading") return { accepted: false };
    if (process.platform === "win32") return { accepted: false };
    child.kill("SIGSTOP");
    updateTask(task.id, { state: "paused", detail: "下载已暂停" });
    return { accepted: true };
  });
  ipcMain.handle("download:resume", (_event, id: unknown) => {
    const task = typeof id === "string" ? tasks.get(id) : undefined;
    const child = task ? processes.get(task.id) : undefined;
    if (!task || !child || task.state !== "paused") return { accepted: false };
    if (process.platform === "win32") return { accepted: false };
    child.kill("SIGCONT");
    updateTask(task.id, { state: "downloading", detail: "继续下载…" });
    return { accepted: true };
  });
  ipcMain.handle("download:cancel", (_event, id: unknown) => {
    const task = typeof id === "string" ? tasks.get(id) : undefined;
    const child = task ? processes.get(task.id) : undefined;
    if (!task || !["queued", "downloading", "paused"].includes(task.state)) return { accepted: false };
    updateTask(task.id, { state: "cancelled", detail: "下载已取消" });
    child?.kill("SIGTERM");
    processes.delete(task.id);
    return { accepted: true };
  });
  ipcMain.handle("download:enqueue", (_event, rawRequest: unknown) => {
    if (!isDownloadRequest(rawRequest)) throw new Error("Invalid download request");
    const request = rawRequest;
    const task: DownloadTask = { ...request, state: "queued", progress: 0, detail: "等待进入传送带", createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) };
    tasks.set(task.id, task);
    notify(task);
    const engine = resolveYtDlp();
    if (!engine) {
      updateTask(request.id, { state: "failed", detail: "未找到 yt-dlp。请安装下载引擎后重试：brew install yt-dlp ffmpeg" });
      return { accepted: true };
    }
    const ffmpeg = resolveFfmpeg();
    if (!ffmpeg) {
      updateTask(request.id, { state: "failed", detail: "未找到 FFmpeg，无法合并音视频。请安装后重试：brew install ffmpeg" });
      return { accepted: true };
    }
    try {
      mkdirSync(request.folder, { recursive: true });
    } catch {
      updateTask(request.id, { state: "failed", detail: "无法创建保存文件夹，请通过“更改”选择一个可写位置。" });
      return { accepted: true };
    }
    const args = [
      "--newline",
      "--no-playlist",
      "--ffmpeg-location", path.dirname(ffmpeg),
      "--merge-output-format", "mp4",
      "--remux-video", "mp4",
      "--no-keep-video",
      "-P", request.folder,
      "-f", request.quality === "best" ? "bv*+ba/b" : "bv*[height<=" + request.quality + "]+ba/b",
    ];
    const cookieFile = cookieFileForYtDlp(request.platform);
    if (cookieFile) args.push("--cookies", cookieFile);
    else if (request.browser && request.browser !== "none") {
      // The browser is read only when the user explicitly selects it for this task.
      // This covers public media that an extractor asks the user to sign in to view.
      args.push("--cookies-from-browser", request.browser);
    }
    args.push(request.url);
    const child = spawn(engine, args, { shell: false });
    processes.set(request.id, child);
    let launchFailed = false;
    updateTask(request.id, { state: "downloading", progress: 1, detail: "正在连接下载引擎…" });
    child.stdout.on("data", (chunk: Buffer) => {
      const text = String(chunk);
      const match = text.match(/\[download\]\s+([\d.]+)%/);
      updateTask(request.id, { state: "downloading", progress: match ? Number(match[1]) : tasks.get(request.id)?.progress, detail: text.trim() });
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const detail = String(chunk).trim();
      const safariAccessDenied = /com\.apple\.Safari\/Data\/Library\/Cookies|Cookies\.binarycookies|Operation not permitted/i.test(detail);
      const browserAccessDenied = /failed to decrypt|permission denied|could not copy.*cookies/i.test(detail);
      const authenticationRequired = /sign in to confirm|fresh cookies.*needed|login required|cookies? .*required/i.test(detail);
      const taskHint = safariAccessDenied || browserAccessDenied
        ? "无法读取所选浏览器的登录状态。请关闭浏览器后重试，或选择另一个浏览器。"
        : authenticationRequired
          ? "该公开链接需要登录状态。请在已登录该平台的 Chrome 或 Firefox 中打开后，在任务中选择对应浏览器重试。"
          : detail;
      updateTask(request.id, { state: "downloading", detail: taskHint });
    });
    child.on("error", () => {
      launchFailed = true;
      updateTask(request.id, { state: "failed", detail: "下载引擎无法启动。请重新安装 yt-dlp 后再试。" });
    });
    child.on("close", (code: number | null) => {
      processes.delete(request.id);
      if (launchFailed) return;
      const previous = tasks.get(request.id);
      if (previous?.state === "cancelled") return;
      updateTask(request.id, { state: code === 0 ? "completed" : "failed", progress: code === 0 ? 100 : previous?.progress, detail: code === 0 ? "音视频已合并为单个 MP4 文件" : previous?.detail && previous.detail !== "正在连接下载引擎…" ? previous.detail : "下载失败，请检查链接、登录状态或平台限制。" });
    });
    return { accepted: true };
  });
  createWindow();
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on("window-all-closed", () => app.quit());
