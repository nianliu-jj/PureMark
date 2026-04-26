export type StartupMode = "new-file" | "last-workspace" | "last-session" | "custom-workspace";

export type RecentOpenItemType = "file" | "directory";

export interface RecentOpenItem {
  path: string;
  type: RecentOpenItemType;
  name: string;
  parentPath: string | null;
  timestamp: number;
}

export interface SessionSnapshot {
  windowLabel: string;
  workspacePath: string | null;
  openFilePaths: string[];
  activeFilePath: string | null;
  updatedAt: number;
}

const RECENT_OPEN_ITEMS_KEY = "puremark-recent-open-items";
const LAST_SESSION_KEY = "puremark-last-session";
const RECENT_OPEN_ITEMS_LIMIT = 20;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readJson<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;

  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  if (!canUseStorage()) return;
  localStorage.setItem(key, JSON.stringify(value));
}

function emitStorageChangeEvent(key: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("puremark:storage-changed", { detail: { key } }));
}

function getPathName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
}

function getParentPath(path: string): string | null {
  const normalized = path.replace(/[/\\]+$/, "");
  const matched = normalized.match(/^(.*)[/\\][^/\\]+$/);
  return matched?.[1] ?? null;
}

function isRecentOpenItemType(value: unknown): value is RecentOpenItemType {
  return value === "file" || value === "directory";
}

function isWindowsLikePath(path: string): boolean {
  return /^[a-zA-Z]:[/\\]/.test(path) || path.startsWith("\\\\");
}

function normalizeRecentPath(path: string): string {
  const trimmed = path.trim().replace(/[/\\]+$/, "");
  const normalized = trimmed.replace(/\\/g, "/");
  return isWindowsLikePath(trimmed) ? normalized.toLowerCase() : normalized;
}

function getRecentOpenItemKey(path: string, type: RecentOpenItemType): string {
  return `${type}:${normalizeRecentPath(path)}`;
}

function sanitizeRecentOpenItems(items: unknown): RecentOpenItem[] {
  if (!Array.isArray(items)) return [];

  const deduped = new Map<string, RecentOpenItem>();

  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;

    const path = typeof entry.path === "string" ? entry.path.trim() : "";
    const type = entry.type;
    if (!path || !isRecentOpenItemType(type)) continue;

    const timestamp =
      typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp) ? entry.timestamp : 0;
    const item: RecentOpenItem = {
      path,
      type,
      name:
        typeof entry.name === "string" && entry.name.trim().length > 0
          ? entry.name.trim()
          : getPathName(path),
      parentPath: getParentPath(path),
      timestamp,
    };

    const key = getRecentOpenItemKey(item.path, item.type);
    const previous = deduped.get(key);
    if (!previous || item.timestamp >= previous.timestamp) {
      deduped.set(key, item);
    }
  }

  return [...deduped.values()]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, RECENT_OPEN_ITEMS_LIMIT);
}

function writeRecentOpenItems(items: RecentOpenItem[]) {
  writeJson(RECENT_OPEN_ITEMS_KEY, items);
  emitStorageChangeEvent(RECENT_OPEN_ITEMS_KEY);
}

export function getRecentOpenItems(): RecentOpenItem[] {
  const rawItems = readJson<unknown>(RECENT_OPEN_ITEMS_KEY, []);
  const items = sanitizeRecentOpenItems(rawItems);

  if (canUseStorage() && JSON.stringify(rawItems) !== JSON.stringify(items)) {
    writeJson(RECENT_OPEN_ITEMS_KEY, items);
  }

  return items;
}

export function pushRecentOpenItem(path: string, type: RecentOpenItemType) {
  if (!path) return;

  const item: RecentOpenItem = {
    path,
    type,
    name: getPathName(path),
    parentPath: getParentPath(path),
    timestamp: Date.now(),
  };

  const next = [
    item,
    ...getRecentOpenItems().filter((entry) => {
      return (
        getRecentOpenItemKey(entry.path, entry.type) !== getRecentOpenItemKey(item.path, item.type)
      );
    }),
  ];

  writeRecentOpenItems(sanitizeRecentOpenItems(next));
}

export function removeRecentOpenItem(path: string, type?: RecentOpenItemType) {
  const targetPath = normalizeRecentPath(path);
  const next = getRecentOpenItems().filter((item) => {
    if (type) {
      return !(normalizeRecentPath(item.path) === targetPath && item.type === type);
    }
    return normalizeRecentPath(item.path) !== targetPath;
  });

  writeRecentOpenItems(next);
}

export function clearRecentOpenItems() {
  writeRecentOpenItems([]);
}

export function getLastSessionSnapshot(): SessionSnapshot | null {
  const snapshot = readJson<SessionSnapshot | null>(LAST_SESSION_KEY, null);
  if (!snapshot) return null;
  if (!Array.isArray(snapshot.openFilePaths)) {
    return null;
  }
  return snapshot;
}

export function saveLastSessionSnapshot(snapshot: Omit<SessionSnapshot, "updatedAt">) {
  writeJson<SessionSnapshot>(LAST_SESSION_KEY, {
    ...snapshot,
    updatedAt: Date.now(),
  });
  emitStorageChangeEvent(LAST_SESSION_KEY);
}

export function onLaunchStateChange(handler: (key: string) => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ key?: string }>).detail;
    if (!detail?.key) return;
    handler(detail.key);
  };

  window.addEventListener("puremark:storage-changed", listener);
  return () => window.removeEventListener("puremark:storage-changed", listener);
}
