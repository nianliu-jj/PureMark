/**
 * 窗口关闭流程能力封装层（services/api）。
 *
 * 作为渲染层访问 Tauri 窗口关闭系统能力的统一入口，
 * 负责拦截操作系统关闭请求、在渲染层处理完未保存提示后强制关闭窗口，
 * 以及 macOS 主窗口"关闭即隐藏"的特殊行为。
 */
import { invoke } from "@tauri-apps/api/core";
import { platform as osPlatform } from "@tauri-apps/plugin-os";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * 渲染层已处理完未保存提示后，强制关闭当前窗口。
 * 若关闭后无剩余编辑器窗口，应用退出。
 *
 * @param label 目标窗口标签；省略时取当前窗口的 label
 * @remarks 调用 Tauri command `close_discard`
 */
export async function closeDiscard(label?: string): Promise<void> {
  const target = label ?? getCurrentWindow().label;
  await invoke("close_discard", { label: target });
}

/**
 * 拦截 OS 关闭请求（点窗口关闭按钮 / Alt+F4 / Cmd+W 等）。
 * handler 里自行处理未保存 tab 流程；最终调 `force()` 完成关闭。
 *
 * 注意：与 `api/window.ts::onCloseRequested` 不同——后者只做监听，不拦截。
 * 本函数会 `event.preventDefault()`，把关闭决策交给 handler。
 *
 * @param handler 关闭回调；接收一个 `close` 函数，调用它即执行 closeDiscard 完成关闭
 * @returns 取消监听的函数，调用后解除 onCloseRequested 绑定
 */
export async function interceptCloseRequest(
  handler: (close: () => Promise<void>) => Promise<void> | void
): Promise<() => void> {
  return getCurrentWindow().onCloseRequested(async (event) => {
    event.preventDefault();
    await handler(() => closeDiscard());
  });
}

/**
 * macOS 主窗口的关闭按钮应仅隐藏窗口（而非退出应用）；
 * 其他窗口 / 其他平台：照常关闭。
 *
 * 返回 true 表示已处理（上层不应再调 closeDiscard）。
 */
export async function handleMacMainWindowHide(): Promise<boolean> {
  try {
    if ((await osPlatform()) !== "macos") return false;
  } catch {
    return false;
  }
  const win = getCurrentWindow();
  if (win.label !== "main") return false;
  await win.hide();
  return true;
}
