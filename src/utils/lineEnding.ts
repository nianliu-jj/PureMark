/**
 * 换行符（行尾）处理工具。
 *
 * 负责探测系统默认换行符（Windows 为 CRLF，其它平台为 LF），
 * 解析用户在文件设置中选择的换行模式，并提供展示用文案。
 */
import { platform as osPlatform } from "@tauri-apps/plugin-os";
import type { FileTraits } from "@/shared/types/export";

/** 默认换行模式：跟随系统（system）或显式指定 crlf / lf */
export type DefaultLineEndingMode = "system" | FileTraits["lineEnding"];

// 缓存系统换行符探测结果，避免重复调用平台 API
let systemLineEndingPromise: Promise<FileTraits["lineEnding"]> | null = null;

/**
 * 通过浏览器 navigator.userAgent 兜底推断换行符。
 *
 * 当 Tauri 的平台 API 不可用时使用：UA 含 windows 视为 CRLF，否则 LF。
 */
function getNavigatorLineEnding(): FileTraits["lineEnding"] {
  if (typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent)) {
    return "crlf";
  }
  return "lf";
}

/**
 * 获取系统默认换行符（带缓存）。
 *
 * 优先调用 Tauri 平台 API（windows → crlf，其它 → lf），
 * 调用失败时回退到 navigator UA 推断。结果缓存为单例 Promise。
 *
 * @returns 系统换行符（crlf 或 lf）
 */
export async function getSystemLineEnding(): Promise<FileTraits["lineEnding"]> {
  if (!systemLineEndingPromise) {
    systemLineEndingPromise = Promise.resolve(osPlatform())
      .then((platform) => (platform === "windows" ? "crlf" : "lf"))
      .catch(() => getNavigatorLineEnding());
  }

  return systemLineEndingPromise;
}

/**
 * 解析最终生效的换行符。
 *
 * 未指定或选择 "system" 时返回系统默认换行符，否则返回用户指定的换行符。
 *
 * @param mode 用户选择的换行模式（可为 undefined）
 * @returns 实际生效的换行符
 */
export async function resolveDefaultLineEnding(
  mode: DefaultLineEndingMode | undefined
): Promise<FileTraits["lineEnding"]> {
  if (!mode || mode === "system") {
    return getSystemLineEnding();
  }

  return mode;
}

/**
 * 将换行符标识格式化为可读文案。
 *
 * @param lineEnding 换行符（crlf 或 lf）
 * @returns 展示用文案，如 "Windows (CRLF)" 或 "Unix (LF)"
 */
export function formatLineEnding(lineEnding: FileTraits["lineEnding"]): string {
  return lineEnding === "crlf" ? "Windows (CRLF)" : "Unix (LF)";
}
