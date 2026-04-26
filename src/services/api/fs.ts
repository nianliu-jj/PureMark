import type { FileTraits, ReadFileResult, SaveFileResult } from "@/shared/types/export";
import { invoke } from "@/composables/useTauri";

export async function readFileByPath(filePath: string): Promise<ReadFileResult | null> {
  return invoke<ReadFileResult | null>("read_file_by_path", { filePath });
}

export async function isReadOnly(filePath: string): Promise<boolean> {
  return invoke<boolean>("is_read_only", { filePath });
}

export interface SaveFileArgs {
  filePath: string;
  content: string;
  fileTraits?: FileTraits;
  defaultLineEnding?: FileTraits["lineEnding"];
  imageLocalPath?: string;
}

export async function saveFile(args: SaveFileArgs): Promise<SaveFileResult> {
  return invoke<SaveFileResult>("save_file", { args });
}

export async function moveFileToDirectory(filePath: string, targetDir: string): Promise<string> {
  return invoke<string>("move_file_to_directory", { filePath, targetDir });
}

export interface WriteTempImageArgs {
  file: Uint8Array;
  targetPath: string;
  currentFilePath?: string | null;
  fileName?: string;
  mimeType?: string;
}

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

export async function cleanupLocalImages(content: string): Promise<void> {
  await invoke<void>("cleanup_local_images", { content });
}
