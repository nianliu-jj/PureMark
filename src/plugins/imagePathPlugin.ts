import { convertFileSrc } from "@tauri-apps/api/core";

const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_RE = /^\\\\[^\\]/;
const FILE_PROTOCOL_RE = /^file:\/\//i;
const WEB_PROTOCOL_RE = /^(https?:|data:|blob:|asset:|tauri:|mailto:|tel:)/i;

let currentMarkdownFilePath: string | null = null;

function getNavigatorPlatform(): string {
  if (typeof navigator === "undefined") return "";
  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  return navigatorWithUserAgentData.userAgentData?.platform || navigator.platform || "";
}

function isWindowsEnvironment(): boolean {
  return /win/i.test(getNavigatorPlatform());
}

function safeDecode(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function encodePathSegments(path: string): string {
  return path
    .split("/")
    .map((segment, index) => {
      if (segment === "") return "";
      if (index === 0 && /^[a-zA-Z]:$/.test(segment)) {
        return segment;
      }
      return encodeURIComponent(segment);
    })
    .join("/");
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, "/");
}

function isAbsoluteLocalPath(path: string): boolean {
  if (!path) return false;

  if (isWindowsEnvironment()) {
    return WINDOWS_DRIVE_RE.test(path) || WINDOWS_UNC_RE.test(path);
  }

  return path.startsWith("/");
}

function pathToFileUrl(path: string): string {
  const decoded = safeDecode(path.trim());
  const normalized = normalizeSlashes(decoded);

  if (WINDOWS_UNC_RE.test(decoded)) {
    const withoutLeading = normalized.replace(/^\/+/, "");
    const [host, ...rest] = withoutLeading.split("/");
    const pathname = rest.length > 0 ? `/${encodePathSegments(rest.join("/"))}` : "";
    return `file://${host}${pathname}`;
  }

  if (WINDOWS_DRIVE_RE.test(decoded)) {
    return `file:${"/".repeat(3)}${encodePathSegments(normalized)}`;
  }

  return `file://${encodePathSegments(normalized)}`;
}

function fileUrlToPath(fileUrl: string): string | null {
  try {
    const url = new URL(fileUrl);
    if (url.protocol !== "file:") return null;

    const pathname = safeDecode(url.pathname);
    if (url.hostname) {
      if (isWindowsEnvironment()) {
        return `\\\\${url.hostname}${pathname.replace(/\//g, "\\")}`;
      }
      return `//${url.hostname}${pathname}`;
    }

    if (isWindowsEnvironment() && /^\/[a-zA-Z]:/.test(pathname)) {
      return pathname.slice(1).replace(/\//g, "\\");
    }

    return pathname;
  } catch {
    return null;
  }
}

function resolveAbsoluteFilePath(src: string, markdownFilePath?: string | null): string | null {
  const normalizedSrc = safeDecode(src.trim());
  if (!normalizedSrc) return null;

  if (FILE_PROTOCOL_RE.test(normalizedSrc)) {
    return fileUrlToPath(normalizedSrc);
  }

  if (isAbsoluteLocalPath(normalizedSrc)) {
    return normalizedSrc;
  }

  if (!markdownFilePath) {
    return null;
  }

  try {
    const relativeCandidate =
      isWindowsEnvironment() && !WINDOWS_UNC_RE.test(normalizedSrc)
        ? normalizedSrc.replace(/^\/+/, "")
        : normalizedSrc;
    const resolved = new URL(relativeCandidate, pathToFileUrl(markdownFilePath));
    return fileUrlToPath(resolved.toString());
  } catch {
    return null;
  }
}

function fallbackFileUrl(path: string): string {
  return pathToFileUrl(path);
}

export function getCurrentMarkdownFilePath(): string | null {
  return currentMarkdownFilePath;
}

// 设置当前 Markdown 文件路径（保留接口兼容性）
export function setCurrentMarkdownFilePath(filePath: string | null) {
  currentMarkdownFilePath = filePath;
}

export function resolveImageSrcForDisplay(
  src: string,
  markdownFilePath = currentMarkdownFilePath
): string {
  if (!src) return src;

  const normalizedSrc = src.trim();
  if (!normalizedSrc || WEB_PROTOCOL_RE.test(normalizedSrc)) {
    return normalizedSrc;
  }

  const absolutePath = resolveAbsoluteFilePath(normalizedSrc, markdownFilePath);
  if (!absolutePath) {
    return normalizedSrc;
  }

  try {
    return convertFileSrc(absolutePath);
  } catch {
    return fallbackFileUrl(absolutePath);
  }
}
