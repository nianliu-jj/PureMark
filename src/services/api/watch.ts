import { invoke, listen } from "@/composables/useTauri";

/** 同步当前正在监听的 md 文件路径集合（差异更新）。 */
export async function watchFiles(filePaths: string[]): Promise<void> {
  await invoke<void>("watch_files", { filePaths });
}

/** 订阅 `file:changed` 事件（外部修改触发）。返回 unsubscribe。 */
export async function onFileChanged(handler: (filePath: string) => void): Promise<() => void> {
  return listen<string>("file:changed", handler);
}

/** 订阅 `workspace:directory-changed` 事件（目录树变化触发，带 300ms 防抖）。 */
export async function onDirectoryChanged(handler: () => void): Promise<() => void> {
  return listen<null>("workspace:directory-changed", () => handler());
}
