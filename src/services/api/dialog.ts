/**
 * 系统对话框能力封装层（services/api）。
 *
 * 作为渲染层访问 Tauri 原生对话框系统能力的统一入口，
 * 负责打开文件、另存为、覆盖/关闭确认弹窗以及通用的文件/目录选择对话框。
 */
import type { FileTraits, ReadFileResult, SaveFileResult } from "@/shared/types/export";
import { invoke } from "@/composables/useTauri";

/**
 * 弹出系统"打开文件"对话框，让用户选择一个 Markdown 文件并读取其内容。
 *
 * @returns 读取结果（含内容与文件特征）；用户取消时返回 null
 * @remarks 调用 Tauri command `open_file`
 */
export async function openFile(): Promise<ReadFileResult | null> {
  return invoke<ReadFileResult | null>("open_file");
}

/** "另存为"对话框的入参。 */
export interface SaveFileAsArgs {
  /** 待保存的文件文本内容 */
  content: string;
  /** 源文件特征（编码、换行符等），用于保持一致性 */
  fileTraits?: FileTraits;
  /** 无源文件特征时使用的默认换行符 */
  defaultLineEnding?: FileTraits["lineEnding"];
  /** 本地图片存放路径，用于迁移内容引用的本地图片 */
  imageLocalPath?: string;
  /** 对话框默认打开/定位的路径 */
  defaultPath?: string;
  /** 对话框默认填充的文件名 */
  fileName?: string;
}

/**
 * 弹出系统"另存为"对话框，将内容写入用户选择的新位置。
 *
 * @param args 另存为参数，见 {@link SaveFileAsArgs}
 * @returns 保存结果（含最终路径）；用户取消时返回 null
 * @remarks 调用 Tauri command `save_file_as`
 */
export async function saveFileAs(args: SaveFileAsArgs): Promise<SaveFileResult | null> {
  return invoke<SaveFileResult | null>("save_file_as", { args });
}

/** 覆盖确认对话框的返回选项：0=取消 1=覆盖 2=另存为。 */
export type OverwriteChoice = 0 | 1 | 2; // 0=取消 1=覆盖 2=保存
/**
 * 弹出"文件已存在，是否覆盖"确认对话框。
 *
 * @param fileName 冲突的文件名，用于提示文案
 * @returns 用户选择，见 {@link OverwriteChoice}
 * @remarks 调用 Tauri command `show_overwrite_confirm`
 */
export async function showOverwriteConfirm(fileName: string): Promise<OverwriteChoice> {
  return invoke<OverwriteChoice>("show_overwrite_confirm", { fileName });
}

/** 关闭确认对话框的返回选项：0=取消 1=不保存 2=保存。 */
export type CloseChoice = 0 | 1 | 2; // 0=取消 1=不保存 2=保存
/**
 * 弹出"文件未保存，关闭前是否保存"确认对话框。
 *
 * @param fileName 待关闭文件的文件名，用于提示文案
 * @returns 用户选择，见 {@link CloseChoice}
 * @remarks 调用 Tauri command `show_close_confirm`
 */
export async function showCloseConfirm(fileName: string): Promise<CloseChoice> {
  return invoke<CloseChoice>("show_close_confirm", { fileName });
}

/** 通用"打开"对话框的配置项。 */
export interface OpenDialogOptions {
  /** 对话框标题 */
  title?: string;
  /** 默认定位路径 */
  defaultPath?: string;
  /** 文件类型过滤器（名称 + 扩展名列表） */
  filters?: Array<{ name: string; extensions: string[] }>;
  /** 是否选择目录而非文件 */
  directory?: boolean;
  /** 是否允许多选 */
  multiple?: boolean;
}

/** 通用"打开"对话框的返回结果。 */
export interface OpenDialogResult {
  /** 用户是否取消了选择 */
  canceled: boolean;
  /** 选中的文件/目录绝对路径列表 */
  filePaths: string[];
}

/**
 * 弹出通用的"打开文件/目录"对话框。
 *
 * @param options 对话框配置，见 {@link OpenDialogOptions}
 * @returns 选择结果，见 {@link OpenDialogResult}
 * @remarks 调用 Tauri command `show_open_dialog`
 */
export async function showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogResult> {
  return invoke<OpenDialogResult>("show_open_dialog", { options });
}
