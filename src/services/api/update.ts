import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@/composables/useTauri";

export interface UpdateInfo {
  version: string;
  url: string;
  notes: string;
  releasePageUrl: string;
  date?: string | null;
  filename?: string;
  size?: number | null;
}

export interface UpdateStatusPayload {
  status:
    | "idle"
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error";
  info?: UpdateInfo;
  error?: string;
}

export interface UpdateProgressPayload {
  percent: number;
  total: number;
  transferred: number;
}

export interface CheckUpdateOptions {
  silent?: boolean;
}

export async function checkUpdate(options?: CheckUpdateOptions): Promise<UpdateInfo | null> {
  const result = await invoke<{ updateInfo: UpdateInfo } | null>("check_update", {
    silent: options?.silent ?? false,
  });
  return result?.updateInfo ?? null;
}

export async function downloadUpdate(): Promise<string | null> {
  return invoke<string | null>("download_update");
}

export async function cancelUpdate(): Promise<void> {
  await invoke("cancel_update");
}

export async function quitAndInstall(): Promise<void> {
  await invoke("install_update");
}

export async function onUpdateAvailable(handler: (info: UpdateInfo) => void): Promise<UnlistenFn> {
  return getCurrentWindow().listen<UpdateInfo>("update:available", (event) => {
    handler(event.payload);
  });
}

export async function onUpdateStatus(
  handler: (status: UpdateStatusPayload) => void
): Promise<UnlistenFn> {
  return getCurrentWindow().listen<UpdateStatusPayload>("update:status", (event) => {
    handler(event.payload);
  });
}

export async function onDownloadProgress(
  handler: (progress: UpdateProgressPayload) => void
): Promise<UnlistenFn> {
  return getCurrentWindow().listen<UpdateProgressPayload>("update:download-progress", (event) => {
    handler(event.payload);
  });
}
