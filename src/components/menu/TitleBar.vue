<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { platform as osPlatform } from "@tauri-apps/plugin-os";
import AppIcon from "@/components/ui/AppIcon.vue";
import useFile from "@/hooks/useFile";
import { isFileSidebarVisible, isOutlineSidebarVisible, toggleSidebar } from "@/hooks/useOutline";
import {
  closeWindow,
  isFullscreen,
  isMaximized,
  minimize as apiMinimize,
  onWindowResized,
  toggleMaximize as apiToggleMaximize,
} from "@/services/api";
import TabBar from "@/components/workspace/TabBar.vue";
import MenuDropDown from "./MenuDropDown.vue";

const { createNewFile } = useFile();
const isWin = ref(false);
const isFullScreen = ref(false);

let unsubResized: (() => void) | null = null;

async function refreshMaximized() {
  try {
    isFullScreen.value = (await isMaximized()) || (await isFullscreen());
  } catch (e) {
    console.error("[TitleBar] refreshMaximized failed:", e);
  }
}

async function onMinimize() {
  try {
    await apiMinimize();
  } catch (e) {
    console.error("[TitleBar] minimize failed:", e);
  }
}

async function onMaximizeToggle() {
  try {
    await apiToggleMaximize();
    await refreshMaximized();
  } catch (e) {
    console.error("[TitleBar] maximize failed:", e);
  }
}

async function onClose() {
  try {
    // closeWindow 发起 OS 关闭请求；EditorView 的 interceptCloseRequest 会拦截并处理未保存 tab。
    await closeWindow();
  } catch (e) {
    console.error("[TitleBar] close failed:", e);
  }
}

onMounted(async () => {
  try {
    isWin.value = (await osPlatform()) === "windows";
  } catch {
    isWin.value = true;
  }

  await refreshMaximized();
  unsubResized = await onWindowResized(refreshMaximized);
});

onUnmounted(() => {
  unsubResized?.();
});

function onCreateFile() {
  createNewFile();
}

function toggleFileSidebar() {
  toggleSidebar("file");
}

function toggleOutlineSidebar() {
  toggleSidebar("outline");
}
</script>

<template>
  <div class="TitleBarBox" data-tauri-drag-region>
    <template v-if="isWin">
      <TabBar />

      <div class="sidebar-toggle-group">
        <button class="title-bar-add" title="新建标签页" @click="onCreateFile">
          <AppIcon name="plus" />
        </button>
        <button
          class="sidebar-toggle-btn"
          :class="{ active: isFileSidebarVisible }"
          title="切换左侧文件栏"
          @click="toggleFileSidebar"
        >
          <span class="sidebar-toggle-glyph left"></span>
        </button>
        <button
          class="sidebar-toggle-btn"
          :class="{ active: isOutlineSidebarVisible }"
          title="切换右侧大纲栏"
          @click="toggleOutlineSidebar"
        >
          <span class="sidebar-toggle-glyph right"></span>
        </button>
        <MenuDropDown />
      </div>

      <div class="window-controls">
        <button class="window-control-btn" @click="onMinimize">
          <AppIcon name="min" />
        </button>
        <button class="window-control-btn" @click="onMaximizeToggle">
          <AppIcon :name="isFullScreen ? 'normal' : 'max'" />
        </button>
        <button class="window-control-btn close-btn" @click="onClose">
          <AppIcon name="close" />
        </button>
      </div>
    </template>
    <template v-else>
      <div class="traffic-lights">
        <button class="traffic-light close" title="关闭" aria-label="关闭" @click="onClose">
          <svg viewBox="0 0 12 12" class="traffic-glyph">
            <path
              d="M3 3 L9 9 M9 3 L3 9"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linecap="round"
            />
          </svg>
        </button>
        <button
          class="traffic-light minimize"
          title="最小化"
          aria-label="最小化"
          @click="onMinimize"
        >
          <svg viewBox="0 0 12 12" class="traffic-glyph">
            <path d="M2.5 6 H9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          </svg>
        </button>
        <button
          class="traffic-light maximize"
          title="最大化"
          aria-label="最大化"
          @click="onMaximizeToggle"
        >
          <svg viewBox="0 0 12 12" class="traffic-glyph">
            <path
              v-if="!isFullScreen"
              d="M3 5 L3 3 L5 3 M7 3 L9 3 L9 5 M9 7 L9 9 L7 9 M5 9 L3 9 L3 7"
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linecap="round"
            />
            <path
              v-else
              d="M3.5 6 H8.5 M6 3.5 V8.5"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
      <TabBar />
      <div class="sidebar-toggle-group">
        <button class="title-bar-add" title="新建标签页" @click="onCreateFile">
          <AppIcon name="plus" />
        </button>
        <button
          class="sidebar-toggle-btn"
          :class="{ active: isFileSidebarVisible }"
          title="切换左侧文件栏"
          @click="toggleFileSidebar"
        >
          <span class="sidebar-toggle-glyph left"></span>
        </button>
        <button
          class="sidebar-toggle-btn"
          :class="{ active: isOutlineSidebarVisible }"
          title="切换右侧大纲栏"
          @click="toggleOutlineSidebar"
        >
          <span class="sidebar-toggle-glyph right"></span>
        </button>
      </div>
      <div class="menu-anchor">
        <MenuDropDown />
      </div>
    </template>
  </div>
</template>

<style lang="less" scoped>
.TitleBarBox {
  -webkit-app-region: drag;
  /* ✅ 允许拖动窗口 */
  height: 40px;
  background: var(--background-color-2);
  color: var(--text-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  overflow: hidden;

  .leading-space {
    width: 68px;
    flex-shrink: 0;
  }

  .traffic-lights {
    -webkit-app-region: no-drag;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    flex-shrink: 0;
    height: 100%;

    .traffic-light {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      border: 0.5px solid rgba(0, 0, 0, 0.18);
      padding: 0;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: transparent;
      transition: color 0.12s ease;

      &.close {
        background: #ff5f57;
      }
      &.minimize {
        background: #febc2e;
      }
      &.maximize {
        background: #28c840;
      }

      .traffic-glyph {
        width: 8px;
        height: 8px;
        display: block;
      }
    }

    &:hover .traffic-light {
      color: rgba(0, 0, 0, 0.55);
    }
  }

  .menu-anchor {
    margin-right: 10px;
  }

  .sidebar-toggle-group {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-right: 10px;
    -webkit-app-region: no-drag;
    flex-shrink: 0;
  }

  .title-bar-add {
    width: 26px;
    height: 26px;
    border: 1px solid var(--border-color-1);
    border-radius: 8px;
    background: var(--background-color-1);
    color: var(--text-color-3);
    cursor: pointer;
    -webkit-app-region: no-drag;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition:
      background-color 0.2s ease,
      border-color 0.2s ease,
      color 0.2s ease;

    &:hover {
      background: var(--hover-background-color);
      border-color: var(--border-color-2);
      color: var(--text-color-1);
    }

    svg {
      font-size: 14px;
    }
  }

  .sidebar-toggle-btn {
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

    .sidebar-toggle-glyph {
      position: relative;
      width: 14px;
      height: 12px;
      border: 1.5px solid currentColor;
      border-radius: 3px;
      box-sizing: border-box;
      opacity: 0.95;

      &::before {
        content: "";
        position: absolute;
        top: 1px;
        bottom: 1px;
        width: 3px;
        border-radius: 1px;
        background: currentColor;
      }

      &.left::before {
        left: 1px;
      }

      &.right::before {
        right: 1px;
      }
    }
  }

  .window-controls {
    display: flex;
    -webkit-app-region: no-drag;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;

    /* ✅ 控制按钮不能拖动 */
    .window-control-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 16px;
      color: var(--text-color-1);
      height: 40px;
      width: 40px;
      border: none;
      background: transparent;

      &:hover {
        background: var(--hover-color);
      }

      &.close-btn:hover {
        background: #ff5f56;
        color: white;
      }
    }
  }
}
</style>
