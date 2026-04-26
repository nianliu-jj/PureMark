import type { FileTraits, ReadFileResult, SaveFileResult } from "@/shared/types/export";
import { invoke } from "@/composables/useTauri";

export async function openFile(): Promise<ReadFileResult | null> {
  return invoke<ReadFileResult | null>("open_file");
}

export interface SaveFileAsArgs {
  content: string;
  fileTraits?: FileTraits;
  defaultLineEnding?: FileTraits["lineEnding"];
  imageLocalPath?: string;
  defaultPath?: string;
  fileName?: string;
}

export async function saveFileAs(args: SaveFileAsArgs): Promise<SaveFileResult | null> {
  return invoke<SaveFileResult | null>("save_file_as", { args });
}

export type OverwriteChoice = 0 | 1 | 2; // 0=取消 1=覆盖 2=保存
export async function showOverwriteConfirm(fileName: string): Promise<OverwriteChoice> {
  return invoke<OverwriteChoice>("show_overwrite_confirm", { fileName });
}

export type CloseChoice = 0 | 1 | 2; // 0=取消 1=不保存 2=保存
export async function showCloseConfirm(fileName: string): Promise<CloseChoice> {
  return invoke<CloseChoice>("show_close_confirm", { fileName });
}

export interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  directory?: boolean;
  multiple?: boolean;
}

export interface OpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

export async function showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogResult> {
  return invoke<OpenDialogResult>("show_open_dialog", { options });
}
