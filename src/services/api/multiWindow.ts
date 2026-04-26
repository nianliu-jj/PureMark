import type { TearOffTabData } from "@/shared/types/tearoff";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface CreateEditorWindowArgs {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  tabData?: TearOffTabData | null;
  initState?: WindowInitState | null;
  fastCreate?: boolean;
}

export interface CreatedWindow {
  label: string;
}

export interface WindowInitState {
  workspacePath?: string | null;
  fileSidebarVisible?: boolean;
  outlineSidebarVisible?: boolean;
  sidebarVisible?: boolean;
  sidebarTab?: "outline" | "file";
}

export async function createEditorWindow(args: CreateEditorWindowArgs): Promise<CreatedWindow> {
  return invoke<CreatedWindow>("create_editor_window", { args });
}

export async function getWindowInitState(label?: string): Promise<WindowInitState | null> {
  const target = label ?? getCurrentWindow().label;
  return invoke<WindowInitState | null>("get_window_init_state", { label: target });
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function getWindowBounds(label?: string): Promise<WindowBounds | null> {
  const target = label ?? getCurrentWindow().label;
  return invoke<WindowBounds | null>("get_window_bounds", { label: target });
}

export async function changeSaveStatus(isSaved: boolean, label?: string): Promise<void> {
  const target = label ?? getCurrentWindow().label;
  await invoke("change_save_status", { label: target, isSaved });
}

export async function updateWindowOpenFiles(paths: string[], label?: string): Promise<void> {
  const target = label ?? getCurrentWindow().label;
  await invoke("update_window_open_files_cmd", { label: target, paths });
}

export function currentWindowLabel(): string {
  return getCurrentWindow().label;
}

// ── M2：新窗口初始化 + 跨窗口文件去重 ─────────────────────

export async function getInitialTabData(label?: string): Promise<TearOffTabData | null> {
  const target = label ?? getCurrentWindow().label;
  return invoke<TearOffTabData | null>("tab_get_init_data", { label: target });
}

export async function focusFileIfOpen(filePath: string): Promise<{ found: boolean }> {
  const sourceLabel = getCurrentWindow().label;
  return invoke<{ found: boolean }>("file_focus_if_open", { filePath, sourceLabel });
}

export async function onActivateFile(cb: (filePath: string) => void): Promise<UnlistenFn> {
  return getCurrentWindow().listen<string>("tab:activate-file", (event) => {
    cb(event.payload);
  });
}

// ── M3：tear-off + 合并预览 ──────────────────────────────

export async function tearOffTabStart(
  tabData: TearOffTabData,
  screenX: number,
  screenY: number,
  offsetX: number,
  offsetY: number
): Promise<boolean> {
  const sourceLabel = getCurrentWindow().label;
  return invoke<boolean>("tab_tear_off_start", {
    args: { tabData, screenX, screenY, offsetX, offsetY, sourceLabel },
  });
}

export async function tearOffTabEnd(
  screenX: number,
  screenY: number
): Promise<{ action: "created" | "merged" | "failed" }> {
  const sourceLabel = getCurrentWindow().label;
  return invoke<{ action: "created" | "merged" | "failed" }>("tab_tear_off_end", {
    args: { screenX, screenY, sourceLabel },
  });
}

export async function tearOffTabCancel(): Promise<boolean> {
  const sourceLabel = getCurrentWindow().label;
  return invoke<boolean>("tab_tear_off_cancel", { args: { sourceLabel } });
}

export async function onTabMergePreview(
  cb: (tabData: TearOffTabData, screenX: number, screenY: number) => void
): Promise<UnlistenFn> {
  return getCurrentWindow().listen<[TearOffTabData, number, number]>(
    "tab:merge-preview",
    (event) => {
      const [data, x, y] = event.payload;
      cb(data, x, y);
    }
  );
}

export async function onTabMergePreviewUpdate(
  cb: (screenX: number, screenY: number) => void
): Promise<UnlistenFn> {
  return getCurrentWindow().listen<[number, number]>("tab:merge-preview-update", (event) => {
    const [x, y] = event.payload;
    cb(x, y);
  });
}

export async function onTabMergePreviewCancel(cb: () => void): Promise<UnlistenFn> {
  return getCurrentWindow().listen("tab:merge-preview-cancel", () => cb());
}

export async function onTabMergePreviewFinalize(cb: () => void): Promise<UnlistenFn> {
  return getCurrentWindow().listen("tab:merge-preview-finalize", () => cb());
}

export async function onTabMergeIn(cb: (tabData: TearOffTabData) => void): Promise<UnlistenFn> {
  return getCurrentWindow().listen<TearOffTabData>("tab:merge-in", (event) => {
    cb(event.payload);
  });
}

// ── M4：单 Tab 整窗拖拽 ─────────────────────────────────

export async function startWindowDrag(
  tabData: TearOffTabData,
  offsetX: number,
  offsetY: number
): Promise<void> {
  const sourceLabel = getCurrentWindow().label;
  await invoke("window_start_drag", { args: { tabData, offsetX, offsetY, sourceLabel } });
}

export async function stopWindowDrag(): Promise<void> {
  await invoke("window_stop_drag");
}

export async function dropMerge(
  tabData: TearOffTabData,
  screenX: number,
  screenY: number
): Promise<{ action: "merged" | "none" }> {
  const sourceLabel = getCurrentWindow().label;
  return invoke<{ action: "merged" | "none" }>("window_drop_merge", {
    args: { tabData, screenX, screenY, sourceLabel },
  });
}
