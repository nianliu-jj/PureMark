<script setup lang="ts">
import autotoast from "autotoast.js";
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import AppIcon from "@/components/ui/AppIcon.vue";
import emitter from "@/events";
import useContent from "@/hooks/useContent";
import { useConfig } from "@/hooks/useConfig";
import useFile from "@/hooks/useFile";
import useTab from "@/hooks/useTab";
import useWorkSpace from "@/hooks/useWorkSpace";
import {
  createEditorWindow,
  moveFileToDirectory,
  revealFileInFolder,
  showOpenDialog,
} from "@/services/api";
import {
  exportElementAsImage,
  exportElementAsPDF,
  exportElementWithStylesAndImages,
  exportMarkdownAsWord,
  getActiveEditorElement,
  getActiveEditorSelector,
} from "@/utils/exports";
import MenuBar from "./MenuBar.vue";

type MenuLeaf =
  | {
      type: "item";
      label: string;
      icon: MenuIconName;
      shortcut?: string;
      disabled?: () => boolean;
      action: () => void | Promise<void>;
    }
  | { type: "separator" };

type MenuItem =
  | MenuLeaf
  | {
      type: "submenu";
      label: string;
      icon: MenuIconName;
      children: MenuLeaf[];
    };

type MenuIconName =
  | "config-props"
  | "document"
  | "document-copy"
  | "download"
  | "export-file"
  | "folder-copy"
  | "folder-opened"
  | "html"
  | "image"
  | "input"
  | "link"
  | "pdf"
  | "plus"
  | "word-file";

const { createNewFile, onOpen, onSave, onSaveAs, currentTab } = useFile();
const { updateCurrentTabFile } = useTab();
const { setWorkSpace, refreshWorkSpace } = useWorkSpace();
const { markdown, filePath } = useContent();
const { config } = useConfig();

const isMenuOpen = ref(false);
const isPreferencesOpen = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const menuPosition = ref({ top: 40, left: 8 });
const activeSubmenuIndex = ref<number | null>(null);
const submenuPosition = ref({ top: 0, left: 0 });
const SUBMENU_WIDTH = 200;
let submenuCloseTimer: number | null = null;
const logoSvg = `${import.meta.env.BASE_URL}logo.svg`;
const COMMAND_MENU_WIDTH = 280;
const VIEWPORT_PADDING = 8;

function closeAll() {
  isMenuOpen.value = false;
  isPreferencesOpen.value = false;
  cancelCloseSubmenu();
  activeSubmenuIndex.value = null;
}

function closeMenu() {
  isMenuOpen.value = false;
  cancelCloseSubmenu();
  activeSubmenuIndex.value = null;
}

function closePreferences() {
  isPreferencesOpen.value = false;
}

function updateMenuPosition() {
  const trigger = triggerRef.value;
  if (!trigger) return;

  const rect = trigger.getBoundingClientRect();
  const maxLeft = Math.max(
    VIEWPORT_PADDING,
    window.innerWidth - COMMAND_MENU_WIDTH - VIEWPORT_PADDING
  );
  menuPosition.value = {
    top: rect.bottom + 6,
    left: Math.min(Math.max(VIEWPORT_PADDING, rect.right - COMMAND_MENU_WIDTH), maxLeft),
  };
}

function cancelCloseSubmenu() {
  if (submenuCloseTimer !== null) {
    window.clearTimeout(submenuCloseTimer);
    submenuCloseTimer = null;
  }
}

function scheduleCloseSubmenu() {
  cancelCloseSubmenu();
  submenuCloseTimer = window.setTimeout(() => {
    activeSubmenuIndex.value = null;
    submenuCloseTimer = null;
  }, 150);
}

function openSubmenu(index: number, event: MouseEvent) {
  cancelCloseSubmenu();
  activeSubmenuIndex.value = index;
  const trigger = event.currentTarget as HTMLElement;
  const rect = trigger.getBoundingClientRect();
  // .command-submenu 为 position:fixed，但其包含块是带 transform 的父级 .command-menu，
  // 因此用相对该包含块（trigger.offsetParent === .command-menu）的 offset 坐标，
  // 而非视口坐标，否则子菜单会整体偏移 .command-menu 的位置。
  // 用视口剩余空间判断左右翻转：右侧空间不足则改向左侧弹出。
  const spaceRight = window.innerWidth - rect.right;
  const flipLeft = spaceRight < SUBMENU_WIDTH + VIEWPORT_PADDING;
  const left = flipLeft
    ? trigger.offsetLeft - SUBMENU_WIDTH + 2
    : trigger.offsetLeft + trigger.offsetWidth - 2;
  submenuPosition.value = { top: trigger.offsetTop, left };
}

function closeSubmenuImmediately() {
  cancelCloseSubmenu();
  activeSubmenuIndex.value = null;
}

async function toggleMenu() {
  if (isPreferencesOpen.value) return;

  isMenuOpen.value = !isMenuOpen.value;
  if (isMenuOpen.value) {
    isPreferencesOpen.value = false;
    await nextTick();
    updateMenuPosition();
  } else {
    closeSubmenuImmediately();
  }
}

function openPreferences() {
  isMenuOpen.value = false;
  isPreferencesOpen.value = true;
}

function getExportBaseName() {
  return currentTab.value?.name?.replace(/\.(md|markdown)$/i, "") || "导出的文件";
}

async function runAction(action: () => void | Promise<void>) {
  try {
    await action();
    closeMenu();
  } catch (error) {
    console.error("[MenuDropDown] menu action failed:", error);
    autotoast.show(error instanceof Error ? error.message : "操作失败", "error");
  }
}

async function createNewWindow() {
  await createEditorWindow({ fastCreate: true });
}

async function openFolder() {
  await setWorkSpace();
}

async function moveCurrentFile() {
  if (!currentTab.value?.filePath) {
    autotoast.show("请先保存当前文件后再移动", "warn");
    const savedAs = await onSaveAs();
    if (!savedAs || !currentTab.value?.filePath) return;
  }

  const saved = await onSave();
  if (!saved) return;
  const tab = currentTab.value;
  if (!tab?.filePath) return;

  const result = await showOpenDialog({
    directory: true,
    title: "选择移动到的文件夹",
  });
  if (result.canceled || result.filePaths.length === 0) return;

  const nextPath = await moveFileToDirectory(tab.filePath, result.filePaths[0]);
  updateCurrentTabFile(nextPath, tab.content);
  filePath.value = nextPath;
  await refreshWorkSpace();
  autotoast.show("文件已移动", "success");
}

async function revealCurrentFile() {
  const currentPath = currentTab.value?.filePath;
  if (!currentPath) {
    autotoast.show("当前文件还没有保存位置", "warn");
    return;
  }
  await revealFileInFolder(currentPath);
}

function exportAsHTML() {
  exportElementWithStylesAndImages(getActiveEditorElement(), `${getExportBaseName()}.html`);
}

async function exportAsPDF() {
  await exportElementAsPDF(getActiveEditorSelector(), `${getExportBaseName()}.pdf`, {
    pageSize: "A4",
    scale: 1,
  });
  autotoast.show("导出成功", "success");
}

async function exportAsWord() {
  await exportMarkdownAsWord(markdown.value, `${getExportBaseName()}.docx`);
  autotoast.show("导出成功", "success");
}

async function exportAsImage() {
  const format = config.value.export?.imageFormat ?? "png";
  await exportElementAsImage(getActiveEditorSelector(), getExportBaseName(), { format });
  autotoast.show("导出成功", "success");
}

function printCurrentFile() {
  window.print();
}

const menuItems: MenuItem[] = [
  { type: "item", label: "新建", icon: "document-copy", shortcut: "Ctrl+N", action: createNewFile },
  {
    type: "item",
    label: "新建窗口",
    icon: "plus",
    shortcut: "Ctrl+Shift+N",
    action: createNewWindow,
  },
  { type: "separator" },
  { type: "item", label: "打开", icon: "document", shortcut: "Ctrl+O", action: () => onOpen() },
  {
    type: "item",
    label: "打开文件夹",
    icon: "folder-opened",
    shortcut: "Ctrl+Shift+O",
    action: openFolder,
  },
  { type: "separator" },
  { type: "item", label: "保存", icon: "download", shortcut: "Ctrl+S", action: () => onSave() },
  {
    type: "item",
    label: "另存为",
    icon: "export-file",
    shortcut: "Ctrl+Shift+S",
    action: () => onSaveAs(),
  },
  { type: "item", label: "移动到", icon: "folder-copy", action: moveCurrentFile },
  { type: "item", label: "打开文件位置", icon: "link", action: revealCurrentFile },
  { type: "separator" },
  { type: "item", label: "导入", icon: "input", action: () => onOpen() },
  {
    type: "submenu",
    label: "导出",
    icon: "export-file",
    children: [
      { type: "item", label: "导出 HTML", icon: "html", action: exportAsHTML },
      { type: "item", label: "导出 PDF", icon: "pdf", action: exportAsPDF },
      { type: "item", label: "导出 Word", icon: "word-file", action: exportAsWord },
      { type: "item", label: "导出为图片", icon: "image", action: exportAsImage },
    ],
  },
  { type: "separator" },
  { type: "item", label: "打印", icon: "document", shortcut: "Ctrl+P", action: printCurrentFile },
  { type: "separator" },
  {
    type: "item",
    label: "首选项",
    icon: "config-props",
    shortcut: "Ctrl+,",
    action: openPreferences,
  },
];

const submenuChildren = computed<MenuLeaf[]>(() => {
  if (activeSubmenuIndex.value === null) return [];
  const item = menuItems[activeSubmenuIndex.value];
  return item && item.type === "submenu" ? item.children : [];
});

function handleFileChange() {
  closeMenu();
}

function handleDocumentPointerDown(event: PointerEvent) {
  const root = rootRef.value;
  if (!root || root.contains(event.target as Node)) return;
  if (isPreferencesOpen.value) {
    closeMenu();
    return;
  }
  closeAll();
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    closeMenu();
    return;
  }

  if (!(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();

  if (key === "n" && event.shiftKey) {
    event.preventDefault();
    void createNewWindow();
  } else if (key === "n") {
    event.preventDefault();
    createNewFile();
  } else if (key === "o" && event.shiftKey) {
    event.preventDefault();
    void openFolder();
  } else if (key === "s" && event.shiftKey) {
    event.preventDefault();
    void onSaveAs();
  } else if (key === "p") {
    event.preventDefault();
    printCurrentFile();
  } else if (key === ",") {
    event.preventDefault();
    openPreferences();
  }
}

onMounted(() => {
  emitter.on("file:Change", handleFileChange);
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("keydown", handleKeydown);
  window.addEventListener("resize", updateMenuPosition);
});

onUnmounted(() => {
  emitter.off("file:Change", handleFileChange);
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  document.removeEventListener("keydown", handleKeydown);
  window.removeEventListener("resize", updateMenuPosition);
  cancelCloseSubmenu();
});
</script>

<template>
  <div ref="rootRef" class="MenuDropDownBox">
    <button
      ref="triggerRef"
      class="menu-trigger"
      :class="{ active: isMenuOpen || isPreferencesOpen }"
      title="应用菜单"
      @click="toggleMenu"
    >
      <img class="logo" :src="logoSvg" alt="PureMark Logo" />
    </button>

    <div
      class="command-menu"
      :class="{ open: isMenuOpen }"
      :style="{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }"
      :aria-hidden="!isMenuOpen"
    >
      <template v-for="(item, index) in menuItems" :key="index">
        <div v-if="item.type === 'separator'" class="menu-separator"></div>
        <button
          v-else-if="item.type === 'submenu'"
          class="command-menu-item has-submenu"
          :class="{ active: activeSubmenuIndex === index }"
          @mouseenter="openSubmenu(index, $event)"
          @mouseleave="scheduleCloseSubmenu"
          @click="openSubmenu(index, $event)"
        >
          <span class="item-main">
            <AppIcon :name="item.icon" class="item-icon" />
            <span>{{ item.label }}</span>
          </span>
          <AppIcon name="arrow-right" class="submenu-arrow" />
        </button>
        <button
          v-else
          class="command-menu-item"
          :disabled="item.disabled?.()"
          @mouseenter="closeSubmenuImmediately"
          @click="runAction(item.action)"
        >
          <span class="item-main">
            <AppIcon :name="item.icon" class="item-icon" />
            <span>{{ item.label }}</span>
          </span>
          <span v-if="item.shortcut" class="item-shortcut">{{ item.shortcut }}</span>
        </button>
      </template>

      <div
        v-if="activeSubmenuIndex !== null"
        class="command-submenu"
        :style="{ top: `${submenuPosition.top}px`, left: `${submenuPosition.left}px` }"
        @mouseenter="cancelCloseSubmenu"
        @mouseleave="scheduleCloseSubmenu"
      >
        <template v-for="(child, ci) in submenuChildren" :key="ci">
          <div v-if="child.type === 'separator'" class="menu-separator"></div>
          <button
            v-else
            class="command-menu-item"
            :disabled="child.disabled?.()"
            @click="runAction(child.action)"
          >
            <span class="item-main">
              <AppIcon :name="child.icon" class="item-icon" />
              <span>{{ child.label }}</span>
            </span>
          </button>
        </template>
      </div>
    </div>

    <div
      class="preferences-panel"
      :class="{ open: isPreferencesOpen }"
      :aria-hidden="!isPreferencesOpen"
    >
      <MenuBar @exit-preferences="closePreferences" />
    </div>
  </div>
</template>

<style lang="less" scoped>
.MenuDropDownBox {
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;
  -webkit-app-region: no-drag;

  .menu-trigger {
    width: 26px;
    height: 26px;
    border: 1px solid var(--border-color-1);
    border-radius: 8px;
    background: var(--background-color-1);
    color: var(--text-color-3);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition:
      background-color 0.2s ease,
      border-color 0.2s ease,
      color 0.2s ease;

    &:hover {
      background: var(--hover-background-color);
      border-color: var(--border-color-2);
      color: var(--text-color-1);
    }

    &.active {
      color: color-mix(in srgb, var(--active-color) 86%, white 14%);
      border-color: color-mix(in srgb, var(--active-color) 42%, var(--border-color-1));
      background: color-mix(in srgb, var(--active-color) 14%, var(--background-color-1));
    }

    .logo {
      width: 16px;
      height: 16px;
      object-fit: contain;
    }
  }

  .command-menu {
    position: fixed;
    z-index: 1000;
    width: 280px;
    padding: 6px;
    border: 1px solid var(--border-color-1);
    border-radius: 8px;
    background: var(--background-color-1);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translateY(-6px);
    transition:
      opacity 0.14s ease,
      transform 0.14s ease,
      visibility 0s linear 0.14s;

    &.open {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translateY(0);
      transition-delay: 0s;
    }
  }

  .command-menu-item {
    width: 100%;
    min-height: 32px;
    padding: 6px 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-color);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    cursor: pointer;
    font-size: 13px;
    text-align: left;

    &:hover:not(:disabled) {
      background: var(--hover-color);
    }

    &:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .item-main {
      min-width: 0;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .item-icon {
      flex-shrink: 0;
      font-size: 15px;
      color: var(--text-color-3);
    }

    .item-shortcut {
      margin-left: auto;
      color: var(--text-color-3);
      font-size: 12px;
      font-family: var(--code-font);
      text-align: right;
      flex-shrink: 0;
    }
  }

  .command-menu-item.has-submenu {
    &.active {
      background: var(--hover-color);
    }

    .submenu-arrow {
      margin-left: auto;
      flex-shrink: 0;
      font-size: 14px;
      color: var(--text-color-3);
    }
  }

  .command-submenu {
    position: fixed;
    z-index: 1001;
    width: 200px;
    padding: 6px;
    border: 1px solid var(--border-color-1);
    border-radius: 8px;
    background: var(--background-color-1);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  }

  .menu-separator {
    height: 1px;
    margin: 5px 6px;
    background: var(--border-color-1);
  }

  .preferences-panel {
    position: fixed;
    top: 40px;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 999;
    background: var(--background-color-1);
    border-radius: 0 0 10px 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    overflow: hidden;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translateY(-8px);
    transition:
      opacity 0.16s ease,
      transform 0.16s ease,
      visibility 0s linear 0.16s;

    &.open {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translateY(0);
      transition-delay: 0s;
    }
  }
}
</style>
