/**
 * 剪贴板能力封装层（services/api）。
 *
 * 作为渲染层访问 Tauri 剪贴板系统能力的统一入口，
 * 负责读取操作系统剪贴板中的文件路径（例如从文件管理器复制文件后粘贴到编辑器）。
 */
import { invoke } from "@/composables/useTauri";

/**
 * 返回剪贴板中的文件绝对路径列表。非 Windows/macOS 平台返回 []。
 *
 * @returns 剪贴板内文件的绝对路径数组；无文件或平台不支持时为空数组
 * @remarks 调用 Tauri command `get_file_path_in_clipboard`
 */
export async function getFilePathInClipboard(): Promise<string[]> {
  return invoke<string[]>("get_file_path_in_clipboard");
}
