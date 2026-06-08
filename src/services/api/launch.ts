/**
 * 启动文件能力封装层（services/api）。
 *
 * 作为渲染层与 Tauri 宿主"启动时打开文件"流程的桥接：
 * renderer 就绪后通知 Rust，Rust 若有待处理的启动文件（双击文件打开 App 等）则 emit 事件，
 * 本模块同时提供该事件的监听封装。
 */
import type { FileTraits } from "@/shared/types/export";
import { invoke, listen } from "@/composables/useTauri";

/** 启动时打开文件事件的负载。 */
export interface OpenFileAtLaunchPayload {
  /** 文件绝对路径 */
  filePath: string;
  /** 文件文本内容 */
  content: string;
  /** 文件特征（编码、换行符等） */
  fileTraits: FileTraits;
}

/**
 * 通知 Rust 端 renderer 已 ready。若之前有 pending 的启动文件，Rust 会立刻 emit
 * `open-file-at-launch` 事件。
 *
 * @remarks 调用 Tauri command `renderer_ready`
 */
export async function notifyRendererReady(): Promise<void> {
  await invoke<void>("renderer_ready");
}

/**
 * 监听启动文件事件。返回 unsubscribe 函数。
 *
 * @param handler 收到启动文件时的回调，见 {@link OpenFileAtLaunchPayload}
 * @returns 取消监听的函数
 * @remarks 监听 Tauri 事件 `open-file-at-launch`
 */
export async function onOpenFileAtLaunch(
  handler: (payload: OpenFileAtLaunchPayload) => void
): Promise<() => void> {
  return listen<OpenFileAtLaunchPayload>("open-file-at-launch", handler);
}
