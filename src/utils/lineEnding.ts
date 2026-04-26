import { platform as osPlatform } from "@tauri-apps/plugin-os";
import type { FileTraits } from "@/shared/types/export";

export type DefaultLineEndingMode = "system" | FileTraits["lineEnding"];

let systemLineEndingPromise: Promise<FileTraits["lineEnding"]> | null = null;

function getNavigatorLineEnding(): FileTraits["lineEnding"] {
  if (typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent)) {
    return "crlf";
  }
  return "lf";
}

export async function getSystemLineEnding(): Promise<FileTraits["lineEnding"]> {
  if (!systemLineEndingPromise) {
    systemLineEndingPromise = Promise.resolve(osPlatform())
      .then((platform) => (platform === "windows" ? "crlf" : "lf"))
      .catch(() => getNavigatorLineEnding());
  }

  return systemLineEndingPromise;
}

export async function resolveDefaultLineEnding(
  mode: DefaultLineEndingMode | undefined
): Promise<FileTraits["lineEnding"]> {
  if (!mode || mode === "system") {
    return getSystemLineEnding();
  }

  return mode;
}

export function formatLineEnding(lineEnding: FileTraits["lineEnding"]): string {
  return lineEnding === "crlf" ? "Windows (CRLF)" : "Unix (LF)";
}
