/// <reference types="vite/client" />
import type { DownloadApi } from "./download";
declare global {
  interface Window {
    downloadApi?: DownloadApi;
  }
}
export {};
