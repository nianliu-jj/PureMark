/**
 * useWorkSpace — 工作区（文件夹浏览）的模块级共享状态与业务逻辑。
 *
 * 负责工作区目录的加载、监听与文件操作：
 *  - 加载：依据当前 Tab 的真实文件路径自动推断并加载所在目录（getWorkSpace），或用户手动选择目录
 *    （setWorkSpace / openWorkSpaceByPath）；对 WSL/远程路径跳过自动加载并提示。
 *  - 监听：通过 watchDirectory/onDirectoryChanged 监听目录变化并刷新；切换工作区时同步会话快照与最近打开。
 *  - 展示：processedWorkSpace 在原始列表上叠加自然排序（目录优先、name/mtime 两种方式）、搜索过滤与
 *    后代计数（applyDescendantCounts）。
 *  - 文件操作：新建文件/文件夹（自动避免重名并进入重命名编辑态）、删除、重命名（同步更新已打开 Tab）。
 *  - HMR：热更新时取消订阅并停止监听，避免重复监听。
 */
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

/** 切换排序方式（name ↔ mtime）并写回配置。 */
function toggleSort() {
  const next = sortBy.value === "name" ? "mtime" : "name";
  setConf("workspace", {
    ...config.value.workspace,
    sortBy: next,
  });
}

// 自然排序辅助：按「小写字母→大写字母→数字→其他→空」给首字符分配优先级
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

/** 排序节点：目录在前、文件在后，按 name 或 mtime 排序并递归排序子节点。 */
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

/** 搜索过滤：目录始终保留，文件按名称包含查询词过滤。 */
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

// 处理后的节点（排序 + 搜索 + 后代计数）——供 UI 渲染的派生列表
const processedWorkSpace = computed(() => {
  if (!workSpace.value) return null;
  let result = sortNodes([...workSpace.value]);
  result = filterNodes(result, searchQuery.value);
  return applyDescendantCounts(result);
});

/**
 * 自动加载工作区目录：基于第一个有真实路径的 Tab 推断目录（或继承自 tear-off 的工作区路径），
 * 对 WSL/远程路径跳过并提示。加载成功后开始监听目录。幂等（已加载或加载中直接返回）。
 */
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

/** 按指定路径打开工作区：重置状态、读取目录、开始监听。 */
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

/** 弹出系统选择文件夹对话框并打开所选工作区。 */
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

/** 开始监听目录：先停掉旧监听，再监听新目录并记录工作区路径、最近打开与会话快照。 */
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

/** 停止监听当前工作区目录并清空相关状态、更新会话快照。 */
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

/** 刷新文件列表（静默，不清空，用于目录变化事件回调）。 */
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

/** 手动硬刷新：先清空列表再重新加载，让用户感知到刷新动作。 */
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

// 副作用：监听目录变化事件（Rust emit workspace:directory-changed）静默刷新列表
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

/**
 * 在目标目录下新建文件：自动生成不重名的 Untitled.md，创建后刷新列表并进入重命名编辑态。
 * @returns 新文件路径，失败返回 null
 */
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

/**
 * 在目标目录下新建文件夹：自动生成不重名的「新建文件夹」，创建后刷新列表并进入重命名编辑态。
 * @returns 新文件夹路径，失败返回 null
 */
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

/** 删除文件/文件夹，成功后刷新列表。 */
async function deleteFile(filePath: string): Promise<boolean> {
  const result = await apiDeleteFile(filePath);
  if (result) {
    await refreshWorkSpace();
  }
  return result;
}

/**
 * 重命名文件/文件夹：成功后同步更新已打开的同路径 Tab 的 filePath 与名称，并刷新列表。
 * @returns 新路径，失败返回 null
 */
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

// 副作用：监听 tabs 变化，仅在「从无真实文件到有」时触发自动加载工作区
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

/**
 * 工作区 hook 主入口。
 * @returns 处理后的列表 workSpace / 原始列表、搜索与排序状态、编辑态、文件增删改与刷新方法、监听路径等。
 */
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
