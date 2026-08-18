export type Platform = "bilibili" | "douyin" | "youtube" | "instagram" | "xiaohongshu" | "twitter";
export type Browser = "none" | "chrome" | "firefox";
export type TaskState = "queued" | "downloading" | "paused" | "cancelled" | "completed" | "failed";

export type DownloadTask = {
  id: string;
  url: string;
  platform: Platform;
  state: TaskState;
  progress: number;
  detail: string;
  createdAt: string;
  folder?: string;
  quality?: string;
  browser?: Browser;
};

export type EnqueueRequest = Pick<DownloadTask, "id" | "url" | "platform"> & {
  folder: string;
  quality: string;
  browser: Browser;
};

export type DownloadApi = {
  getPlatformAuthStatus: (platform: Platform) => Promise<{ signedIn: boolean }>;
  startPlatformLogin: (platform: Platform) => Promise<void>;
  logoutPlatform: (platform: Platform) => Promise<void>;
  getDefaultFolder: () => Promise<string>;
  chooseFolder: () => Promise<string | undefined>;
  showInFolder: (folder: string) => Promise<string>;
  getTasks: () => Promise<DownloadTask[]>;
  enqueue: (request: EnqueueRequest) => Promise<{ accepted: boolean }>;
  pause: (id: string) => Promise<{ accepted: boolean }>;
  resume: (id: string) => Promise<{ accepted: boolean }>;
  cancel: (id: string) => Promise<{ accepted: boolean }>;
  retry: (id: string) => Promise<{ accepted: boolean }>;
  onTaskUpdate: (callback: (item: DownloadTask) => void) => () => void;
  onPlatformAuthUpdate: (callback: (status: { platform: Platform; signedIn: boolean }) => void) => () => void;
};
