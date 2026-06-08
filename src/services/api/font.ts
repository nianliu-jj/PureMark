/**
 * 字体能力封装层（services/api）。
 *
 * 作为渲染层访问 Tauri 系统字体枚举能力的统一入口，
 * 供字体选择器等 UI 列出当前操作系统已安装的字体。
 */
import { invoke } from "@/composables/useTauri";

/**
 * 获取当前操作系统已安装的字体名称列表。
 *
 * @returns 系统字体名称数组
 * @remarks 调用 Tauri command `get_system_fonts`
 */
export async function getSystemFonts(): Promise<string[]> {
  return invoke<string[]>("get_system_fonts");
}
