/**
 * useTab — 多标签页（Tab）的核心模块级共享状态与业务逻辑。
 *
 * 这是编辑器多文档体系的中枢，维护 tabs 列表与 activeTabId，并承担大量职责：
 *  - 生命周期：新建 / 打开 / 关闭 / 切换 Tab，复用空白 Untitled，从文件创建 Tab。
 *  - 脏检查与保存：基于归一化内容判定 isModified，提供手动保存 saveTab/saveCurrentTab，
 *    以及防抖自动保存（scheduleAutoSave/autoSaveTab），保存后回读磁盘同步 fileTraits/readOnly。
 *  - 多窗口协同：Tab 拖拽分离到新窗口（tearOff）、合并接收与悬停合并预览（mergePreview）、
 *    单 Tab 整窗拖拽（windowDrag），并将打开文件列表 / 会话快照同步给 Rust 宿主。
 *  - 磁盘变更响应：监听 Rust 的 file:changed，未修改则静默重载，已修改则弹确认覆盖。
 *  - UI 辅助：TabBar 滚动可见性、惯性滚动、排序、显示名格式化等。
 *
 * 模块加载时会同步创建一个默认空白 Tab 保证 UI 立即可用，并异步尝试用 tear-off 数据替换它。
 * 多处 watch / api 订阅在模块级注册一次，是跨窗口状态同步的关键副作用。
 */
import type { Ref } from "vue";
import type { InertiaScroll } from "@/utils/inertiaScroll";
import type { FileTraitsDTO, TearOffTabData } from "@/shared/types/tearoff";
import type { Tab } from "@/types/tab";
import autotoast from "autotoast.js";
import { computed, nextTick, ref, toRaw, watch } from "vue";
import { setCurrentMarkdownFilePath } from "@/plugins/imagePathPlugin";
import emitter from "@/events";
import {
  cleanupLocalImages as apiCleanupLocalImages,
  closeDiscard as apiCloseDiscard,
  currentWindowLabel,
  dropMerge as apiDropMerge,
  getInitialTabData as apiGetInitialTabData,
  isReadOnly as apiIsReadOnly,
  onActivateFile as apiOnActivateFile,
  onFileChanged,
  onOpenFileAtLaunch as apiOnOpenFileAtLaunch,
  onTabMergeIn as apiOnTabMergeIn,
  onTabMergePreview as apiOnTabMergePreview,
  onTabMergePreviewCancel as apiOnTabMergePreviewCancel,
  onTabMergePreviewFinalize as apiOnTabMergePreviewFinalize,
  onTabMergePreviewUpdate as apiOnTabMergePreviewUpdate,
  saveFile as apiSaveFile,
  startWindowDrag as apiStartWindowDrag,
  stopWindowDrag as apiStopWindowDrag,
  tearOffTabCancel as apiTearOffTabCancel,
  tearOffTabEnd as apiTearOffTabEnd,
  tearOffTabStart as apiTearOffTabStart,
  updateWindowOpenFiles as apiUpdateWindowOpenFiles,
  watchFiles as apiWatchFiles,
} from "@/services/api";
import { createTabDataFromFile, readAndProcessFile } from "@/services/fileService";
import { pushRecentOpenItem, saveLastSessionSnapshot } from "@/services/launchState";
import { getSidebarWidth } from "@/services/sidebarWidth";
import {
  getWorkspacePathForWindow,
  setPendingInheritedWorkspacePath,
} from "@/services/workspaceState";
import { createInertiaScroll } from "@/utils/inertiaScroll";
import { normalizeMarkdownForDirtyCheck } from "@/utils/markdown";
import { randomUUID } from "@/utils/tool";
import { resolveDefaultLineEnding } from "@/utils/lineEnding";
import { isFileSidebarVisible } from "./useOutline";
import { useConfig } from "./useConfig";

const tabs = ref<Tab[]>([]);
const activeTabId = ref<string | null>(null);

/** 类型守卫：过滤掉数组中可能存在的 null/undefined 占位。 */
function isValidTab(tab: Tab | null | undefined): tab is Tab {
  return Boolean(tab);
}

/** 获取去除空洞后的有效 Tab 列表。 */
function getValidTabs(): Tab[] {
  return (tabs.value as Array<Tab | null | undefined>).filter(isValidTab);
}

// 同步当前窗口打开的文件列表到 Rust 侧索引（供跨窗口路由/定位使用）
watch(
  () => getValidTabs().map((tab) => tab.filePath),
  (newPaths) => {
    const paths = newPaths.filter((p): p is string => typeof p === "string" && p.length > 0);
    apiUpdateWindowOpenFiles(paths).catch(() => {});
  }
);

// 防抖定时器 Map：每个 tab 独立跟踪归一化完成
const newlyLoadedTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** 启动/重置 isNewlyLoaded 清理定时器，确保归一化结束后 isNewlyLoaded 一定被消费 */
function scheduleNewlyLoadedCleanup(tabId: string) {
  const existing = newlyLoadedTimers.get(tabId);
  if (existing) clearTimeout(existing);
  newlyLoadedTimers.set(
    tabId,
    setTimeout(() => {
      const tab = getValidTabs().find((t) => t.id === tabId);
      if (tab) tab.isNewlyLoaded = false;
      newlyLoadedTimers.delete(tabId);
    }, 150)
  );
}

const defaultName = "Untitled";
const AUTO_SAVE_DELAY = 450;

const defaultTabUUid = randomUUID();

// ── 窗口初始化逻辑 ─────────────────────────────────────────
// 如果是由 Tab 拖拽分离创建的新窗口，使用传入的 Tab 数据替换默认 Tab
let _tearOffInitPromise: Promise<void> | null = null;

/**
 * 从 tear-off 数据初始化窗口：若当前窗口是由 Tab 拖拽分离创建的，则用传入数据替换默认空白 Tab。
 * 继承源窗口工作区路径；已修改的 Tab 不标记 isNewlyLoaded，以免编辑器归一化覆盖 originalContent。
 * @returns 是否成功用 tear-off 数据完成初始化
 */
async function initFromTearOff(): Promise<boolean> {
  try {
    const tabData: TearOffTabData | null = await apiGetInitialTabData();
    if (!tabData) return false;

    setPendingInheritedWorkspacePath(getWorkspacePathForWindow(tabData.sourceLabel));

    // 用分离的 Tab 数据替换默认空白 Tab
    // 已修改的 Tab 不能标记 isNewlyLoaded，否则编辑器归一化会覆盖 originalContent 并重置 isModified
    const tab: Tab = {
      id: randomUUID(), // 生成新 ID，避免与源窗口冲突
      name: tabData.name,
      filePath: tabData.filePath,
      content: tabData.content,
      originalContent: tabData.originalContent,
      isModified: tabData.isModified,
      scrollRatio: tabData.scrollRatio ?? 0,
      readOnly: tabData.readOnly,
      isNewlyLoaded: !tabData.isModified,
      fileTraits: tabData.fileTraits,
    };

    tabs.value = [tab];
    activeTabId.value = tab.id;
    if (!tabData.isModified) {
      scheduleNewlyLoadedCleanup(tab.id);
    }

    // 设置图片路径解析
    if (tab.filePath) {
      setCurrentMarkdownFilePath(tab.filePath);
    }

    return true;
  } catch (error) {
    console.error("[useTab] 初始化 tear-off 数据失败:", error);
    return false;
  }
}

// 立即发起初始化请求（不阻塞模块加载）
_tearOffInitPromise = initFromTearOff().then(() => {
  _tearOffInitPromise = null;
});

// 先同步创建默认 Tab（确保 UI 立即可用），tear-off 初始化成功后会替换它
const defaultTab: Tab = {
  id: defaultTabUUid,
  name: defaultName,
  filePath: null,
  content: "",
  originalContent: "",
  isModified: false,
  scrollRatio: 0,
  readOnly: false,
  saveStatus: "saved",
  isNewlyLoaded: true,
};
tabs.value.push(defaultTab);
activeTabId.value = defaultTab.id;
scheduleNewlyLoadedCleanup(defaultTabUUid);
apiOnOpenFileAtLaunch((_payload) => {
  const firstTab = tabs.value[0];
  if (tabs.value.length === 1 && firstTab?.id === defaultTabUUid && !firstTab.isModified) {
    tabs.value = [];
  }
}).catch(() => {});

// 从文件路径获取文件名
/** 从文件路径提取文件名作为 Tab 名，无路径返回默认 Untitled。 */
function getFileName(filePath: string | null): string {
  if (!filePath) return defaultName;
  const parts = filePath.split(/[\\/]/);
  return parts.at(-1) ?? defaultName;
}

/** 查找当前窗口中是否已打开指定文件路径的 Tab。 */
function isFileAlreadyOpen(filePath: string): Tab | null {
  return getValidTabs().find((tab) => tab.filePath === filePath) || null;
}

/** 添加 Tab：若同路径文件已打开则切换到已有 Tab，否则追加并激活。 */
function add(tab: Tab) {
  // 检查是否已存在相同文件路径的tab
  if (tab.filePath) {
    const existingTab = isFileAlreadyOpen(tab.filePath);
    if (existingTab) {
      // 如果文件已打开，直接切换到该tab
      setActive(existingTab.id);
      return existingTab;
    }
  }

  tabs.value.push(tab);
  setActive(tab.id);
  return tab;
}

// 关闭tab
/** 关闭指定 Tab：清理自动保存定时器，若关闭的是活跃 Tab 则切换到相邻 Tab。 */
function close(id: string) {
  const tabIndex = tabs.value.findIndex((tab) => tab?.id === id);
  if (tabIndex === -1) return;

  clearAutoSaveTimer(id);
  autoSavePending.delete(id);
  const isActiveTab = activeTabId.value === id;
  tabs.value.splice(tabIndex, 1);

  // 如果关闭的是当前活跃tab，需要切换到其他tab
  if (isActiveTab) {
    if (tabs.value.length > 0) {
      // 优先切换到下一个tab，如果没有则切换到上一个
      const nextIndex = tabIndex < tabs.value.length ? tabIndex : tabIndex - 1;
      const nextTab = tabs.value[nextIndex];
      if (nextTab) {
        switchToTab(nextTab.id);
      } else {
        activeTabId.value = null;
      }
    } else {
      activeTabId.value = null;
    }
  }
}

// 设置活跃tab
function setActive(id: string) {
  if (!getValidTabs().find((tab) => tab.id === id) || activeTabId.value === id) return;
  activeTabId.value = id;
}

// 获取当前tab
function getCurrentTab() {
  return getValidTabs().find((tab) => tab.id === activeTabId.value) || null;
}

// 更新当前tab的内容
/**
 * 更新当前 Tab 内容并维护脏标记与保存状态。
 * - 只读 Tab 永不脏；
 * - 显式传入 isModified 时直接采用并按需触发自动保存；
 * - isNewlyLoaded 的 Tab 吸收编辑器归一化产生的变化（不计为修改）；
 * - 否则用归一化内容与 originalContent 比对判定是否修改，并按需触发自动保存。
 * @param content 最新内容
 * @param isModified 可选，显式指定修改状态
 */
function updateCurrentTabContent(content: string, isModified?: boolean) {
  const currentTab = getCurrentTab();
  if (!currentTab) return;

  currentTab.content = content;

  if (currentTab.readOnly) {
    currentTab.isModified = false;
    currentTab.saveStatus = "saved";
    return;
  }

  if (isModified !== undefined) {
    currentTab.isModified = isModified;
    currentTab.saveStatus = isModified ? "unsaved" : "saved";
    if (isModified) {
      scheduleAutoSave(currentTab);
    }
    return;
  }

  // 刚加载的 tab，吸收编辑器归一化产生的变化
  if (currentTab.isNewlyLoaded) {
    currentTab.originalContent = content;
    currentTab.isModified = false;
    currentTab.saveStatus = "saved";
    // 归一化每步都可能触发 change，重置定时器等待全部完成
    scheduleNewlyLoadedCleanup(currentTab.id);
    return;
  }

  currentTab.isModified =
    normalizeMarkdownForDirtyCheck(content) !==
    normalizeMarkdownForDirtyCheck(currentTab.originalContent);
  currentTab.saveStatus = currentTab.isModified ? "unsaved" : "saved";
  if (currentTab.isModified) {
    scheduleAutoSave(currentTab);
  }
}

// 更新当前tab的文件信息（用于文件覆盖场景）
function updateCurrentTabFile(filePath: string, content: string, name?: string) {
  const currentTab = getCurrentTab();
  if (currentTab) {
    currentTab.filePath = filePath;
    currentTab.content = content;
    currentTab.originalContent = content;
    currentTab.isModified = false;
    currentTab.saveStatus = "saved";
    currentTab.isNewlyLoaded = true;
    scheduleNewlyLoadedCleanup(currentTab.id);
    if (name) {
      currentTab.name = name;
    } else {
      currentTab.name = getFileName(filePath);
    }
  }
}

// 更新当前tab的滚动位置
function updateCurrentTabScrollRatio(ratio: number) {
  const currentTab = getCurrentTab();
  if (currentTab) {
    currentTab.scrollRatio = ratio;
  }
}

/**
 * 将一个 Tab 标记为「已保存到指定文件」的干净状态：更新路径/名称/内容/originalContent，
 * 清除脏标记并标记 isNewlyLoaded（等待编辑器归一化），随后调度归一化清理。
 */
function applySavedTabState(tab: Tab, filePath: string, content: string) {
  tab.filePath = filePath;
  tab.name = getFileName(filePath);
  tab.content = content;
  tab.originalContent = content;
  tab.isModified = false;
  tab.saveStatus = "saved";
  tab.isNewlyLoaded = true;
  scheduleNewlyLoadedCleanup(tab.id);
}

/** 判断是否为「可复用的空白 Untitled Tab」（默认名、无路径、未修改、内容为空）。 */
function isReusableUntitledTab(tab: Tab): boolean {
  return (
    tab.name === defaultName &&
    tab.filePath === null &&
    !tab.isModified &&
    tab.content.length === 0 &&
    tab.originalContent.length === 0
  );
}

/** 查找可复用的空白 Untitled Tab：优先指定的 preferredTabId，否则取第一个符合条件者。 */
function findReusableUntitledTab(preferredTabId?: string | null): Tab | null {
  if (preferredTabId) {
    const preferred = getValidTabs().find((tab) => tab.id === preferredTabId);
    if (preferred && isReusableUntitledTab(preferred)) {
      return preferred;
    }
  }

  return getValidTabs().find((tab) => isReusableUntitledTab(tab)) || null;
}

/**
 * 若已存在打开同一目标路径的其他 Tab，则把保存结果合并到该已有 Tab 并关闭源 Tab，避免重复打开。
 * @returns 合并到的已有 Tab；若不存在同路径 Tab 则返回 null
 */
function mergeSavedTabIntoExisting(
  sourceTab: Tab,
  filePath: string,
  content: string,
  options?: { fileTraits?: FileTraitsDTO; readOnly?: boolean }
) {
  const existingTab = getValidTabs().find(
    (item) => item.id !== sourceTab.id && item.filePath === filePath
  );
  if (!existingTab) return null;

  applySavedTabState(existingTab, filePath, content);
  existingTab.fileTraits = options?.fileTraits ?? existingTab.fileTraits;
  existingTab.readOnly = options?.readOnly ?? existingTab.readOnly;

  const sourceTabId = sourceTab.id;
  setActive(existingTab.id);
  close(sourceTabId);

  return existingTab;
}

const autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const autoSaveInFlight = new Set<string>();
const autoSavePending = new Set<string>();

function clearAutoSaveTimer(tabId: string) {
  const timer = autoSaveTimers.get(tabId);
  if (timer) {
    clearTimeout(timer);
    autoSaveTimers.delete(tabId);
  }
}

/** 判断 Tab 是否满足自动保存条件（有路径、非只读、已修改、且非刚加载）。 */
function canAutoSave(tab: Tab | null | undefined): tab is Tab {
  return Boolean(tab?.filePath && !tab.readOnly && tab.isModified && !tab.isNewlyLoaded);
}

/** 安排防抖自动保存：满足条件时在 AUTO_SAVE_DELAY 后触发 autoSaveTab。 */
function scheduleAutoSave(tab: Tab | null | undefined) {
  if (!canAutoSave(tab)) return;

  tab.saveStatus = "unsaved";
  clearAutoSaveTimer(tab.id);
  autoSaveTimers.set(
    tab.id,
    setTimeout(() => {
      autoSaveTimers.delete(tab.id);
      void autoSaveTab(tab.id);
    }, AUTO_SAVE_DELAY)
  );
}

/**
 * 执行单个 Tab 的自动保存：写入磁盘并仅以「本次写入快照」校正脏状态（保存期间用户可能继续输入）。
 * 通过 in-flight / pending 集合避免并发重入；若期间有新改动则再次排程。
 * @returns 是否在本次保存后变为干净状态
 */
async function autoSaveTab(tabId: string): Promise<boolean> {
  const tab = getValidTabs().find((item) => item.id === tabId);
  if (!canAutoSave(tab)) return false;

  if (autoSaveInFlight.has(tabId)) {
    autoSavePending.add(tabId);
    return false;
  }

  autoSaveInFlight.add(tabId);
  tab.saveStatus = "saving";
  const contentToSave = tab.content;

  try {
    const { config } = useConfig();
    const defaultLineEnding = await resolveDefaultLineEnding(config.value.other?.defaultLineEnding);
    await apiSaveFile({
      filePath: tab.filePath!,
      content: contentToSave,
      fileTraits: toRaw(tab.fileTraits),
      defaultLineEnding,
      imageLocalPath: config.value.image.localPath,
    });

    // 保存过程中用户可能继续输入，只确认本次写入时的快照。
    tab.originalContent = contentToSave;
    tab.isModified =
      normalizeMarkdownForDirtyCheck(tab.content) !== normalizeMarkdownForDirtyCheck(contentToSave);
    tab.saveStatus = tab.isModified ? "unsaved" : "saved";
    if (tab.isModified || autoSavePending.has(tabId)) {
      autoSavePending.delete(tabId);
      scheduleAutoSave(tab);
    }
    return !tab.isModified;
  } catch (error) {
    tab.saveStatus = "error";
    console.error("自动保存失败:", error);
    return false;
  } finally {
    autoSaveInFlight.delete(tabId);
  }
}

// 保存指定tab
/**
 * 手动保存指定 Tab：只读或无路径不写盘（无路径交由另存为流程）。
 * 写入后回读磁盘内容，必要时合并到同路径已有 Tab，并广播 file:Change 与 editor:reload。
 * 失败时设置 error 状态并 toast 提示。
 * @returns 是否保存成功
 */
async function saveTab(tab: Tab): Promise<boolean> {
  if (!tab || tab.readOnly) return false;

  try {
    clearAutoSaveTimer(tab.id);
    const { config } = useConfig();
    // 传递 fileTraits 给 Tauri/Rust 宿主层，由宿主层负责还原 BOM、换行符、末尾换行
    // toRaw 将 Vue Proxy 转为普通对象，避免 IPC 序列化失败
    if (!tab.filePath) {
      // 新文件走 saveFileAs 流程（由调用方 useFile.onSaveAs 处理），此处直接返回 false
      tab.saveStatus = tab.isModified ? "unsaved" : "saved";
      return false;
    }
    tab.saveStatus = "saving";
    const defaultLineEnding = await resolveDefaultLineEnding(config.value.other?.defaultLineEnding);
    const saved = await apiSaveFile({
      filePath: tab.filePath,
      content: tab.content,
      fileTraits: toRaw(tab.fileTraits),
      defaultLineEnding,
      imageLocalPath: config.value.image.localPath,
    });
    if (saved) {
      const fileContent = await readAndProcessFile({
        filePath: saved.filePath,
        checkReadOnly: false,
      });

      const nextContent = fileContent?.content ?? saved.content;
      const mergedTab = mergeSavedTabIntoExisting(tab, saved.filePath, nextContent, {
        fileTraits: fileContent?.fileTraits ?? tab.fileTraits,
        readOnly: fileContent?.readOnly ?? tab.readOnly,
      });
      if (!mergedTab) {
        applySavedTabState(tab, saved.filePath, nextContent);
        tab.fileTraits = fileContent?.fileTraits ?? tab.fileTraits;
        tab.readOnly = fileContent?.readOnly ?? tab.readOnly;
      }

      emitter.emit("file:Change");
      nextTick(() => {
        emitter.emit("editor:reload");
      });
      return true;
    }
  } catch (error) {
    tab.saveStatus = "error";
    autotoast.show("保存文件失败，请检查写入权限", "error");
    console.error("保存文件失败:", error);
  }
  return false;
}

// 保存当前tab
/** 保存当前活跃 Tab。 */
async function saveCurrentTab(): Promise<boolean> {
  const currentTab = getCurrentTab();
  return saveTab(currentTab!);
}

async function cleanupTabLocalImages(tab: Tab | null | undefined): Promise<void> {
  if (!tab?.content) return;

  try {
    await apiCleanupLocalImages(tab.content);
  } catch (error) {
    console.error("清理临时图片失败:", error);
  }
}

// 从文件创建新tab
/**
 * 从文件创建新 Tab：用文件服务构建 Tab 数据并查询只读状态，标记 isNewlyLoaded 后加入列表。
 * @returns 创建（或复用同路径）的 Tab
 */
async function createTabFromFile(
  filePath: string,
  content: string,
  fileTraits?: FileTraitsDTO
): Promise<Tab> {
  // 使用统一的文件服务创建Tab数据
  const tabData = createTabDataFromFile(filePath, content, { fileTraits });

  // 单独获取只读状态
  const readOnly = await apiIsReadOnly(filePath).catch(() => false);

  const tab: Tab = {
    id: randomUUID(),
    ...tabData,
    readOnly,
    isNewlyLoaded: true,
  };
  scheduleNewlyLoadedCleanup(tab.id);

  return add(tab);
}

// 打开文件
/** 打开文件（使用默认选项：复用空白 Untitled、记录最近打开）。 */
async function openFile(filePath: string): Promise<Tab | null> {
  return openFileWithOptions(filePath);
}

interface OpenFileOptions {
  reuseUntitled?: boolean;
  trackRecent?: boolean;
}

/**
 * 带选项打开文件：已打开则切换；否则读取处理文件，按需复用空白 Untitled 或新建 Tab。
 * @param options.reuseUntitled 是否复用空白 Untitled（默认 true）
 * @param options.trackRecent 是否记录到最近打开（默认 true）
 * @returns 打开的 Tab，失败返回 null
 */
async function openFileWithOptions(
  filePath: string,
  options: OpenFileOptions = {}
): Promise<Tab | null> {
  const { reuseUntitled = true, trackRecent = true } = options;

  try {
    // 检查文件是否已经在当前窗口中打开
    const existingTab = isFileAlreadyOpen(filePath);
    if (existingTab) {
      // 如果文件已打开，直接切换到该tab
      await switchToTab(existingTab.id);
      if (trackRecent) {
        pushRecentOpenItem(existingTab.filePath || filePath, "file");
      }
      return existingTab;
    }

    // 使用统一的文件服务读取和处理文件
    const fileContent = await readAndProcessFile({ filePath });
    if (!fileContent) {
      console.error("无法读取文件:", filePath);
      return null;
    }

    // 若窗口里存在未保存且空白的 Untitled，则复用它并保留原位置
    const reusableUntitledTab = reuseUntitled ? findReusableUntitledTab(activeTabId.value) : null;
    let openedTab: Tab;

    if (reusableUntitledTab) {
      applySavedTabState(reusableUntitledTab, fileContent.filePath, fileContent.content);
      reusableUntitledTab.readOnly = fileContent.readOnly || false;
      reusableUntitledTab.fileTraits = fileContent.fileTraits;
      await switchToTab(reusableUntitledTab.id);
      openedTab = reusableUntitledTab;
    } else {
      // 创建新tab
      const newTab = await createTabFromFile(
        fileContent.filePath,
        fileContent.content,
        fileContent.fileTraits
      );
      // 切换新tab
      switchToTab(newTab.id);
      openedTab = newTab;

      // 触发内容更新事件
      emitter.emit("file:Change");
    }

    if (trackRecent) {
      pushRecentOpenItem(fileContent.filePath, "file");
    }

    return openedTab;
  } catch (error) {
    console.error("打开文件失败:", error);
    return null;
  }
}

// 创建新文件tab
/** 创建一个空白未命名 Tab 并激活。 */
function createNewTab(): Tab {
  const tab: Tab = {
    id: randomUUID(),
    name: defaultName,
    filePath: null,
    content: "",
    originalContent: "",
    isModified: false,
    scrollRatio: 0,
    readOnly: false,
    isNewlyLoaded: true,
  };
  scheduleNewlyLoadedCleanup(tab.id);

  return add(tab);
}

// 切换tab（多编辑器实例模式：每个 tab 有独立编辑器，无需重建/同步内容）
/** 切换到指定 Tab（多编辑器实例模式，仅切活跃态并更新图片路径解析的基准）。 */
async function switchToTab(id: string) {
  const targetTab = getValidTabs().find((tab) => tab.id === id);
  if (!targetTab) return;

  // 设置当前tab为活跃状态
  setActive(id);

  // 设置当前文件路径用于图片路径解析
  if (targetTab.filePath) {
    setCurrentMarkdownFilePath(targetTab.filePath);
  } else {
    setCurrentMarkdownFilePath(null);
  }
}

// 计算属性
const hasUnsavedTabs = computed(() => {
  return getValidTabs().some((tab) => tab.isModified);
});

// 获取所有未保存的标签页
function getUnsavedTabs() {
  return getValidTabs().filter((tab) => tab.isModified);
}

// 确保激活的tab在可视区域内
/** 确保激活的 Tab 在 TabBar 可视区域内（计入内边距、阴影偏移与侧栏展开造成的偏移），必要时平滑滚动。 */
function ensureActiveTabVisible(containerRef: Ref<HTMLElement | null>) {
  const container = containerRef.value;
  if (!container || !activeTabId.value) return;

  // 查找激活的tab元素
  const activeTabElement = container.querySelector(
    `[data-tab-id="${activeTabId.value}"]`
  ) as HTMLElement;
  if (!activeTabElement) return;

  const containerRect = container.getBoundingClientRect();
  const tabRect = activeTabElement.getBoundingClientRect();

  const paddingOffset = 12; // 额外的内边距
  const shadowOffset = 8; // 阴影偏移量，确保阴影完全显示

  // 当侧边栏展开时，TabBar 会整体右移侧边栏宽度。
  const offsetLeft = isFileSidebarVisible.value ? getSidebarWidth("file") : 0;

  // 检查tab是否完全在可视区域内（包括阴影和偏移）
  const isFullyVisible =
    tabRect.left >= containerRect.left + paddingOffset + offsetLeft &&
    tabRect.right <= containerRect.right - paddingOffset - shadowOffset;

  if (!isFullyVisible) {
    // 计算tab相对于容器的位置
    const tabOffsetLeft = activeTabElement.offsetLeft;

    // 计算可视区域的边界（考虑偏移量）
    // 当有大纲显示时，可视区域会整体右移一个侧边栏宽度。
    const visibleLeft = paddingOffset;
    const visibleRight = container.clientWidth - paddingOffset - shadowOffset;

    let scrollLeft = 0;

    // 如果tab在左侧被遮挡
    if (tabRect.left < containerRect.left + paddingOffset + offsetLeft) {
      // 将tab滚动到可视区域的左侧
      scrollLeft = tabOffsetLeft - visibleLeft;
    } else if (tabRect.right > containerRect.right - paddingOffset - shadowOffset) {
      // 如果tab在右侧被遮挡（包括阴影）
      // 将tab滚动到可视区域的右侧
      scrollLeft = tabOffsetLeft - visibleRight + activeTabElement.offsetWidth;
    }

    // 确保滚动位置不会超出边界
    // 当有偏移时，最小滚动位置需要考虑偏移量
    const minScrollLeft = isFileSidebarVisible.value ? -offsetLeft : 0;
    const maxScrollLeft = container.scrollWidth - container.clientWidth;
    scrollLeft = Math.max(minScrollLeft, Math.min(scrollLeft, maxScrollLeft));

    // 使用专门优化的tab切换滚动
    const inertiaInstance = getInertiaScrollInstance(container);
    inertiaInstance.scrollTo(scrollLeft); // 使用平滑滚动动画
  }
}

// 惯性滚动实例存储
const inertiaScrollInstances = new Map<HTMLElement, InertiaScroll>();

// 获取或创建惯性滚动实例
function getInertiaScrollInstance(container: HTMLElement): InertiaScroll {
  if (!inertiaScrollInstances.has(container)) {
    const instance = createInertiaScroll(container);
    inertiaScrollInstances.set(container, instance);
  }
  return inertiaScrollInstances.get(container)!;
}

// 滚动
function handleWheelScroll(event: WheelEvent, containerRef: Ref<HTMLElement | null>) {
  const container = containerRef.value;
  if (!container) return;

  // 获取惯性滚动实例并处理滚轮事件
  const inertiaScroll = getInertiaScrollInstance(container);
  inertiaScroll.handleWheel(event);
}

// 带确认的关闭tab
/** 带未保存确认的关闭：已修改则发出 tab:close-confirm 由 UI 弹窗，否则直接关闭（最后一个 Tab 走关闭应用）。 */
function closeWithConfirm(id: string) {
  const tabToClose = getValidTabs().find((tab) => tab.id === id);
  if (!tabToClose) return;

  // 检查是否是最后一个tab
  const isLastTab = tabs.value.length === 1;

  // 检查是否有未保存的内容
  if (tabToClose.isModified) {
    // 触发自定义确认对话框，传递tab信息和是否是最后一个tab
    emitter.emit("tab:close-confirm", {
      tabId: id,
      tabName: tabToClose.name,
      isLastTab,
    });
    return;
  }

  // 如果没有未保存内容
  if (isLastTab) {
    // 如果是最后一个tab，直接关闭应用
    void apiCloseDiscard().catch(() => {});
  } else {
    // 否则直接关闭tab
    close(id);
  }
}

// 拖动排序功能
/** 拖动排序：把 Tab 从 fromIndex 移动到 toIndex。 */
function reorderTabs(fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex) return;

  // 移动tab到新位置
  const [movedTab] = tabs.value.splice(fromIndex, 1);
  tabs.value.splice(toIndex, 0, movedTab);
}

// ── Tab 拖拽分离 ──────────────────────────────────────────

/** 获取指定 Tab 的完整数据，用于跨窗口传递 */
function getTabDataForTearOff(tabId: string): TearOffTabData | null {
  const tab = getValidTabs().find((t) => t.id === tabId);
  if (!tab) return null;

  // toRaw 剥离 Vue reactive proxy，否则 IPC structured clone 无法序列化
  const raw = toRaw(tab);
  return {
    id: raw.id,
    name: raw.name,
    filePath: raw.filePath,
    sourceLabel: currentWindowLabel(),
    content: raw.content,
    originalContent: raw.originalContent,
    isModified: raw.isModified,
    scrollRatio: raw.scrollRatio ?? 0,
    readOnly: raw.readOnly,
    fileTraits: raw.fileTraits ? toRaw(raw.fileTraits) : undefined,
  };
}

/** 记录当前正在分离的 Tab ID，用于取消分离时恢复 */
let tearOffSourceTabId: string | null = null;

/**
 * 开始拖拽分离：立即创建新窗口并跟随光标
 * 由 TabBar 的 pointermove 在指针离开窗口时调用（fire-and-forget）
 *
 * 同时立即切换到相邻 Tab，避免源窗口继续显示被拖出的内容
 */
function startTearOff(
  tabId: string,
  screenX: number,
  screenY: number,
  offsetX: number,
  offsetY: number
): void {
  const tabData = getTabDataForTearOff(tabId);
  if (!tabData) return;

  // 立即切换到相邻 Tab，使源窗口显示正确的内容
  tearOffSourceTabId = tabId;
  const tabIndex = tabs.value.findIndex((t) => t?.id === tabId);
  if (tabIndex !== -1 && tabs.value.length > 1) {
    // 优先切换到后一个 Tab，没有则切换到前一个
    const nextIndex = tabIndex < tabs.value.length - 1 ? tabIndex + 1 : tabIndex - 1;
    const nextTab = tabs.value[nextIndex];
    if (nextTab) {
      switchToTab(nextTab.id);
    }
  }

  apiTearOffTabStart(tabData, screenX, screenY, offsetX, offsetY).catch((err) => {
    console.error("[useTab] tearOffTabStart 失败:", err);
  });
}

/**
 * 取消拖拽分离：指针回到源窗口时调用，关闭已创建的跟随窗口
 * 同时恢复到被拖出的 Tab
 */
function cancelTearOff(): void {
  // 恢复到被拖出的 Tab
  if (tearOffSourceTabId) {
    switchToTab(tearOffSourceTabId);
    tearOffSourceTabId = null;
  }
  apiTearOffTabCancel().catch(() => {});
}

/**
 * 完成拖拽分离：停止跟随、判断合并或保留新窗口、从源窗口移除 Tab
 * 由 TabBar 的 SortableJS onEnd（鼠标松开）时调用
 */
async function endTearOff(tabId: string, screenX: number, screenY: number): Promise<boolean> {
  try {
    const result = await apiTearOffTabEnd(screenX, screenY);
    if (result.action === "failed") {
      // 分离失败，恢复到被拖出的 Tab
      if (tearOffSourceTabId) {
        switchToTab(tearOffSourceTabId);
      }
      tearOffSourceTabId = null;
      return false;
    }

    tearOffSourceTabId = null;

    // 成功创建新窗口或合并后，从当前窗口移除该 Tab
    // 由于 startTearOff 时已切换到相邻 Tab，close 只需移除该 Tab 即可
    const isLastTab = tabs.value.length === 1;
    if (isLastTab) {
      void apiCloseDiscard().catch(() => {});
    } else {
      close(tabId);
      // 保底：编辑器的 setMarkdown 在 RAF 中执行，可能因帧调度时序被跳过
      // 用 setTimeout 确保内容刷新一定生效
      setTimeout(() => {
        const current = getCurrentTab();
        if (current) {
          emitter.emit("file:Change");
        }
      }, 50);
    }

    return true;
  } catch (error) {
    // 分离异常，恢复到被拖出的 Tab
    if (tearOffSourceTabId) {
      switchToTab(tearOffSourceTabId);
    }
    tearOffSourceTabId = null;
    console.error("[useTab] Tab 拖拽分离失败:", error);
    return false;
  }
}

// ── Tab 合并接收 ──────────────────────────────────────────

/** 监听来自其他窗口的 Tab 合并请求 */
/** 监听来自其他窗口的 Tab 合并请求：以新 ID 接收数据并追加为活跃 Tab（避免跨窗口 ID 冲突）。 */
function handleTabMergeIn(tabData: TearOffTabData) {
  const tab: Tab = {
    id: randomUUID(), // 生成新 ID，避免跨窗口冲突
    name: tabData.name,
    filePath: tabData.filePath,
    content: tabData.content,
    originalContent: tabData.originalContent,
    isModified: tabData.isModified,
    scrollRatio: tabData.scrollRatio ?? 0,
    readOnly: tabData.readOnly,
    isNewlyLoaded: !tabData.isModified,
    fileTraits: tabData.fileTraits,
  };

  tabs.value.push(tab);
  activeTabId.value = tab.id;
  if (!tabData.isModified) {
    scheduleNewlyLoadedCleanup(tab.id);
  }

  if (tab.filePath) {
    setCurrentMarkdownFilePath(tab.filePath);
  }
}
apiOnTabMergeIn(handleTabMergeIn).catch(() => {});

// ── Tab 合并预览（悬停即合并，离开撤销）──────────────────

let mergePreviewState: {
  tabId: string;
  prevActiveId: string | null;
  isExisting: boolean;
} | null = null;

/**
 * 处理合并预览（拖拽悬停即插入预览 Tab，离开撤销）。
 * 若同路径 Tab 已存在则直接激活它作为预览目标；否则按光标屏幕坐标计算插入位置，
 * 重建一个 isMergePreview 预览 Tab 并激活，记录 mergePreviewState 以便撤销/定稿。
 */
function handleTabMergePreview(tabData: TearOffTabData, screenX?: number, screenY?: number) {
  const prevActiveId = activeTabId.value;

  // 若已存在同文件路径的 Tab，直接激活它作为预览目标
  if (tabData.filePath) {
    const existing = isFileAlreadyOpen(tabData.filePath);
    if (existing) {
      mergePreviewState = {
        tabId: existing.id,
        prevActiveId,
        isExisting: true,
      };
      switchToTab(existing.id);
      return;
    }
  }

  // 计算插入位置
  let insertIndex = tabs.value.length;
  if (screenX !== undefined && screenY !== undefined) {
    // 将屏幕坐标转换为页面内坐标
    // 注意：window.screenX 是窗口左上角在屏幕的 X，加上边框偏移才是内容区
    // 简化处理：假设标准边框或无边框，contentX ≈ screenX - window.screenX
    // 更精确的方式难以在纯 IPC 中获取，但如果不考虑标题栏（无框窗口），这样近似可行
    const clientX = screenX - window.screenX;

    // 获取所有 tab 元素 (排除预览 Tab 自身)
    const tabElements = Array.from(document.querySelectorAll("[data-tab-id]:not(.merge-preview)"));

    // 找到插入点
    for (let i = 0; i < tabElements.length; i++) {
      const rect = tabElements[i].getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      if (clientX < centerX) {
        insertIndex = i;
        break;
      }
    }
  }

  // 取消旧预览，总是重建以确保正确的插入位置
  if (mergePreviewState && !mergePreviewState.isExisting) {
    close(mergePreviewState.tabId);
  }

  const tab: Tab = {
    id: randomUUID(),
    name: tabData.name,
    filePath: tabData.filePath,
    content: tabData.content,
    originalContent: tabData.originalContent,
    isModified: tabData.isModified,
    scrollRatio: tabData.scrollRatio ?? 0,
    readOnly: tabData.readOnly,
    isNewlyLoaded: !tabData.isModified,
    isMergePreview: true,
    fileTraits: tabData.fileTraits,
  };

  // 插入到指定位置
  tabs.value.splice(insertIndex, 0, tab);
  activeTabId.value = tab.id;
  if (!tabData.isModified) {
    scheduleNewlyLoadedCleanup(tab.id);
  }

  if (tab.filePath) {
    setCurrentMarkdownFilePath(tab.filePath);
  }

  mergePreviewState = {
    tabId: tab.id,
    prevActiveId,
    isExisting: false,
  };
}

/** 取消合并预览：移除预览 Tab（若是新建的）并恢复到预览前的活跃 Tab。 */
function handleTabMergePreviewCancel() {
  if (!mergePreviewState) return;
  const { tabId, prevActiveId, isExisting } = mergePreviewState;
  mergePreviewState = null;

  if (!isExisting) {
    close(tabId);
  }

  if (prevActiveId && getValidTabs().find((tab) => tab.id === prevActiveId)) {
    switchToTab(prevActiveId);
  }
}

/** 定稿合并预览：把预览 Tab 转为正式 Tab（清除 isMergePreview 标记）。 */
function handleTabMergePreviewFinalize() {
  if (!mergePreviewState) return;
  const { tabId, isExisting } = mergePreviewState;
  mergePreviewState = null;

  if (isExisting) return;
  const tab = getValidTabs().find((t) => t.id === tabId);
  if (tab) {
    tab.isMergePreview = false;
  }
}

/**
 * 动态更新合并预览 Tab 的插入位置
 * 由 Tauri 宿主侧在光标移动时持续发送，实现拖拽悬停时预览 Tab 跟随光标变换顺序
 */
function handleTabMergePreviewUpdate(screenX: number, _screenY: number) {
  if (!mergePreviewState || mergePreviewState.isExisting) return;

  const { tabId } = mergePreviewState;
  const currentIndex = tabs.value.findIndex((t) => t?.id === tabId);
  if (currentIndex === -1) return;

  // 将屏幕坐标转为页面内坐标
  const clientX = screenX - window.screenX;

  // 获取所有非预览 Tab 元素
  const tabElements = Array.from(
    document.querySelectorAll("[data-tab-id]:not(.merge-preview)")
  ) as HTMLElement[];

  // 默认放在末尾
  let targetIndex = tabs.value.length - 1;
  for (let i = 0; i < tabElements.length; i++) {
    const rect = tabElements[i].getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    if (clientX < centerX) {
      // 找到该元素在 tabs 数组中的真实索引
      const elTabId = tabElements[i].dataset.tabId;
      const realIndex = tabs.value.findIndex((t) => t?.id === elTabId);
      if (realIndex !== -1) {
        // 如果预览 Tab 在目标之前，移除后索引需 -1
        targetIndex = currentIndex < realIndex ? realIndex - 1 : realIndex;
      }
      break;
    }
  }

  // 仅在位置真正变化时才更新，避免不必要的 Vue 响应式开销
  if (targetIndex !== currentIndex) {
    const [tab] = tabs.value.splice(currentIndex, 1);
    tabs.value.splice(targetIndex, 0, tab);
  }
}

apiOnTabMergePreview(handleTabMergePreview).catch(() => {});
apiOnTabMergePreviewCancel(handleTabMergePreviewCancel).catch(() => {});
apiOnTabMergePreviewFinalize(handleTabMergePreviewFinalize).catch(() => {});
apiOnTabMergePreviewUpdate(handleTabMergePreviewUpdate).catch(() => {});

// ── 跨窗口激活路由（如 openLink 命中已打开文件）────────────

apiOnActivateFile((filePath: string) => {
  const existingTab = isFileAlreadyOpen(filePath);
  if (existingTab) {
    switchToTab(existingTab.id);
  }
}).catch(() => {});

// ── 单 Tab 窗口拖拽 ──────────────────────────────────────

const isSingleTab = computed(() => tabs.value.length === 1);

/**
 * 开始单 Tab 窗口拖拽：直接移动整个窗口
 * @param offsetX 鼠标相对窗口左上角的 X 偏移
 * @param offsetY 鼠标相对窗口左上角的 Y 偏移
 */
function startSingleTabDrag(tabId: string, offsetX: number, offsetY: number): void {
  const tabData = getTabDataForTearOff(tabId);
  if (!tabData) return;
  apiStartWindowDrag(tabData, offsetX, offsetY).catch((err) => {
    console.error("[useTab] startWindowDrag 失败:", err);
  });
}

/**
 * 结束单 Tab 窗口拖拽：判断是否合并到目标窗口
 */
async function endSingleTabDrag(screenX: number, screenY: number): Promise<void> {
  await apiStopWindowDrag();

  // 获取当前唯一 Tab 数据
  const tab = getValidTabs()[0];
  if (!tab) return;

  const tabData = getTabDataForTearOff(tab.id);
  if (!tabData) return;

  const result = await apiDropMerge(tabData, screenX, screenY);
  if (result.action === "merged") {
    // 合并成功，关闭当前窗口
    await apiCloseDiscard();
  }
}

// 设置tab容器的滚动监听
/** 设置 TabBar 容器滚动监听：activeTabId 变化时确保激活 Tab 可见。 */
function setupTabScrollListener(containerRef: Ref<HTMLElement | null>) {
  // 监听激活tab变化，确保其可见
  watch(activeTabId, () => {
    nextTick(() => {
      ensureActiveTabVisible(containerRef);
    });
  });
}

// 清理惯性滚动实例
/** 销毁并移除指定容器的惯性滚动实例。 */
function cleanupInertiaScroll(container: HTMLElement) {
  const instance = inertiaScrollInstances.get(container);
  if (instance) {
    instance.destroy();
    inertiaScrollInstances.delete(container);
  }
}

// 计算属性：格式化tab显示名称
// 仅依赖渲染所需的属性，避免 content/originalContent 变化（如归一化）触发不必要的重算
const formattedTabs = computed(() => {
  const nameCountMap = new Map<string, number>();
  const validTabs = getValidTabs();

  for (const tab of validTabs) {
    nameCountMap.set(tab.name, (nameCountMap.get(tab.name) || 0) + 1);
  }

  return validTabs.map((tab) => ({
    id: tab.id,
    name: tab.name,
    filePath: tab.filePath,
    readOnly: tab.readOnly,
    isModified: tab.isModified,
    isMergePreview: tab.isMergePreview,
    displayName: `${tab.readOnly ? "[只读] " : ""}${tab.isModified ? "*" : ""}${tab.name}`,
    pathHint: nameCountMap.get(tab.name)! > 1 && tab.filePath ? tab.filePath : "",
  }));
});

const currentTab = computed(() => getCurrentTab());

// 是否偏移
const shouldOffsetTabBar = computed(() => isFileSidebarVisible.value);

// 副作用：监听当前窗口会话快照（活跃文件 / 打开文件列表 / 工作区路径），持久化以便重启恢复。
watch(
  () => ({
    activeFilePath: currentTab.value?.filePath ?? null,
    openFilePaths: getValidTabs()
      .filter((tab) => !tab.isMergePreview && typeof tab.filePath === "string" && tab.filePath)
      .map((tab) => tab.filePath as string),
    workspacePath: getWorkspacePathForWindow(currentWindowLabel()),
  }),
  (snapshot) => {
    saveLastSessionSnapshot({
      windowLabel: currentWindowLabel(),
      workspacePath: snapshot.workspacePath,
      openFilePaths: snapshot.openFilePaths,
      activeFilePath: snapshot.activeFilePath,
    });
  },
  { deep: true, immediate: true }
);

// 添加新tab时不通知，只有当filePath实际变化时才通知
watch(
  () => getValidTabs().map((tab) => tab.filePath),
  (newPaths, oldPaths) => {
    // 获取所有真实的filePath
    const newFilePaths = newPaths.filter(Boolean) as string[];
    const oldFilePaths = (oldPaths?.filter(Boolean) as string[]) || [];

    // 判断是否有新的路径,包括首次执行时从空到有路径的情况，以及untitled标签被替换时监听不到的问题
    const hasNewPaths = newFilePaths.some((path) => !oldFilePaths.includes(path));
    // 判断是否有删除的路径
    const hasRemovedPaths = oldFilePaths.some((path) => !newFilePaths.includes(path));
    // 判断是否有路径变化，首次执行时 oldPaths 为 undefined，oldFilePaths 为 []，如果有新路径会被 hasNewPaths 捕获
    const hasPathChanges = hasNewPaths || hasRemovedPaths;

    if (!hasPathChanges) return;
    // 通知 Rust 同步监听集合
    apiWatchFiles(newFilePaths).catch((e) => {
      console.error("[useTab] watchFiles failed:", e);
    });
  },
  {
    immediate: true,
  }
);

// 文件变动回 callback 事件（Rust emit file:changed）
// 文件变动回 callback 事件（Rust emit file:changed）：
//  - Tab 未修改：静默重载磁盘内容并标记 isNewlyLoaded 让编辑器重新捕获 originalContent；
//  - Tab 已修改：弹「磁盘已变更是否覆盖」确认，用户确认后再重载。
onFileChanged(async (paths) => {
  const tab = getValidTabs().find((tab) => tab.filePath === paths);
  if (!tab) return;
  if (tab.saveStatus === "saving") return;

  if (!tab.isModified) {
    // 使用统一的文件服务读取和处理文件
    const fileContent = await readAndProcessFile({ filePath: paths });
    if (!fileContent) return;

    // 更新内容，标记为新加载让编辑器重新捕获 originalContent
    tab.content = fileContent.content;
    tab.originalContent = fileContent.content;
    tab.isModified = false;
    tab.isNewlyLoaded = true;
    tab.fileTraits = fileContent.fileTraits;
    scheduleNewlyLoadedCleanup(tab.id);

    // 如果当前tab是活跃的，触发内容更新事件
    if (tab.id === activeTabId.value) {
      emitter.emit("file:Change");
    }
  } else {
    // 文件已变动，触发是否覆盖
    const fileName = getFileName(paths);
    const choice = await new Promise<"overwrite" | "cancel">((resolve) => {
      emitter.emit("file:changed-confirm", {
        fileName,
        resolver: resolve,
      });
    });

    if (choice === "cancel") {
      return;
    }

    // 使用统一的文件服务读取和处理文件
    const fileContent = await readAndProcessFile({ filePath: paths });
    if (!fileContent) return;

    // 更新
    tab.content = fileContent.content;
    tab.originalContent = fileContent.content;
    tab.isModified = false;
    tab.isNewlyLoaded = true;
    tab.fileTraits = fileContent.fileTraits;
    scheduleNewlyLoadedCleanup(tab.id);

    // 触发内容更新
    if (tab.id === activeTabId.value) {
      emitter.emit("file:Change");
    }
  }
}).catch((e) => {
  console.error("[useTab] onFileChanged subscribe failed:", e);
});

/**
 * 多标签页 hook 主入口，返回上述全部状态与方法（按状态/更新/UI/拖动/拖拽分离/单 Tab 拖拽/工具分组）。
 */
function useTab() {
  return {
    // 状态
    tabs,
    activeTabId,
    currentTab,
    formattedTabs,
    hasUnsavedTabs,
    shouldOffsetTabBar,
    getUnsavedTabs,
    add,
    close,
    setActive,
    getCurrentTab,

    // 更新
    updateCurrentTabContent,
    updateCurrentTabScrollRatio,
    saveCurrentTab,
    saveTab,
    scheduleAutoSave,
    cleanupTabLocalImages,
    applySavedTabState,
    mergeSavedTabIntoExisting,
    findReusableUntitledTab,
    createTabFromFile,
    updateCurrentTabFile,
    createNewTab,
    switchToTab,
    openFile,
    openFileWithOptions,

    // UI
    ensureActiveTabVisible,
    handleWheelScroll,
    closeWithConfirm,
    setupTabScrollListener,
    cleanupInertiaScroll,

    // 拖动
    reorderTabs,

    // Tab 拖拽分离
    startTearOff,
    endTearOff,
    cancelTearOff,

    // 单 Tab 窗口拖拽
    isSingleTab,
    startSingleTabDrag,
    endSingleTabDrag,

    // 工具
    randomUUID,
    getFileName,
    isFileAlreadyOpen,
  };
}

export default useTab;
