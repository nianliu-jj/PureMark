import type { FileTraits } from "@/shared/types/export";
import type { Tab } from "@/types/tab";
import { isReadOnly, readFileByPath } from "@/services/api";

export interface FileContent {
  filePath: string;
  content: string;
  readOnly?: boolean;
  fileTraits?: FileTraits;
}

export interface OpenFileOptions {
  filePath: string;
  checkReadOnly?: boolean;
}

/**
 * 读取文件并处理内容。Rust 宿主层已完成：
 *   - 文件存在性与扩展名校验
 *   - FileTraits 检测（BOM/换行）
 *   - normalize_markdown + cleanup_protocol_urls
 */
export async function readAndProcessFile(options: OpenFileOptions): Promise<FileContent | null> {
  const { filePath, checkReadOnly = true } = options;

  try {
    const result = await readFileByPath(filePath);
    if (!result) {
      console.error("无法读取文件:", filePath);
      return null;
    }

    const readOnly = checkReadOnly ? await isReadOnly(filePath) : false;

    return {
      filePath: result.filePath,
      content: result.content,
      readOnly,
      fileTraits: result.fileTraits,
    };
  } catch (error) {
    console.error("读取和处理文件失败:", filePath, error);
    return null;
  }
}

/**
 * 从文件路径读取并创建 Tab 数据结构。
 * 不包含添加到 tabs 列表的逻辑，仅创建 Tab 对象。
 */
export function createTabDataFromFile(
  filePath: string,
  content: string,
  options: { fileTraits?: FileTraits } = {}
): Omit<Tab, "id"> {
  const { fileTraits } = options;

  const readOnly = false;
  const fileName = filePath.split(/[\\/]/).at(-1) || "Untitled";

  return {
    name: fileName,
    filePath,
    content,
    originalContent: content,
    isModified: false,
    scrollRatio: 0,
    readOnly,
    fileTraits,
  };
}

/**
 * 批量读取文件（用于启动时或拖拽多个文件）。
 */
export async function readMultipleFiles(filePaths: string[]): Promise<FileContent[]> {
  const results = await Promise.allSettled(
    filePaths.map((fp) => readAndProcessFile({ filePath: fp }))
  );

  return results
    .filter((r): r is PromiseFulfilledResult<FileContent | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((r): r is FileContent => r !== null);
}
