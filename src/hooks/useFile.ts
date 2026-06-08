/**
 * useFile — 文件级业务编排（打开 / 保存 / 另存为 / 新建 / 拖拽 / 启动打开）。
 *
 * 该模块是「文件操作」的业务编排层：协调 useTab（多 Tab 状态与持久化）、useContent（当前文档内容视图）、
 * useTitle（窗口标题）与 useConfig（行尾、图片本地路径等配置），并通过 @/services/api 与 Rust 宿主交互。
 * 同时负责注册一次性的全局副作用：
 *  - 启动时打开文件（onOpenFileAtLaunch + notifyRendererReady，先订阅再 ready 以避免竞态）；
 *  - 菜单快捷键（Ctrl/Cmd+O、Ctrl/Cmd+S）的 DOM keydown 监听；
 *  - 浏览器侧拖拽事件（dragover/drop）与 Tauri 原生 onDragDropEvent 拖入文件/目录处理。
 * 所有内容变更后均通过 mitt 广播 `file:Change`（必要时 `editor:reload`）通知编辑器刷新。
 */
import type { Tab } from "@/types/tab";
// useFile.ts
import { stat } from "@tauri-apps/plugin-fs";
import { nextTick } from "vue";
import emitter from "@/events";
import {
  createEditorWindow,
  currentWindowLabel,
  isReadOnly,
  notifyRendererReady,
  onOpenFileAtLaunch,
  openFile as openFileDialog,
  saveFileAs as saveFileAsDialog,
} from "@/services/api";
import { readAndProcessFile } from "@/services/fileService";
import { getWorkspacePathForWindow } from "@/services/workspaceState";
import { resolveDefaultLineEnding } from "@/utils/lineEnding";
import { showSidebar } from "./useOutline";
import useContent from "./useContent";
import { useConfig } from "./useConfig";
import useTab from "./useTab";
import useTitle from "./useTitle";

/**
 * 打开文件。未传入 result 时弹出系统打开对话框；委托 useTab.openFile 走与工作区点击相同的代码路径，
 * 并把结果同步到 useContent 与窗口标题，最后广播 file:Change。
 * @param result 可选的已读取文件 { filePath, content }；为空则弹出对话框
 */
async function onOpen(result?: { filePath: string; content: string } | null) {
  const { updateTitle } = useTitle();
  const { markdown, filePath, originalContent } = useContent();
  const { openFile } = useTab();

  if (!result) {
    result = await openFileDialog();
  }
  if (!result) return;

  try {
    // 委托给 useTab.openFile — 与工作区点击打开使用相同的代码路径
    const tab = await openFile(result.filePath);

    if (tab) {
      // 同步 useContent 状态
      markdown.value = tab.content;
      filePath.value = tab.filePath || "";
      originalContent.value = tab.originalContent;
      updateTitle();
    }
  } finally {
    nextTick(() => {
      emitter.emit("file:Change");
    });
  }
}

/**
 * 保存当前 Tab。无文件路径时转为另存为；保存成功后回读磁盘内容以同步
 * fileTraits / readOnly 等元信息，再刷新 useContent 与标题。
 * @returns 是否保存成功
 */
async function onSave() {
  const { updateTitle } = useTitle();
  const { markdown, filePath, originalContent } = useContent();
  const { updateCurrentTabContent, saveCurrentTab, currentTab, applySavedTabState } = useTab();

  if (currentTab.value && !currentTab.value.filePath) {
    return onSaveAs();
  }

  // 先更新当前tab的内容
  updateCurrentTabContent(markdown.value);

  // 保存当前tab
  const saved = await saveCurrentTab();
  if (saved) {
    if (currentTab.value?.filePath) {
      const fileContent = await readAndProcessFile({
        filePath: currentTab.value.filePath,
        checkReadOnly: false,
      });

      if (fileContent) {
        applySavedTabState(currentTab.value, fileContent.filePath, fileContent.content);
        currentTab.value.fileTraits = fileContent.fileTraits ?? currentTab.value.fileTraits;
        currentTab.value.readOnly = fileContent.readOnly ?? currentTab.value.readOnly;
      }
    }

    filePath.value = currentTab.value?.filePath || "";
    markdown.value = currentTab.value?.content || "";
    originalContent.value = currentTab.value?.originalContent || "";
    updateTitle();
    nextTick(() => {
      emitter.emit("file:Change");
    });
  }
  return saved;
}

/**
 * 另存为：弹出保存对话框（带默认目录/文件名、行尾与图片本地路径配置），写入后回读磁盘内容。
 * 若目标路径已被其他 Tab 打开则合并到该 Tab，否则更新当前 Tab，最后广播 file:Change 与 editor:reload。
 * @returns 是否完成另存
 */
async function onSaveAs() {
  const { updateTitle } = useTitle();
  const { markdown, filePath, originalContent } = useContent();
  const { updateCurrentTabContent, currentTab, applySavedTabState, mergeSavedTabIntoExisting } =
    useTab();
  const { config } = useConfig();

  // 先更新当前tab的内容
  updateCurrentTabContent(markdown.value);
  const defaultLineEnding = await resolveDefaultLineEnding(config.value.other?.defaultLineEnding);

  const result = await saveFileAsDialog({
    content: markdown.value,
    fileTraits: currentTab.value?.fileTraits,
    defaultLineEnding,
    imageLocalPath: config.value.image.localPath,
    defaultPath: getDefaultSaveDirectory(),
    fileName: getDefaultSaveFileName(),
  });
  if (result) {
    const fileContent = await readAndProcessFile({
      filePath: result.filePath,
      checkReadOnly: false,
    });

    // 更新当前tab的文件路径
    if (currentTab.value) {
      const nextContent = fileContent?.content ?? result.content;
      const mergedTab = mergeSavedTabIntoExisting(currentTab.value, result.filePath, nextContent, {
        fileTraits: fileContent?.fileTraits ?? currentTab.value.fileTraits,
        readOnly: fileContent?.readOnly ?? currentTab.value.readOnly,
      });

      if (!mergedTab) {
        applySavedTabState(currentTab.value, result.filePath, nextContent);
        currentTab.value.fileTraits = fileContent?.fileTraits ?? currentTab.value.fileTraits;
        currentTab.value.readOnly = fileContent?.readOnly ?? currentTab.value.readOnly;
      }
    }

    filePath.value = result.filePath;
    markdown.value = useTab().currentTab.value?.content ?? fileContent?.content ?? result.content;
    originalContent.value =
      useTab().currentTab.value?.originalContent ?? fileContent?.content ?? result.content;
    updateTitle();
    nextTick(() => {
      emitter.emit("file:Change");
      emitter.emit("editor:reload");
    });
    return true;
  }
  return false;
}

/** 计算另存为默认目录：优先当前 Tab 所在目录，否则取当前窗口工作区路径。 */
function getDefaultSaveDirectory(): string | undefined {
  const tab = useTab().currentTab.value;
  if (tab?.filePath) {
    return tab.filePath.replace(/[/\\][^/\\]+$/, "");
  }
  return getWorkspacePathForWindow(currentWindowLabel()) ?? undefined;
}

/** 计算另存为默认文件名：基于当前 Tab 名，缺省 Untitled，并补全 .md 扩展名。 */
function getDefaultSaveFileName(): string {
  const name = useTab().currentTab.value?.name?.trim() || "Untitled";
  return /\.(md|markdown)$/i.test(name) ? name : `${name}.md`;
}

// 创建新文件
/** 新建空白文件：创建新 Tab 并清空当前内容状态，刷新标题后广播 file:Change。 */
function createNewFile() {
  const { updateTitle } = useTitle();
  const { markdown, filePath, originalContent } = useContent();
  const { createNewTab } = useTab();

  createNewTab();

  // 更新当前内容状态
  filePath.value = "";
  markdown.value = "";
  originalContent.value = "";

  updateTitle();
  nextTick(() => {
    emitter.emit("file:Change");
  });
}

/** Tab 切换时把目标 Tab 的内容同步到 useContent 并刷新标题、广播 file:Change。 */
function tabSwitch(tab: Tab) {
  const { updateTitle } = useTitle();
  const { markdown, filePath, originalContent } = useContent();

  // 更新当前内容状态
  filePath.value = tab.filePath || "";
  markdown.value = tab.content;
  originalContent.value = tab.originalContent;

  updateTitle();
  nextTick(() => {
    emitter.emit("file:Change");
  });
}

/** 打开拖入的 Markdown 文件路径：展开大纲侧栏并以「不复用空白 Untitled」方式打开。 */
async function openDroppedMarkdownPath(filePath: string) {
  const { openFileWithOptions } = useTab();

  showSidebar("outline");
  await openFileWithOptions(filePath, {
    reuseUntitled: false,
  });
}

/** 浏览器侧拖拽（无真实路径）回退：用拖入的文件名与文本内容创建一个未关联磁盘路径的新 Tab。 */
async function createTabFromDroppedFileName(name: string, content: string) {
  const { createNewTab, switchToTab } = useTab();
  const { markdown, filePath, originalContent } = useContent();
  const { updateTitle } = useTitle();

  showSidebar("outline");

  const tab = createNewTab();
  tab.name = name;
  tab.filePath = null;
  tab.content = content;
  tab.originalContent = content;
  tab.isModified = false;
  tab.isNewlyLoaded = true;
  await switchToTab(tab.id);

  markdown.value = content;
  filePath.value = "";
  originalContent.value = content;
  updateTitle();
  nextTick(() => {
    emitter.emit("file:Change");
  });
}

/**
 * 处理拖入的一批路径：目录路径各自打开新的编辑器窗口（带工作区），Markdown 文件路径逐个在当前窗口打开。
 * @param paths 拖入的文件/目录绝对路径列表
 */
async function handleDroppedPaths(paths: string[]) {
  const directoryPaths: string[] = [];
  const markdownPaths: string[] = [];

  for (const path of paths) {
    try {
      const info = await stat(path);
      if (info.isDirectory) {
        directoryPaths.push(path);
        continue;
      }
      if (info.isFile && /\.(md|markdown)$/i.test(path)) {
        markdownPaths.push(path);
      }
    } catch (error) {
      console.error("[useFile] 读取拖入路径信息失败:", path, error);
    }
  }

  for (const dirPath of directoryPaths) {
    await createEditorWindow({
      initState: {
        workspacePath: dirPath,
        fileSidebarVisible: true,
      },
    });
  }

  for (const markdownPath of markdownPaths) {
    await openDroppedMarkdownPath(markdownPath);
  }
}

// 防止重复注册事件监听器
let listenersRegistered = false;

/**
 * 文件操作 hook 主入口。返回文件相关动作与部分 Tab 能力的转发，
 * 并在首次调用时一次性注册启动打开、菜单快捷键、拖拽等全局监听器。
 * @returns onOpen / onSave / onSaveAs / tabSwitch / createNewFile 等动作，及转发自 useTab 的若干方法与状态。
 */
export default function useFile() {
  const { updateTitle } = useTitle();
  const { markdown, filePath, originalContent } = useContent();
  const {
    applySavedTabState,
    createTabFromFile,
    findReusableUntitledTab,
    switchToTab,
    updateCurrentTabContent,
    updateCurrentTabScrollRatio,
    saveCurrentTab,
    hasUnsavedTabs,
    currentTab,
    isFileAlreadyOpen,
  } = useTab();

  // 拖拽打开 Markdown 文件
  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDrop = async (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;

    try {
      const fullPaths = files
        .map((file) => (file as File & { path?: string }).path)
        .filter((path): path is string => typeof path === "string" && path.length > 0);

      if (fullPaths.length > 0) {
        await handleDroppedPaths(fullPaths);
        return;
      }

      const markdownFiles = files.filter((file) => /\.(?:md|markdown)$/i.test(file.name));
      for (const mdFile of markdownFiles) {
        const content = await mdFile.text();
        await createTabFromDroppedFileName(mdFile.name, content);
      }
    } catch (error) {
      console.error("读取拖拽文件失败:", error);
    }
  };

  // 只注册一次事件监听器，避免多个组件调用 useFile() 导致重复注册
  if (!listenersRegistered) {
    listenersRegistered = true;

    // 启动文件监听：先订阅再 ready，避免 renderer_ready 与 subscribe 之间的竞态。
    // 回调内复用空白 Untitled 或新建 Tab，并把内容同步到 useContent；若文件已打开则切换并同步。
    (async () => {
      try {
        await onOpenFileAtLaunch(async ({ filePath: launchFilePath, content, fileTraits }) => {
          // 检查文件是否已在当前窗口打开
          const existing = isFileAlreadyOpen(launchFilePath);
          if (existing) {
            await switchToTab(existing.id);
            markdown.value = existing.content;
            filePath.value = launchFilePath;
            originalContent.value = existing.originalContent;
            updateTitle();
            nextTick(() => {
              emitter.emit("file:Change");
            });
            return;
          }

          let tab: Tab;
          const reusableUntitledTab = findReusableUntitledTab(currentTab.value?.id);
          if (reusableUntitledTab) {
            applySavedTabState(reusableUntitledTab, launchFilePath, content);
            reusableUntitledTab.fileTraits = fileTraits;
            reusableUntitledTab.readOnly = await isReadOnly(launchFilePath);
            await switchToTab(reusableUntitledTab.id);
            tab = reusableUntitledTab;
          } else {
            tab = await createTabFromFile(launchFilePath, content, fileTraits);
            tab.readOnly = await isReadOnly(launchFilePath);
          }

          markdown.value = tab.content;
          filePath.value = launchFilePath;
          originalContent.value = content;

          updateTitle();
          nextTick(() => {
            emitter.emit("file:Change");
          });
        });
        // 订阅完成后才通知 Rust，Rust 随即 emit pending 的启动文件事件
        await notifyRendererReady();
      } catch (e) {
        console.error("[useFile] launch file bootstrap failed:", e);
      }
    })();

    // 阶段 4：菜单事件改为 DOM keydown（Ctrl/Cmd+O, Ctrl/Cmd+S）
    function onMenuKeydown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "o" && !e.shiftKey) {
        e.preventDefault();
        onOpen();
      } else if (key === "s" && !e.shiftKey) {
        e.preventDefault();
        onSave();
      }
    }
    window.addEventListener("keydown", onMenuKeydown);

    // 注册拖拽事件
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);
  }

  return {
    onOpen,
    onSave,
    onSaveAs,
    tabSwitch,
    createNewFile,
    switchToTab,
    updateCurrentTabContent,
    updateCurrentTabScrollRatio,
    saveCurrentTab,
    hasUnsavedTabs,
    currentTab,
  };
}

// ── Tauri 原生拖拽文件事件（替代浏览器侧 HTML5 drop 文件路径缺失）─
// Tauri 构建下 webview 的 HTML5 drop 会被 OS 级 drag-drop 抢占，必须用 `onDragDropEvent`。
if (typeof window !== "undefined") {
  import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) => {
      return getCurrentWindow().onDragDropEvent(async (event) => {
        if (event.payload.type !== "drop") return;
        const paths = event.payload.paths ?? [];
        if (paths.length === 0) return;
        await handleDroppedPaths(paths);
      });
    })
    .catch(() => {
      /* 非 Tauri 环境忽略 */
    });
}
