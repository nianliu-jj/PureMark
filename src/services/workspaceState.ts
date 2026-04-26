import { getCurrentWindow } from "@tauri-apps/api/window";

const WINDOW_WORKSPACE_PATHS_KEY = "puremark-window-workspace-paths";

let pendingInheritedWorkspacePath: string | null = null;

function readWorkspacePathMap(): Record<string, string> {
  if (typeof window === "undefined") return {};

  try {
    const raw = localStorage.getItem(WINDOW_WORKSPACE_PATHS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeWorkspacePathMap(next: Record<string, string>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(WINDOW_WORKSPACE_PATHS_KEY, JSON.stringify(next));
}

function getCurrentWindowLabelSafe(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
}

export function getWorkspacePathForWindow(label?: string | null): string | null {
  if (!label) return null;
  return readWorkspacePathMap()[label] ?? null;
}

export function setWorkspacePathForWindow(label: string, path: string | null) {
  const next = readWorkspacePathMap();
  if (path) {
    next[label] = path;
  } else {
    delete next[label];
  }
  writeWorkspacePathMap(next);
}

export function setWorkspacePathForCurrentWindow(path: string | null) {
  setWorkspacePathForWindow(getCurrentWindowLabelSafe(), path);
}

export function setPendingInheritedWorkspacePath(path: string | null) {
  pendingInheritedWorkspacePath = path;
}

export function consumePendingInheritedWorkspacePath(): string | null {
  const path = pendingInheritedWorkspacePath;
  pendingInheritedWorkspacePath = null;
  return path;
}
