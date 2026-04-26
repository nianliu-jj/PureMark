import { invoke } from "@/composables/useTauri";

export interface OpenLinkArgs {
  href: string;
  currentFilePath?: string | null;
}

export type OpenLinkResult =
  | { kind: "external"; url: string }
  | { kind: "markdownOpened"; filePath: string }
  | { kind: "crossWindowFocused"; filePath: string; windowLabel: string }
  | { kind: "localOther"; path: string }
  | { kind: "noop" };

export async function openLink(args: OpenLinkArgs): Promise<OpenLinkResult> {
  return invoke<OpenLinkResult>("open_link", { args });
}

export async function openExternal(url: string): Promise<void> {
  await invoke<void>("open_external", { url });
}

export async function revealFileInFolder(filePath: string): Promise<void> {
  await invoke<void>("reveal_file_in_folder", { filePath });
}
