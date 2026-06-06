/**
 * PDF 导出选项。由前端 services/exports/pdf.ts 使用。
 */
export interface ExportPDFOptions {
  pageSize?: "A4" | "Letter" | { width: number; height: number };
  scale?: number;
}

/**
 * Word 导出的抽象块类型。由编辑器序列化产出，services/exports/docx.ts 消费。
 */
export type DocxBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[]; ordered: boolean }
  | { type: "code"; lines: string[] };

/**
 * 文件格式特征：用于保存时还原原始文件的 BOM / 换行符 / 末尾换行。
 * 字段与 Rust `FileTraits` 结构（serde camelCase）保持一致。
 */
export interface FileTraits {
  hasBOM: boolean;
  lineEnding: "crlf" | "lf";
  hasTrailingNewline: boolean;
}

/**
 * Rust read_file_by_path 的返回体，与 `ReadFileResult` 结构对齐。
 */
export interface ReadFileResult {
  filePath: string;
  content: string;
  fileTraits: FileTraits;
}

/**
 * save_file / save_file_as 的返回体。
 */
export interface SaveFileResult {
  filePath: string;
  content: string;
}

/**
 * 长图导出支持的图片格式。默认 png，可在设置页切换。
 */
export type ImageExportFormat = "png" | "jpg" | "webp";

/**
 * 图片导出选项。由前端 services/exports/image.ts 使用。
 */
export interface ExportImageOptions {
  format: ImageExportFormat;
  /** 栅格化倍率，默认 2 保证清晰度 */
  scale?: number;
}
