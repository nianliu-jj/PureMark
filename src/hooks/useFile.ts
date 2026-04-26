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

function getDefaultSaveDirectory(): string | undefined {
  const tab = useTab().currentTab.value;
  if (tab?.filePath) {
    return tab.filePath.replace(/[/\\][^/\\]+$/, "");
  }
  return getWorkspacePathForWindow(currentWindowLabel()) ?? undefined;
}

function getDefaultSaveFileName(): string {
  const name = useTab().currentTab.value?.name?.trim() || "Untitled";
  return /\.(md|markdown)$/i.test(name) ? name : `${name}.md`;
}

// 创建新文件
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

async function openDroppedMarkdownPath(filePath: string) {
  const { openFileWithOptions } = useTab();

  showSidebar("outline");
  await openFileWithOptions(filePath, {
    reuseUntitled: false,
  });
}

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

    // 启动文件监听：先订阅再 ready，避免 renderer_ready 与 subscribe 之间的竞态
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
