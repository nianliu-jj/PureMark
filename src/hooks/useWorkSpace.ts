import toast from "autotoast.js";
import { computed, ref, watch } from "vue";
import {
  currentWindowLabel,
  createFile as apiCreateFile,
  createFolder as apiCreateFolder,
  deleteFile as apiDeleteFile,
  getDirectoryFiles,
  onDirectoryChanged,
  renameFile as apiRenameFile,
  showOpenDialog,
  unwatchDirectory,
  watchDirectory,
} from "@/services/api";
import {
  consumePendingInheritedWorkspacePath,
  setWorkspacePathForCurrentWindow,
} from "@/services/workspaceState";
import { pushRecentOpenItem, saveLastSessionSnapshot } from "@/services/launchState";
import { shouldAutoLoadWorkspace } from "@/utils/workspacePath";
import { useConfig } from "./useConfig";
import useTab from "./useTab";

const { tabs, currentTab } = useTab();
const { config, setConf } = useConfig();

function getValidTabs() {
  return tabs.value.filter((tab) => Boolean(tab));
}

let isLoadWorkSpace = false; // 是否已经加载文件目录 标识
const isLoading = ref(false); // 文件目录加载中

interface WorkSpace {
  name: string;
  path: string;
  isDirectory: boolean;
  mtime?: number;
  descendantCount?: number;
  children?: WorkSpace[];
}

const workSpace = ref<WorkSpace[] | null>(null);
const watchedDirPath = ref<string | null>(null);
let hasShownRemoteWorkspaceSkipToast = false;

// 搜索
const searchQuery = ref("");

// 编辑状态
const editingNode = ref<{ path: string; isNew: boolean } | null>(null);

// 排序方式
const sortBy = computed(() => config.value.workspace?.sortBy ?? "name");

function toggleSort() {
  const next = sortBy.value === "name" ? "mtime" : "name";
  setConf("workspace", {
    ...config.value.workspace,
    sortBy: next,
  });
}

function getCharPriority(char: string | undefined): number {
  if (!char) return 4;
  if (/[a-z]/.test(char)) return 0;
  if (/[A-Z]/.test(char)) return 1;
  if (/[0-9]/.test(char)) return 2;
  return 3;
}

function splitNaturalTokens(name: string): string[] {
  return name.match(/\d+|\D+/g) ?? [name];
}

function compareTextToken(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const aChar = a[i];
    const bChar = b[i];
    const priorityDiff = getCharPriority(aChar) - getCharPriority(bChar);
    if (priorityDiff !== 0) return priorityDiff;

    const lowerDiff = aChar.toLowerCase().localeCompare(bChar.toLowerCase());
    if (lowerDiff !== 0) return lowerDiff;

    const rawDiff = aChar.localeCompare(bChar);
    if (rawDiff !== 0) return rawDiff;
  }

  return a.length - b.length;
}

function compareNaturalName(aName: string, bName: string): number {
  const leadingPriorityDiff = getCharPriority(aName[0]) - getCharPriority(bName[0]);
  if (leadingPriorityDiff !== 0) return leadingPriorityDiff;

  const aTokens = splitNaturalTokens(aName);
  const bTokens = splitNaturalTokens(bName);
  const length = Math.min(aTokens.length, bTokens.length);

  for (let i = 0; i < length; i++) {
    const aToken = aTokens[i];
    const bToken = bTokens[i];
    const aIsNumber = /^\d+$/.test(aToken);
    const bIsNumber = /^\d+$/.test(bToken);

    if (aIsNumber && bIsNumber) {
      const numericDiff = Number(aToken) - Number(bToken);
      if (numericDiff !== 0) return numericDiff;

      const lengthDiff = aToken.length - bToken.length;
      if (lengthDiff !== 0) return lengthDiff;
      continue;
    }

    const tokenDiff = compareTextToken(aToken, bToken);
    if (tokenDiff !== 0) return tokenDiff;
  }

  return aTokens.length - bTokens.length;
}

function compareWorkspaceName(a: WorkSpace, b: WorkSpace): number {
  return compareNaturalName(a.name, b.name);
}

// 排序函数
function sortNodes(nodes: WorkSpace[]): WorkSpace[] {
  const dirs = nodes.filter((n) => n.isDirectory);
  const files = nodes.filter((n) => !n.isDirectory);

  const sorter = (a: WorkSpace, b: WorkSpace) => {
    if (sortBy.value === "mtime") {
      return (b.mtime ?? 0) - (a.mtime ?? 0) || compareWorkspaceName(a, b); // 最新在前
    }
    return compareWorkspaceName(a, b);
  };

  dirs.sort(sorter);
  files.sort(sorter);

  // 递归排序子节点
  for (const dir of dirs) {
    if (dir.children) {
      dir.children = sortNodes(dir.children);
    }
  }

  return [...dirs, ...files];
}

// 搜索过滤函数
function filterNodes(nodes: WorkSpace[], query: string): WorkSpace[] {
  if (!query) return nodes;
  const lower = query.toLowerCase();
  return nodes.filter((node) => {
    if (node.isDirectory) return true; // 目录始终显示
    return node.name.toLowerCase().includes(lower);
  });
}

function applyDescendantCounts(nodes: WorkSpace[]): WorkSpace[] {
  for (const node of nodes) {
    node.descendantCount = countDescendants(node);
    if (node.children) {
      applyDescendantCounts(node.children);
    }
  }
  return nodes;
}

function countDescendants(node: WorkSpace): number {
  if (!node.children?.length) return 0;
  return node.children.reduce((total, child) => total + 1 + countDescendants(child), 0);
}

// 处理后的节点（排序 + 搜索）
const processedWorkSpace = computed(() => {
  if (!workSpace.value) return null;
  let result = sortNodes([...workSpace.value]);
  result = filterNodes(result, searchQuery.value);
  return applyDescendantCounts(result);
});

// 获取文件夹
async function getWorkSpace() {
  if (isLoadWorkSpace) return;
  if (isLoading.value) return;

  // 是否有真实path得文件
  const realFile = getValidTabs().find((tab) => tab.filePath);

  if (!realFile || !realFile.filePath) return;

  const inheritedWorkspacePath = consumePendingInheritedWorkspacePath();
  const directoryPath = inheritedWorkspacePath || realFile.filePath.replace(/[^/\\]+$/, "");

  if (!inheritedWorkspacePath && !shouldAutoLoadWorkspace(directoryPath)) {
    if (!hasShownRemoteWorkspaceSkipToast) {
      hasShownRemoteWorkspaceSkipToast = true;
      toast.show("检测到 WSL / 远程路径，已跳过自动加载工作区，可手动打开文件夹", "info");
    }
    return;
  }

  try {
    isLoading.value = true;

    const result = await getDirectoryFiles(directoryPath);

    if (!result) return;
    if (!result.length) return;

    // 已加载
    isLoadWorkSpace = true;
    // 更新文件夹信息
    workSpace.value = result;
    // 开始监听目录
    await startWatching(directoryPath);
  } catch {
    toast.show("获取目录文件失败:", "error");
  } finally {
    isLoading.value = false;
  }
}

// 打开选择文件夹对话框
async function openWorkSpaceByPath(selectedPath: string) {
  try {
    if (!selectedPath) return false;

    isLoadWorkSpace = false;
    workSpace.value = null;

    const directoryFiles = await getDirectoryFiles(selectedPath);

    if (!directoryFiles) return false;

    workSpace.value = directoryFiles;
    isLoadWorkSpace = true;
    await startWatching(selectedPath);
    return true;
  } catch {
    return false;
  }
}

async function setWorkSpace() {
  try {
    const result = await showOpenDialog({
      directory: true,
      title: "选择文件夹",
    });

    if (result && !result.canceled && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0];
      await openWorkSpaceByPath(selectedPath);
    }
  } catch {
    toast.show("获取目录文件失败:", "error");
  }
}

// 开始监听目录
async function startWatching(dirPath: string) {
  if (watchedDirPath.value) {
    await unwatchDirectory();
  }
  watchedDirPath.value = dirPath;
  await watchDirectory(dirPath);
  setWorkspacePathForCurrentWindow(dirPath);
  pushRecentOpenItem(dirPath, "directory");
  saveLastSessionSnapshot({
    windowLabel: currentWindowLabel(),
    workspacePath: dirPath,
    openFilePaths: getValidTabs()
      .filter((tab) => typeof tab.filePath === "string" && tab.filePath)
      .map((tab) => tab.filePath as string),
    activeFilePath: currentTab.value?.filePath ?? null,
  });
}

// 停止监听
async function stopWatching() {
  if (watchedDirPath.value) {
    await unwatchDirectory();
    watchedDirPath.value = null;
    setWorkspacePathForCurrentWindow(null);
    saveLastSessionSnapshot({
      windowLabel: currentWindowLabel(),
      workspacePath: null,
      openFilePaths: getValidTabs()
        .filter((tab) => typeof tab.filePath === "string" && tab.filePath)
        .map((tab) => tab.filePath as string),
      activeFilePath: currentTab.value?.filePath ?? null,
    });
  }
}

// 刷新文件列表
async function refreshWorkSpace() {
  if (!watchedDirPath.value) return;
  try {
    const result = await getDirectoryFiles(watchedDirPath.value);
    if (result) {
      workSpace.value = result;
    }
  } catch {
    // 静默失败
  }
}

// 手动刷新：先清空列表再重新加载，让用户感知到刷新
async function hardRefreshWorkSpace() {
  if (!watchedDirPath.value) return;
  workSpace.value = null;
  try {
    const result = await getDirectoryFiles(watchedDirPath.value);
    if (result) {
      workSpace.value = result;
    }
  } catch {
    // 静默失败
  }
}

// 监听目录变化（Rust emit workspace:directory-changed）
let unsubscribeDirChanged: (() => void) | null = null;
onDirectoryChanged(() => refreshWorkSpace())
  .then((fn) => {
    unsubscribeDirChanged = fn;
  })
  .catch((e) => console.error("[workspace] subscribe dir changed failed:", e));

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (unsubscribeDirChanged) {
      unsubscribeDirChanged();
      unsubscribeDirChanged = null;
    }
    void stopWatching();
  });
}

// 文件操作
async function createFile(targetDirPath: string): Promise<string | null> {
  // 生成不冲突的文件名
  let fileName = "Untitled.md";
  let counter = 1;
  const existingNames = new Set<string>();

  // 收集目标目录下的文件名
  function collectNames(nodes: WorkSpace[], dirPath: string) {
    for (const node of nodes) {
      const nodeDir = node.path.replace(/[^/\\]+$/, "").replace(/[/\\]$/, "");
      const targetDir = dirPath.replace(/[/\\]$/, "");
      if (nodeDir === targetDir) {
        existingNames.add(node.name);
      }
      if (node.children) {
        collectNames(node.children, dirPath);
      }
    }
  }
  if (workSpace.value) {
    collectNames(workSpace.value, targetDirPath);
  }

  while (existingNames.has(fileName)) {
    fileName = `Untitled ${counter}.md`;
    counter++;
  }

  const filePath = await apiCreateFile(targetDirPath, fileName);
  if (filePath) {
    // 等待目录监听刷新
    await refreshWorkSpace();
    // 进入编辑状态
    editingNode.value = { path: filePath, isNew: true };
  }
  return filePath;
}

async function createFolder(targetDirPath: string): Promise<string | null> {
  // 生成不冲突的文件夹名
  let folderName = "新建文件夹";
  let counter = 1;
  const existingNames = new Set<string>();

  // 收集目标目录下的名称
  function collectNames(nodes: WorkSpace[], dirPath: string) {
    for (const node of nodes) {
      const nodeDir = node.path.replace(/[^/\\]+$/, "").replace(/[/\\]$/, "");
      const targetDir = dirPath.replace(/[/\\]$/, "");
      if (nodeDir === targetDir) {
        existingNames.add(node.name);
      }
      if (node.children) {
        collectNames(node.children, dirPath);
      }
    }
  }
  if (workSpace.value) {
    collectNames(workSpace.value, targetDirPath);
  }

  while (existingNames.has(folderName)) {
    folderName = `新建文件夹 ${counter}`;
    counter++;
  }

  const folderPath = await apiCreateFolder(targetDirPath, folderName);
  if (folderPath) {
    await refreshWorkSpace();
    // 进入编辑状态（重命名）
    editingNode.value = { path: folderPath, isNew: true };
  }
  return folderPath;
}

async function deleteFile(filePath: string): Promise<boolean> {
  const result = await apiDeleteFile(filePath);
  if (result) {
    await refreshWorkSpace();
  }
  return result;
}

async function renameFile(oldPath: string, newName: string): Promise<string | null> {
  const newPath = await apiRenameFile(oldPath, newName);
  if (newPath) {
    // 更新打开的 tab
    const { tabs: allTabs } = useTab();
    for (const tab of allTabs.value.filter((item) => Boolean(item))) {
      if (tab.filePath === oldPath) {
        tab.filePath = newPath;
        tab.name = newName;
        break;
      }
    }
    await refreshWorkSpace();
  }
  return newPath;
}

// 监听tabs
watch(
  () => tabs.value,
  (newTabs) => {
    // 只有在从无到有时才重新加载文件夹
    const hasRealFile = newTabs.filter((tab) => Boolean(tab)).some((tab) => tab.filePath);
    if (hasRealFile && !isLoadWorkSpace) {
      getWorkSpace();
    }
  },
  {
    deep: true,
  }
);

// 监听当前选中得tab
watch(
  () => currentTab.value,
  () => {}
);

function useWorkSpace() {
  return {
    workSpace: processedWorkSpace,
    rawWorkSpace: workSpace,
    setWorkSpace,
    searchQuery,
    sortBy,
    toggleSort,
    editingNode,
    createFile,
    createFolder,
    deleteFile,
    renameFile,
    refreshWorkSpace,
    hardRefreshWorkSpace,
    openWorkSpaceByPath,
    watchedDirPath,
  };
}

export default useWorkSpace;
