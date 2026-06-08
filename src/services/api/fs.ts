/**
 * 文件系统能力封装层（services/api）。
 *
 * 作为渲染层访问 Tauri 文件系统系统能力的统一入口，负责：
 * 按路径读写 Markdown 文件、判断只读、移动文件、写入临时图片以及清理本地图片。
 */
import type { FileTraits, ReadFileResult, SaveFileResult } from "@/shared/types/export";
import { invoke } from "@/composables/useTauri";

/**
 * 按绝对路径读取文件内容。
 *
 * @param filePath 文件绝对路径
 * @returns 读取结果（含内容与文件特征）；文件不存在等情况返回 null
 * @remarks 调用 Tauri command `read_file_by_path`
 */
export async function readFileByPath(filePath: string): Promise<ReadFileResult | null> {
  return invoke<ReadFileResult | null>("read_file_by_path", { filePath });
}

/**
 * 判断指定文件是否为只读。
 *
 * @param filePath 文件绝对路径
 * @returns 只读返回 true，否则 false
 * @remarks 调用 Tauri command `is_read_only`
 */
export async function isReadOnly(filePath: string): Promise<boolean> {
  return invoke<boolean>("is_read_only", { filePath });
}

/** 按路径保存文件的入参。 */
export interface SaveFileArgs {
  /** 目标文件绝对路径 */
  filePath: string;
  /** 待写入的文本内容 */
  content: string;
  /** 源文件特征（编码、换行符等），用于保持一致性 */
  fileTraits?: FileTraits;
  /** 无源文件特征时使用的默认换行符 */
  defaultLineEnding?: FileTraits["lineEnding"];
  /** 本地图片存放路径，用于迁移内容引用的本地图片 */
  imageLocalPath?: string;
}

/**
 * 将内容保存到已知路径的文件（覆盖写）。
 *
 * @param args 保存参数，见 {@link SaveFileArgs}
 * @returns 保存结果（含最终路径与文件特征）
 * @remarks 调用 Tauri command `save_file`
 */
export async function saveFile(args: SaveFileArgs): Promise<SaveFileResult> {
  return invoke<SaveFileResult>("save_file", { args });
}

/**
 * 将文件移动到指定目录。
 *
 * @param filePath 源文件绝对路径
 * @param targetDir 目标目录绝对路径
 * @returns 移动后文件的新绝对路径
 * @remarks 调用 Tauri command `move_file_to_directory`
 */
export async function moveFileToDirectory(filePath: string, targetDir: string): Promise<string> {
  return invoke<string>("move_file_to_directory", { filePath, targetDir });
}

/** 写入临时图片的入参。 */
export interface WriteTempImageArgs {
  /** 图片二进制数据 */
  file: Uint8Array;
  /** 目标存放路径 */
  targetPath: string;
  /** 当前正在编辑的文件路径，用于计算相对图片目录 */
  currentFilePath?: string | null;
  /** 指定的图片文件名 */
  fileName?: string;
  /** 图片 MIME 类型，用于推断扩展名 */
  mimeType?: string;
}

/**
 * 将图片二进制写入本地临时/目标位置，返回可供编辑器引用的路径。
 *
 * 注意：`file` 为 Uint8Array，需先转为普通数组（`Array.from`）才能经 IPC 传给 Rust。
 *
 * @param args 写入参数，见 {@link WriteTempImageArgs}
 * @returns 写入后图片的路径
 * @remarks 调用 Tauri command `write_temp_image`
 */
export async function writeTempImage(args: WriteTempImageArgs): Promise<string> {
  return invoke<string>("write_temp_image", {
    args: {
      file: Array.from(args.file),
      targetPath: args.targetPath,
      currentFilePath: args.currentFilePath,
      fileName: args.fileName,
      mimeType: args.mimeType,
    },
  });
}

/**
 * 清理内容中不再被引用的本地图片文件。
 *
 * @param content 当前文档内容，宿主层据此判断哪些本地图片仍被引用
 * @remarks 调用 Tauri command `cleanup_local_images`
 */
export async function cleanupLocalImages(content: string): Promise<void> {
  await invoke<void>("cleanup_local_images", { content });
}
