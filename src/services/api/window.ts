import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@/composables/useTauri";

const current = () => getCurrentWindow();

export async function minimize(): Promise<void> {
  await current().minimize();
}

/** 切换最大化状态：已最大化则还原；未最大化则最大化。全屏时先退出全屏。 */
export async function toggleMaximize(): Promise<void> {
  const win = current();
  if (await win.isFullscreen()) {
    await win.setFullscreen(false);
    return;
  }
  if (await win.isMaximized()) {
    await win.unmaximize();
  } else {
    await win.maximize();
  }
}

export async function closeWindow(): Promise<void> {
  await current().close();
}

export async function setWindowTitle(title: string): Promise<void> {
  await current().setTitle(title);
}

export async function isMaximized(): Promise<boolean> {
  return current().isMaximized();
}

export async function isFullscreen(): Promise<boolean> {
  return current().isFullscreen();
}

/**
 * 订阅窗口 resize 事件，用于同步"是否最大化"按钮状态。
 * 返回 unsubscribe。
 */
export async function onWindowResized(handler: () => void): Promise<() => void> {
  const unlisten = await current().onResized(() => handler());
  return unlisten;
}

/** 订阅 close-requested 窗口关闭请求事件。 */
export async function onCloseRequested(handler: () => void): Promise<() => void> {
  return listen<null>("tauri://close-requested", () => handler());
}
