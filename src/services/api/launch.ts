import type { FileTraits } from "@/shared/types/export";
import { invoke, listen } from "@/composables/useTauri";

export interface OpenFileAtLaunchPayload {
  filePath: string;
  content: string;
  fileTraits: FileTraits;
}

/**
 * 通知 Rust 端 renderer 已 ready。若之前有 pending 的启动文件，Rust 会立刻 emit
 * `open-file-at-launch` 事件。
 */
export async function notifyRendererReady(): Promise<void> {
  await invoke<void>("renderer_ready");
}

/** 监听启动文件事件。返回 unsubscribe 函数。 */
export async function onOpenFileAtLaunch(
  handler: (payload: OpenFileAtLaunchPayload) => void
): Promise<() => void> {
  return listen<OpenFileAtLaunchPayload>("open-file-at-launch", handler);
}
