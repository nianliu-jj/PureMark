import { invoke } from "@/composables/useTauri";

export interface WorkspaceNode {
  name: string;
  path: string;
  isDirectory: boolean;
  mtime: number;
  children?: WorkspaceNode[];
}

export async function getDirectoryFiles(dirPath: string): Promise<WorkspaceNode[]> {
  return invoke<WorkspaceNode[]>("get_directory_files", { dirPath });
}

export async function workspaceExists(dirPath: string): Promise<boolean> {
  return invoke<boolean>("workspace_exists", { dirPath });
}

export async function createFile(dirPath: string, fileName: string): Promise<string | null> {
  return invoke<string | null>("create_file", { args: { dirPath, fileName } });
}

export async function createFolder(dirPath: string, folderName: string): Promise<string | null> {
  return invoke<string | null>("create_folder", { args: { dirPath, folderName } });
}

export async function deleteFile(filePath: string): Promise<boolean> {
  return invoke<boolean>("delete_file", { filePath });
}

export async function renameFile(oldPath: string, newName: string): Promise<string | null> {
  return invoke<string | null>("rename_file", { args: { oldPath, newName } });
}

export async function watchDirectory(dirPath: string): Promise<void> {
  await invoke<void>("watch_directory", { dirPath });
}

export async function unwatchDirectory(): Promise<void> {
  await invoke<void>("unwatch_directory");
}
