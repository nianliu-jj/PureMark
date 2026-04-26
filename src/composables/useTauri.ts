import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * 封装 Tauri invoke，统一错误上报路径。
 * 后续阶段扩展成：统一 loading、重试、日志。
 */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (e) {
    console.error(`[tauri] invoke ${cmd} failed:`, e);
    throw e;
  }
}

export async function listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  return tauriListen<T>(event, (e) => handler(e.payload));
}
