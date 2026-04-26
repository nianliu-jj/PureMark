import { invoke } from "@tauri-apps/api/core";
import { platform as osPlatform } from "@tauri-apps/plugin-os";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * 渲染层已处理完未保存提示后，强制关闭当前窗口。
 * 若关闭后无剩余编辑器窗口，应用退出。
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
