/**
 * 系统 Shell / 链接能力封装层（services/api）。
 *
 * 作为渲染层访问 Tauri 外链与文件管理器系统能力的统一入口：
 * 解析并打开编辑器中的链接（外链 / 本地 Markdown / 跨窗口定位 / 其它本地文件）、
 * 直接打开外部 URL，以及在系统文件管理器中定位文件。
 */
import { invoke } from "@/composables/useTauri";

/** 打开链接的入参。 */
export interface OpenLinkArgs {
  /** 链接地址（可能是 http(s) 外链、相对/绝对本地路径等） */
  href: string;
  /** 当前文档路径，用于解析相对链接 */
  currentFilePath?: string | null;
}

/**
 * 打开链接的结果，按宿主层判定的链接类型区分：
 * - external：作为外部 URL 打开
 * - markdownOpened：识别为本地 Markdown 并已打开
 * - crossWindowFocused：该文件已在其它窗口打开并被聚焦
 * - localOther：其它类型本地文件（交系统处理）
 * - noop：无可执行操作
 */
export type OpenLinkResult =
  | { kind: "external"; url: string }
  | { kind: "markdownOpened"; filePath: string }
  | { kind: "crossWindowFocused"; filePath: string; windowLabel: string }
  | { kind: "localOther"; path: string }
  | { kind: "noop" };

/**
 * 解析并打开编辑器中的链接，由宿主层决定具体行为。
 *
 * @param args 链接参数，见 {@link OpenLinkArgs}
 * @returns 打开结果，见 {@link OpenLinkResult}
 * @remarks 调用 Tauri command `open_link`
 */
export async function openLink(args: OpenLinkArgs): Promise<OpenLinkResult> {
  return invoke<OpenLinkResult>("open_link", { args });
}

/**
 * 用系统默认浏览器打开外部 URL。
 *
 * @param url 外部链接地址
 * @remarks 调用 Tauri command `open_external`
 */
export async function openExternal(url: string): Promise<void> {
  await invoke<void>("open_external", { url });
}

/**
 * 在系统文件管理器中定位并高亮指定文件。
 *
 * @param filePath 文件绝对路径
 * @remarks 调用 Tauri command `reveal_file_in_folder`
 */
export async function revealFileInFolder(filePath: string): Promise<void> {
  await invoke<void>("reveal_file_in_folder", { filePath });
}
