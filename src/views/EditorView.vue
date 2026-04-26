<script setup lang="ts">
import autotoast from "autotoast.js";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import SaveConfirmDialog from "@/components/dialogs/SaveConfirmDialog.vue";
import UpdateConfirmDialog from "@/components/dialogs/UpdateConfirmDialog.vue";
import PureMarkEditor from "@/components/editor/PureMarkEditor.vue";
import StatusBar from "@/components/menu/StatusBar.vue";
import TitleBar from "@/components/menu/TitleBar.vue";
import Outline from "@/components/outline/Outline.vue";
import WorkSpace from "@/components/workspace/WorkSpace.vue";
import emitter from "@/events";
import { useConfig } from "@/hooks/useConfig";
import { useContext } from "@/hooks/useContext";
import useFont from "@/hooks/useFont";
import { getLastSessionSnapshot } from "@/services/launchState";
import useOtherConfig from "@/hooks/useOtherConfig";
import {
  isFileSidebarVisible,
  isOutlineSidebarVisible,
  setSidebarsVisibility,
} from "@/hooks/useOutline";
import { useSaveConfirmDialog } from "@/hooks/useSaveConfirmDialog";
import useSourceCode from "@/hooks/useSourceCode";
import useSpellCheck from "@/hooks/useSpellCheck";
import useTab from "@/hooks/useTab";
import useTheme from "@/hooks/useTheme";
import { useUpdateDialog } from "@/hooks/useUpdateDialog";
import useWorkSpace from "@/hooks/useWorkSpace";
import {
  closeDiscard as apiCloseDiscard,
  currentWindowLabel,
  getWindowInitState,
  handleMacMainWindowHide,
  interceptCloseRequest,
  onUpdateAvailable as apiOnUpdateAvailable,
  quitAndInstall,
  workspaceExists,
} from "@/services/api";
import {
  DEFAULT_SIDEBAR_WIDTH,
  type SidebarPane,
  setSidebarWidth,
  useSidebarWidth,
} from "@/services/sidebarWidth";
import { shouldAutoLoadWorkspace } from "@/utils/workspacePath";

useContext();

const { init: initTheme } = useTheme();
const { init: initFont } = useFont();
const { init: initOtherConfig } = useOtherConfig();
const { config, setConf } = useConfig();
const { openWorkSpaceByPath } = useWorkSpace();
useSourceCode();
const { init: initSpellCheck } = useSpellCheck();
const {
  currentTab,
  tabs,
  activeTabId,
  close,
  saveCurrentTab,
  cleanupTabLocalImages,
  getUnsavedTabs,
  isFileAlreadyOpen,
  openFile,
  switchToTab,
} = useTab();
const {
  isDialogVisible,
  dialogType,
  fileName,
  tabName,
  handleSave,
  handleDiscard,
  handleCancel,
  handleOverwrite,
  showDialog,
} = useSaveConfirmDialog();
const {
  isDialogVisible: isUpdateDialogVisible,
  updateStatus,
  downloadProgress,
  handleIgnore,
  handleUpdate,
  handleMinimize,
  handleRestore,
  handleCancel: handleUpdateCancel,
  showDialog: showUpdateDialog,
} = useUpdateDialog();

let _unlistenClose: (() => void) | null = null;
interceptCloseRequest(async (force) => {
  if (await handleMacMainWindowHide()) return;
  const unsavedTabs = getUnsavedTabs();
  if (unsavedTabs.length === 0) {
    await force();
    return;
  }
  for (const tab of unsavedTabs) {
    await switchToTab(tab.id);
    const result = await showDialog(tab.name);
    if (result === "cancel") return;
    if (result === "save") {
      const saved = await saveCurrentTab();
      if (!saved) return;
    } else {
      await cleanupTabLocalImages(tab);
    }
  }
  await force();
}).then((un) => {
  _unlistenClose = un;
});

const handleTabCloseConfirm = async (payload: any) => {
  const { tabId, tabName } = payload;
  const result = await showDialog(tabName);

  if (result === "save") {
    const saved = await saveCurrentTab();
    if (saved) {
      close(tabId);
    }
  } else if (result === "discard") {
    await cleanupTabLocalImages(tabs.value.find((tab) => tab?.id === tabId));
    close(tabId);
  }
};
emitter.on("tab:close-confirm", handleTabCloseConfirm);

const handleUpdateAvailable = (payload: any) => {
  const info = payload || {};
  localStorage.setItem("updateInfo", JSON.stringify(info));
  const ignoredVersion = localStorage.getItem("ignoredVersion");
  if (ignoredVersion !== info.version) {
    showUpdateDialog();
  }
};

let _unlistenUpdateAvailable: (() => void) | null = null;

const initialSidebarVisible = Boolean(config.value.workspace?.autoExpandSidebar);
setSidebarsVisibility({
  file: initialSidebarVisible,
  outline: initialSidebarVisible,
});

const editorAreaRef = ref<HTMLElement | null>(null);
const fileSidebarWidth = useSidebarWidth("file");
const outlineSidebarWidth = useSidebarWidth("outline");
const resizingSidebar = ref<SidebarPane | null>(null);

const editorAreaStyle = computed(() => ({
  "--file-sidebar-width": `${fileSidebarWidth.value}px`,
  "--outline-sidebar-width": `${outlineSidebarWidth.value}px`,
}));

function getConfigSidebarWidth(side: SidebarPane) {
  if (side === "file") {
    return (
      config.value.workspace?.fileSidebarWidth ??
      config.value.workspace?.sidebarWidth ??
      DEFAULT_SIDEBAR_WIDTH
    );
  }

  return (
    config.value.workspace?.outlineSidebarWidth ??
    config.value.workspace?.sidebarWidth ??
    DEFAULT_SIDEBAR_WIDTH
  );
}

function updateSidebarWidth(side: SidebarPane, nextWidth: number, persist = false) {
  const containerWidth = editorAreaRef.value?.clientWidth;
  const resolvedWidth = setSidebarWidth(side, nextWidth, containerWidth);
  if (!persist) return;

  if (side === "file" && resolvedWidth !== config.value.workspace.fileSidebarWidth) {
    setConf("workspace", {
      ...config.value.workspace,
      fileSidebarWidth: resolvedWidth,
    });
  }

  if (side === "outline" && resolvedWidth !== config.value.workspace.outlineSidebarWidth) {
    setConf("workspace", {
      ...config.value.workspace,
      outlineSidebarWidth: resolvedWidth,
    });
  }
}

function syncSidebarWidthFromConfig(side: SidebarPane, persist = false) {
  updateSidebarWidth(side, getConfigSidebarWidth(side), persist);
}

function handleWindowResize() {
  syncSidebarWidthFromConfig("file");
  syncSidebarWidthFromConfig("outline");
}

async function openWorkspaceIfPossible(path: string | null | undefined): Promise<boolean> {
  if (!path || !shouldAutoLoadWorkspace(path)) return false;

  const exists = await workspaceExists(path).catch(() => false);
  if (!exists) return false;

  return openWorkSpaceByPath(path);
}

async function applyWindowInitState(): Promise<boolean> {
  const initState = await getWindowInitState().catch(() => null);
  if (!initState) return false;

  const fileVisibleFromInit =
    typeof initState.fileSidebarVisible === "boolean"
      ? initState.fileSidebarVisible
      : initState.sidebarVisible === true && initState.sidebarTab !== "outline"
        ? true
        : initState.sidebarVisible === false
          ? false
          : undefined;

  const outlineVisibleFromInit =
    typeof initState.outlineSidebarVisible === "boolean"
      ? initState.outlineSidebarVisible
      : initState.sidebarVisible === true && initState.sidebarTab === "outline"
        ? true
        : initState.sidebarVisible === false
          ? false
          : undefined;

  setSidebarsVisibility({
    file: fileVisibleFromInit,
    outline: outlineVisibleFromInit,
  });

  if (initState.workspacePath) {
    await openWorkSpaceByPath(initState.workspacePath);
  }

  return true;
}

async function restoreStartupState() {
  const mode = config.value.workspace?.startupMode ?? "new-file";

  if (mode === "custom-workspace") {
    await openWorkspaceIfPossible(config.value.workspace?.startupPath);
    return;
  }

  if (mode === "new-file") {
    return;
  }

  const lastSession = getLastSessionSnapshot();
  if (!lastSession) return;

  if (mode === "last-workspace") {
    await openWorkspaceIfPossible(lastSession.workspacePath);
    return;
  }

  await openWorkspaceIfPossible(lastSession.workspacePath);

  for (const savedFilePath of lastSession.openFilePaths) {
    await openFile(savedFilePath);
  }

  if (lastSession.activeFilePath) {
    const existing = isFileAlreadyOpen(lastSession.activeFilePath);
    if (existing) {
      await switchToTab(existing.id);
    }
  }
}

function cleanupSidebarResize() {
  window.removeEventListener("pointermove", handleSidebarResizeMove);
  window.removeEventListener("pointerup", handleSidebarResizeEnd);
  window.removeEventListener("pointercancel", handleSidebarResizeEnd);
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}

function handleSidebarResizeMove(event: PointerEvent) {
  if (!resizingSidebar.value || !editorAreaRef.value) return;

  const rect = editorAreaRef.value.getBoundingClientRect();
  if (resizingSidebar.value === "file") {
    updateSidebarWidth("file", event.clientX - rect.left);
    return;
  }

  updateSidebarWidth("outline", rect.right - event.clientX);
}

function handleSidebarResizeEnd() {
  if (!resizingSidebar.value) return;
  updateSidebarWidth(
    resizingSidebar.value,
    resizingSidebar.value === "file" ? fileSidebarWidth.value : outlineSidebarWidth.value,
    true
  );
  resizingSidebar.value = null;
  cleanupSidebarResize();
}

function handleSidebarResizeStart(side: SidebarPane, event: PointerEvent) {
  event.preventDefault();
  resizingSidebar.value = side;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", handleSidebarResizeMove);
  window.addEventListener("pointerup", handleSidebarResizeEnd);
  window.addEventListener("pointercancel", handleSidebarResizeEnd);
}

watch(
  () => config.value.workspace?.fileSidebarWidth,
  () => {
    if (resizingSidebar.value === "file") return;
    syncSidebarWidthFromConfig("file");
  },
  { immediate: true }
);

watch(
  () => config.value.workspace?.outlineSidebarWidth,
  () => {
    if (resizingSidebar.value === "outline") return;
    syncSidebarWidthFromConfig("outline");
  },
  { immediate: true }
);

onMounted(async () => {
  syncSidebarWidthFromConfig("file");
  syncSidebarWidthFromConfig("outline");
  initTheme();
  initFont();
  initOtherConfig();
  initSpellCheck();

  const handledWindowInitState = await applyWindowInitState();
  if (currentWindowLabel() === "main" && !handledWindowInitState) {
    await new Promise((resolve) => window.setTimeout(resolve, 80));
    const hasRealFileTab = tabs.value.some((tab) => Boolean(tab?.filePath));
    if (!hasRealFileTab) {
      await restoreStartupState();
    }
  }

  apiOnUpdateAvailable(handleUpdateAvailable)
    .then((unlisten) => {
      _unlistenUpdateAvailable = unlisten;
    })
    .catch((error) => {
      console.error("[EditorView] Subscribe update:available failed:", error);
    });
  window.addEventListener("resize", handleWindowResize);
});

onUnmounted(() => {
  cleanupSidebarResize();
  emitter.off("tab:close-confirm", handleTabCloseConfirm);
  _unlistenClose?.();
  _unlistenUpdateAvailable?.();
  window.removeEventListener("resize", handleWindowResize);
});

async function handleSafeClose(action: "close" | "update") {
  const unsavedTabs = getUnsavedTabs();
  if (unsavedTabs.length === 0) {
    if (action === "update") {
      try {
        await quitAndInstall();
      } catch (error) {
        console.error("[EditorView] quitAndInstall failed:", error);
        autotoast.show(error instanceof Error ? error.message : "启动安装失败", "error");
      }
    } else {
      await apiCloseDiscard();
    }
    return;
  }

  for (const tab of unsavedTabs) {
    await switchToTab(tab.id);
    const result = await showDialog(tab.name);

    if (result === "cancel") return;

    if (result === "save") {
      const saved = await saveCurrentTab();
      if (!saved) return;
    } else {
      await cleanupTabLocalImages(tab);
    }
  }

  if (action === "update") {
    try {
      await quitAndInstall();
    } catch (error) {
      console.error("[EditorView] quitAndInstall failed:", error);
      autotoast.show(error instanceof Error ? error.message : "启动安装失败", "error");
    }
  } else {
    await apiCloseDiscard();
  }
}

const handleInstall = async () => {
  await handleSafeClose("update");
};
</script>

<template>
  <TitleBar />
  <div id="fontRoot">
    <div ref="editorAreaRef" class="editorArea" :style="editorAreaStyle">
      <div
        class="sidebarSlot left"
        :class="{ visible: isFileSidebarVisible }"
        :style="{ width: isFileSidebarVisible ? `var(--file-sidebar-width)` : '0px' }"
      >
        <div class="sidebarPanel sidebarPanel-file">
          <WorkSpace />
        </div>
      </div>

      <div
        v-if="isFileSidebarVisible"
        class="sidebarResizeHandle left"
        :class="{ active: resizingSidebar === 'file' }"
        @pointerdown="handleSidebarResizeStart('file', $event)"
      >
        <div class="sidebarResizeLine"></div>
      </div>

      <div class="editorBox">
        <PureMarkEditor
          v-if="currentTab"
          :key="currentTab.id"
          :tab="currentTab"
          :is-active="true"
        />
      </div>

      <div
        v-if="isOutlineSidebarVisible"
        class="sidebarResizeHandle right"
        :class="{ active: resizingSidebar === 'outline' }"
        @pointerdown="handleSidebarResizeStart('outline', $event)"
      >
        <div class="sidebarResizeLine"></div>
      </div>

      <div
        class="sidebarSlot right"
        :class="{ visible: isOutlineSidebarVisible }"
        :style="{ width: isOutlineSidebarVisible ? `var(--outline-sidebar-width)` : '0px' }"
      >
        <div class="sidebarPanel sidebarPanel-outline">
          <Outline />
        </div>
      </div>
    </div>
  </div>
  <StatusBar
    :content="currentTab?.content ?? ''"
    :update-status="updateStatus"
    :download-progress="downloadProgress"
    :is-update-dialog-visible="isUpdateDialogVisible"
    @restore-update="handleRestore"
  />
  <SaveConfirmDialog
    :visible="isDialogVisible"
    :type="dialogType"
    :tab-name="tabName"
    :file-name="fileName"
    @save="handleSave"
    @discard="handleDiscard"
    @cancel="handleCancel"
    @overwrite="handleOverwrite"
  />
  <UpdateConfirmDialog
    :visible="isUpdateDialogVisible"
    :status="updateStatus"
    :progress="downloadProgress"
    @get="handleUpdate"
    @install="handleInstall"
    @ignore="handleIgnore"
    @cancel="handleUpdateCancel"
    @minimize="handleMinimize"
  />
</template>

<style scoped lang="less">
#fontRoot {
  height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.editorArea {
  --file-sidebar-width: 280px;
  --outline-sidebar-width: 280px;
  height: 0;
  flex: 1;
  display: flex;
  overflow: hidden;
  min-width: 0;

  .sidebarSlot {
    height: 100%;
    flex-shrink: 0;
    overflow: hidden;
    opacity: 0;
    transition:
      width 0.2s ease,
      opacity 0.2s ease;
    pointer-events: none;

    &.visible {
      opacity: 1;
      pointer-events: auto;
    }

    &.left {
      border-right: 1px solid var(--border-color-1);
    }

    &.right {
      border-left: 1px solid var(--border-color-1);
    }
  }

  .sidebarPanel {
    width: 100%;
    height: 100%;
    background: var(--background-color-2);
  }

  .editorBox {
    flex: 1;
    min-width: 0;
    height: 100%;
    position: relative;
  }

  .sidebarResizeHandle {
    width: 12px;
    height: 100%;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: col-resize;
    -webkit-app-region: no-drag;
    touch-action: none;

    .sidebarResizeLine {
      width: 2px;
      height: 100%;
      background: color-mix(in srgb, var(--text-color-3) 35%, transparent);
      transition:
        background 0.2s ease,
        width 0.2s ease;
    }

    &:hover,
    &.active {
      .sidebarResizeLine {
        width: 3px;
        background: color-mix(in srgb, var(--active-color) 80%, white 20%);
      }
    }
  }
}
</style>
