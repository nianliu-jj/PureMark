<script setup lang="ts">
import type { RecentOpenItem, StartupMode } from "@/services/launchState";
import type { ImageExportFormat } from "@/shared/types/export";
import autotoast from "autotoast.js";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import AppIcon from "@/components/ui/AppIcon.vue";
import useContent from "@/hooks/useContent";
import { useConfig } from "@/hooks/useConfig";
import useFile from "@/hooks/useFile";
import useTab from "@/hooks/useTab";
import useWorkSpace from "@/hooks/useWorkSpace";
import { showOpenDialog, workspaceExists } from "@/services/api";
import {
  clearRecentOpenItems,
  getLastSessionSnapshot,
  getRecentOpenItems,
  onLaunchStateChange,
  removeRecentOpenItem,
} from "@/services/launchState";
import {
  exportAsText,
  exportElementAsImage,
  exportElementAsPDF,
  exportElementWithStylesAndImages,
  exportMarkdownAsWord,
  getActiveEditorElement,
  getActiveEditorSelector,
} from "@/utils/exports";
import { isAbsoluteLocalPath } from "@/utils/workspacePath";

const { onOpen, onSave, onSaveAs, currentTab } = useFile();
const { openFile } = useTab();
const { setWorkSpace, openWorkSpaceByPath } = useWorkSpace();
const { isModified, markdown } = useContent();
const { config, setConf } = useConfig();

const recentItems = ref<RecentOpenItem[]>([]);
const lastSession = ref(getLastSessionSnapshot());
const isStartupPathExists = ref(true);

const startupMode = computed<StartupMode>(() => config.value.workspace?.startupMode ?? "new-file");
const startupPath = computed(() => config.value.workspace?.startupPath ?? "");

const startupOptions: Array<{
  value: StartupMode;
  title: string;
  desc: string;
  icon: string;
}> = [
  {
    value: "new-file",
    title: "打开新文件",
    desc: "启动后保留空白标签页，不恢复目录和文件",
    icon: "document-copy",
  },
  {
    value: "last-workspace",
    title: "重新打开上次打开的目录",
    desc: "仅恢复上次工作区目录结构，不自动恢复文件标签页",
    icon: "folder-opened",
  },
  {
    value: "last-session",
    title: "重新打开上次的目录和文件",
    desc: "恢复上次工作区以及当时打开的文件标签页",
    icon: "refresh",
  },
  {
    value: "custom-workspace",
    title: "打开指定目录",
    desc: "每次启动时固定打开你指定的目录",
    icon: "folder-opened",
  },
];

const imageFormatOptions: Array<{ value: ImageExportFormat; label: string }> = [
  { value: "png", label: "PNG" },
  { value: "jpg", label: "JPG" },
  { value: "webp", label: "WebP" },
];

const imageFormat = computed<ImageExportFormat>(() => config.value.export?.imageFormat ?? "png");

function setImageFormat(format: ImageExportFormat) {
  config.value = {
    ...config.value,
    export: { ...config.value.export, imageFormat: format },
  };
}

function formatRecentTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp)) {
    return "时间未知";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function refreshLaunchState() {
  recentItems.value = getRecentOpenItems();
  lastSession.value = getLastSessionSnapshot();
}

function closeMenuPanel() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
}

function getExportBaseName() {
  return currentTab.value?.name?.slice(0, -3) || "导出的文件";
}

function getStartupMeta(mode: StartupMode): string {
  if (mode === "custom-workspace") {
    return startupPath.value || "未选择目录";
  }

  if (mode === "last-workspace") {
    return lastSession.value?.workspacePath || "暂无最近目录记录";
  }

  if (mode === "last-session") {
    const workspace = lastSession.value?.workspacePath || "暂无最近目录记录";
    const fileCount = lastSession.value?.openFilePaths.length ?? 0;
    return `${workspace} · ${fileCount} 个文件`;
  }

  return "启动后保持当前默认空白状态";
}

async function checkStartupPath() {
  if (startupMode.value !== "custom-workspace" || !startupPath.value) {
    isStartupPathExists.value = true;
    return;
  }

  isStartupPathExists.value = await workspaceExists(startupPath.value);
}

async function selectStartupDirectory() {
  const defaultPath = isAbsoluteLocalPath(startupPath.value) ? startupPath.value : undefined;
  const result = await showOpenDialog({
    directory: true,
    title: "选择启动时打开的目录",
    defaultPath,
  });

  if (!result || result.canceled || result.filePaths.length === 0) return;

  setConf("workspace", {
    ...config.value.workspace,
    startupMode: "custom-workspace",
    startupPath: result.filePaths[0],
  });
}

function clearStartupDirectory() {
  setConf("workspace", {
    ...config.value.workspace,
    startupPath: "",
  });
}

function handleStartupModeChange(mode: StartupMode) {
  setConf("workspace", {
    ...config.value.workspace,
    startupMode: mode,
  });
}

function onOpenFolder() {
  setWorkSpace()
    .then(() => {
      closeMenuPanel();
    })
    .catch(() => {
      autotoast.show("取消选择");
    });
}

async function openRecentItem(item: RecentOpenItem) {
  if (item.type === "directory") {
    const opened = await openWorkSpaceByPath(item.path);
    if (!opened) {
      removeRecentOpenItem(item.path, item.type);
      refreshLaunchState();
      autotoast.show("目录不存在或无法打开", "error");
      return;
    }

    closeMenuPanel();
    return;
  }

  let workspaceOpened = true;
  if (item.parentPath) {
    workspaceOpened = await openWorkSpaceByPath(item.parentPath);
  }

  const tab = await openFile(item.path);
  if (!tab) {
    removeRecentOpenItem(item.path, item.type);
    refreshLaunchState();
    autotoast.show("文件不存在或无法打开", "error");
    return;
  }

  if (!workspaceOpened && item.parentPath) {
    autotoast.show("文件已打开，但同级目录加载失败", "warn");
  }

  closeMenuPanel();
}

function handleClearRecent() {
  clearRecentOpenItems();
  refreshLaunchState();
}

function handleRemoveRecent(item: RecentOpenItem, event: MouseEvent) {
  event.stopPropagation();
  removeRecentOpenItem(item.path, item.type);
  refreshLaunchState();
}

function exportAsPDF() {
  exportElementAsPDF(getActiveEditorSelector(), `${getExportBaseName()}.pdf`, {
    pageSize: "A4",
    scale: 1,
  })
    .then(() => {
      autotoast.show("导出成功", "success");
    })
    .catch((err) => {
      autotoast.show(`导出失败: ${err.message}`, "error");
    });
}

function exportAsHTML() {
  exportElementWithStylesAndImages(getActiveEditorElement(), `${getExportBaseName()}.html`);
}

function exportAsDocx() {
  exportMarkdownAsWord(markdown.value, `${getExportBaseName()}.docx`)
    .then(() => {
      autotoast.show("导出成功", "success");
    })
    .catch((err) => {
      autotoast.show(`导出失败: ${err.message}`, "error");
    });
}

function exportAsTxt() {
  exportAsText(markdown.value, `${getExportBaseName()}.txt`);
}

function exportAsImage() {
  exportElementAsImage(getActiveEditorSelector(), getExportBaseName(), {
    format: imageFormat.value,
  })
    .then(() => {
      autotoast.show("导出成功", "success");
    })
    .catch((err) => {
      autotoast.show(`导出失败: ${err.message}`, "error");
    });
}

let stopListenLaunchState: (() => void) | null = null;

watch([startupMode, startupPath], () => {
  void checkStartupPath();
});

onMounted(() => {
  refreshLaunchState();
  void checkStartupPath();
  stopListenLaunchState = onLaunchStateChange(() => {
    refreshLaunchState();
  });
});

onUnmounted(() => {
  stopListenLaunchState?.();
});
</script>

<template>
  <div class="FileOptionsBox">
    <div class="optionItem">
      <div class="title-row">
        <span class="title-badge">
          <AppIcon name="document" />
        </span>
        <div class="title-group">
          <h2 class="title">文件</h2>
          <span class="desc">常用的打开、保存、另存为与目录操作</span>
        </div>
      </div>
      <div class="buttons">
        <button @click="() => onOpen()">
          <AppIcon name="document" />
          <span>打开</span>
        </button>
        <button @click="onOpenFolder">
          <AppIcon name="folder-opened" />
          <span>打开文件夹</span>
        </button>
        <button @click="onSave">
          <AppIcon v-if="!isModified" name="circle-check" />
          <AppIcon v-else name="warning-outline" />
          <span>{{ isModified ? "保存" : "已保存" }}</span>
        </button>
        <button @click="onSaveAs">
          <AppIcon name="document-copy" />
          <span>另存为</span>
        </button>
      </div>
    </div>

    <div class="optionItem">
      <div class="title-row">
        <span class="title-badge startup-badge">
          <AppIcon name="refresh" />
        </span>
        <div class="title-group">
          <h2 class="title">启动选项</h2>
          <span class="desc">控制应用下次启动时恢复什么内容，替代原“启动工作区”设置</span>
        </div>
      </div>
      <div class="startup-options">
        <div
          v-for="option in startupOptions"
          :key="option.value"
          class="startup-card"
          :class="{ active: startupMode === option.value }"
          @click="handleStartupModeChange(option.value)"
        >
          <div class="startup-head">
            <div class="startup-radio" :class="{ active: startupMode === option.value }"></div>
            <AppIcon :name="option.icon" class="startup-icon" />
            <div class="startup-copy">
              <div class="startup-title">{{ option.title }}</div>
              <div class="startup-desc">{{ option.desc }}</div>
            </div>
          </div>
          <div class="startup-meta">{{ getStartupMeta(option.value) }}</div>

          <div v-if="option.value === 'custom-workspace'" class="startup-actions" @click.stop>
            <button class="subtle-btn" @click="selectStartupDirectory">选择目录</button>
            <button v-if="startupPath" class="subtle-btn" @click="clearStartupDirectory">
              清除
            </button>
          </div>
          <div
            v-if="
              option.value === 'custom-workspace' &&
              startupMode === 'custom-workspace' &&
              startupPath &&
              !isStartupPathExists
            "
            class="startup-error"
          >
            当前目录不存在
          </div>
        </div>
      </div>
    </div>

    <div class="optionItem">
      <div class="title-row">
        <span class="title-badge recent-badge">
          <AppIcon name="folder-opened" />
        </span>
        <div class="title-group">
          <h2 class="title">打开最近文件</h2>
          <span class="desc">可直接打开最近访问过的文件或目录。文件会自动加载同级目录。</span>
        </div>
      </div>
      <div class="recent-panel">
        <div v-if="recentItems.length > 0" class="recent-list">
          <div
            v-for="item in recentItems"
            :key="`${item.type}:${item.path}`"
            class="recent-item"
            role="button"
            tabindex="0"
            @click="openRecentItem(item)"
            @keydown.enter="openRecentItem(item)"
          >
            <div class="recent-icon">
              <AppIcon :name="item.type === 'directory' ? 'folder-opened' : 'document'" />
            </div>
            <div class="recent-copy">
              <div class="recent-head">
                <div class="recent-main">
                  <div class="recent-name">
                    {{ item.name }}
                    <span class="recent-type">{{
                      item.type === "directory" ? "目录" : "文件"
                    }}</span>
                  </div>
                  <div class="recent-path">{{ item.path }}</div>
                </div>
                <div class="recent-side">
                  <span class="recent-time">{{ formatRecentTimestamp(item.timestamp) }}</span>
                  <button
                    class="recent-remove"
                    title="删除此记录"
                    @click="handleRemoveRecent(item, $event)"
                  >
                    <AppIcon name="close" />
                  </button>
                </div>
              </div>
            </div>
          </div>
          <button class="clear-btn" @click="handleClearRecent">清空最近记录</button>
        </div>
        <div v-else class="empty-recent">
          <AppIcon name="document" class="empty-icon" />
          <span>暂无最近打开记录</span>
        </div>
      </div>
    </div>

    <div class="optionItem export">
      <div class="title-row">
        <span class="title-badge export-badge">
          <AppIcon name="export-file" />
        </span>
        <div class="title-group">
          <h2 class="title">导出为</h2>
          <span class="desc">将当前内容导出为不同格式文件</span>
        </div>
      </div>
      <div class="buttons">
        <button @click="exportAsPDF">
          <AppIcon name="pdf" />
          <span>PDF</span>
        </button>
        <button @click="exportAsHTML">
          <AppIcon name="html" />
          <span>HTML</span>
        </button>
        <button @click="exportAsDocx">
          <AppIcon name="word-file" />
          <span>Word</span>
        </button>
        <button @click="exportAsTxt">
          <AppIcon name="document" />
          <span>TXT</span>
        </button>
        <button @click="exportAsImage">
          <AppIcon name="image" />
          <span>长图</span>
        </button>
      </div>
      <div class="image-format-row">
        <label class="image-format-label">图片格式</label>
        <div class="mode-select">
          <span
            v-for="opt in imageFormatOptions"
            :key="opt.value"
            class="mode-option"
            :class="{ active: imageFormat === opt.value }"
            @click="setImageFormat(opt.value)"
          >
            {{ opt.label }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.FileOptionsBox {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 40px;
  padding: 0 10px 200px;
  box-sizing: border-box;
  user-select: none;
  max-width: 860px;

  .optionItem {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    padding: 0;

    .title-row {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      margin-bottom: 18px;
    }

    .title-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--primary-color) 14%, transparent);
      color: var(--primary-color);
      font-size: 18px;

      &.startup-badge {
        background: color-mix(in srgb, #f59e0b 14%, transparent);
        color: #f59e0b;
      }

      &.recent-badge {
        background: color-mix(in srgb, #0ea5e9 14%, transparent);
        color: #0ea5e9;
      }

      &.export-badge {
        background: color-mix(in srgb, #10b981 14%, transparent);
        color: #10b981;
      }
    }

    .title-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .title {
      font-size: 18px;
      font-weight: 700;
      color: var(--text-color);
      margin: 0;
    }

    .desc {
      font-size: 13px;
      line-height: 1.5;
      color: var(--text-color-2);
    }

    .buttons {
      display: flex;
      align-items: flex-start;
      flex-direction: column;
      gap: 14px;
      padding-left: 50px;
    }

    &.export {
      .buttons {
        button {
          justify-content: flex-start;
          width: max-content;
        }
      }

      .image-format-row {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-top: 16px;
        padding-left: 50px;

        .image-format-label {
          font-size: 14px;
          font-weight: 500;
          color: var(--text-color-3);
        }

        .mode-select {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;

          .mode-option {
            padding: 6px 16px;
            border-radius: 6px;
            font-size: 13px;
            cursor: pointer;
            border: 1px solid var(--border-color-1);
            color: var(--text-color-3);
            transition: all 0.2s ease;

            &:hover {
              border-color: var(--border-color-2);
              background: var(--background-color-3);
            }

            &.active {
              background: var(--primary-color, #4a9eff);
              color: #fff;
              border-color: var(--primary-color, #4a9eff);
            }
          }
        }
      }
    }
  }

  .startup-options {
    width: 100%;
    padding-left: 50px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }

  .startup-card {
    width: 100%;
    border: 1px solid var(--border-color-1);
    border-radius: 12px;
    background: var(--background-color-1);
    padding: 14px;
    cursor: pointer;
    transition:
      border-color 0.2s ease,
      transform 0.2s ease,
      box-shadow 0.2s ease;

    &:hover {
      border-color: var(--border-color-2);
      transform: translateY(-1px);
    }

    &.active {
      border-color: color-mix(in srgb, var(--primary-color) 65%, transparent);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
    }
  }

  .startup-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .startup-radio {
    width: 14px;
    height: 14px;
    border-radius: 999px;
    border: 1px solid var(--border-color-2);
    margin-top: 4px;
    flex-shrink: 0;
    position: relative;

    &.active::after {
      content: "";
      position: absolute;
      inset: 3px;
      border-radius: 999px;
      background: var(--primary-color);
    }
  }

  .startup-icon {
    font-size: 18px;
    color: var(--text-color-2);
    margin-top: 1px;
  }

  .startup-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .startup-title {
    color: var(--text-color-1);
    font-size: 14px;
    font-weight: 600;
  }

  .startup-desc {
    color: var(--text-color-2);
    font-size: 12px;
    line-height: 1.5;
  }

  .startup-meta {
    margin-top: 10px;
    padding-left: 24px;
    color: var(--text-color-3);
    font-size: 12px;
    line-height: 1.5;
    word-break: break-all;
  }

  .startup-actions {
    display: flex;
    gap: 10px;
    padding-left: 24px;
    margin-top: 12px;
  }

  .subtle-btn,
  .clear-btn {
    height: 34px;
    padding: 0 12px;
    border-radius: 8px;
    border: 1px solid var(--border-color-1);
    background: var(--background-color-2);
    color: var(--text-color-1);
    cursor: pointer;
    transition: all 0.2s ease;

    &:hover {
      border-color: var(--border-color-2);
      background: var(--hover-background-color);
    }
  }

  .startup-error {
    padding-left: 24px;
    margin-top: 10px;
    color: #d35b5b;
    font-size: 12px;
  }

  .recent-panel {
    width: 100%;
    padding-left: 50px;
  }

  .recent-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .recent-item {
    width: 100%;
    border: 1px solid var(--border-color-1);
    border-radius: 12px;
    background: var(--background-color-1);
    color: inherit;
    padding: 12px 14px;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    cursor: pointer;
    text-align: left;
    transition:
      border-color 0.2s ease,
      background 0.2s ease;

    &:hover {
      border-color: var(--border-color-2);
      background: var(--hover-background-color);
    }
  }

  .recent-icon {
    width: 30px;
    height: 30px;
    border-radius: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--primary-color) 10%, transparent);
    color: var(--primary-color);
    flex-shrink: 0;
  }

  .recent-copy {
    min-width: 0;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .recent-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
  }

  .recent-main {
    min-width: 0;
    flex: 1;
    text-align: left;
  }

  .recent-name {
    color: var(--text-color-1);
    font-size: 14px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .recent-side {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex-shrink: 0;
    margin-left: auto;
  }

  .recent-type {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 36px;
    height: 20px;
    padding: 0 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--primary-color) 10%, transparent);
    color: var(--primary-color);
    font-size: 11px;
    font-weight: 500;
  }

  .recent-time {
    flex-shrink: 0;
    color: var(--text-color-3);
    font-size: 12px;
    line-height: 1.5;
    text-align: right;
  }

  .recent-remove {
    width: 24px;
    height: 24px;
    padding: 0;
    border-radius: 5px;
    color: var(--text-color-3);

    &:hover {
      color: #e53e3e;
      background: rgba(229, 62, 62, 0.1);
    }

    svg {
      margin-right: 0;
      font-size: 13px;
    }
  }

  .recent-path {
    color: var(--text-color-3);
    font-size: 12px;
    line-height: 1.5;
    word-break: break-all;
  }

  .empty-recent {
    min-height: 120px;
    border: 1px dashed var(--border-color-1);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--text-color-3);
    font-size: 13px;

    .empty-icon {
      font-size: 28px;
      opacity: 0.6;
    }
  }

  button {
    padding: 5px 10px;
    border: none;
    cursor: pointer;
    font-size: 16px;
    background: none;
    border-radius: 4px;
    transition: background-color 0.3s;
    color: var(--text-color);
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover {
      background-color: var(--border-color-1);
      border-color: var(--border-color-2);
    }

    svg {
      font-size: 18px;
      vertical-align: middle;
      margin-right: 5px;
    }
  }
}

@media (max-width: 900px) {
  .FileOptionsBox {
    .startup-options {
      grid-template-columns: 1fr;
    }
  }
}

@media (max-width: 768px) {
  .FileOptionsBox {
    padding: 0 10px 160px;

    .optionItem {
      .buttons,
      .startup-options,
      .recent-panel {
        padding-left: 0;
      }
    }

    .recent-head {
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
    }

    .recent-side {
      width: 100%;
      justify-content: space-between;
    }
  }
}
</style>
