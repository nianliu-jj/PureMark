import { invoke } from "@/composables/useTauri";

/** 返回剪贴板中的文件绝对路径列表。非 Windows/macOS 平台返回 []。 */
export async function getFilePathInClipboard(): Promise<string[]> {
  return invoke<string[]>("get_file_path_in_clipboard");
}
