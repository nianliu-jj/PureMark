<script setup lang="ts">
import { computed } from "vue";
import { convertFileSrc } from "@tauri-apps/api/core";
import AppIcon from "@/components/ui/AppIcon.vue";
import { Slider } from "@/components/ui/slider";
import { showOpenDialog } from "@/services/api";
import { useConfig } from "@/hooks/useConfig";

const { config, setConf } = useConfig();

const imagePath = computed(() => config.value.appearance?.workspaceBackgroundImagePath ?? "");
const imageOpacity = computed(() =>
  normalizeOpacity(config.value.appearance?.workspaceBackgroundOpacity)
);
const imageName = computed(() => {
  if (!imagePath.value) return "未选择图片";
  const normalized = imagePath.value.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : imagePath.value;
});
const previewImageSrc = computed(() => resolvePreviewImageSrc(imagePath.value));

function normalizeOpacity(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 35;
  return Math.min(Math.max(Math.round(value), 0), 100);
}

function resolvePreviewImageSrc(path: string): string {
  if (!path) return "";
  if (/^(https?:|data:|blob:|asset:|tauri:|file:)/i.test(path)) return path;

  try {
    return convertFileSrc(path);
  } catch {
    return path;
  }
}

function updateAppearance(patch: Partial<typeof config.value.appearance>) {
  setConf("appearance", {
    ...config.value.appearance,
    ...patch,
  });
}

async function selectBackgroundImage() {
  const result = await showOpenDialog({
    title: "选择背景板图片",
    filters: [
      {
        name: "图片",
        extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"],
      },
    ],
  });

  if (result.canceled || !result.filePaths[0]) return;
  updateAppearance({ workspaceBackgroundImagePath: result.filePaths[0] });
}

function clearBackgroundImage() {
  updateAppearance({ workspaceBackgroundImagePath: "" });
}

function updateImageOpacity(value: number) {
  updateAppearance({ workspaceBackgroundOpacity: normalizeOpacity(value) });
}
</script>

<template>
  <div class="BackgroundPanelBox">
    <div class="background-preview" :class="{ empty: !previewImageSrc }">
      <img
        v-if="previewImageSrc"
        :src="previewImageSrc"
        :style="{ opacity: imageOpacity / 100 }"
        alt=""
      />
      <AppIcon v-else name="image-config" class="empty-icon" />
    </div>

    <div class="background-controls">
      <div class="setting-row">
        <div class="setting-main">
          <span class="setting-label">背景图片</span>
          <span class="setting-value">{{ imageName }}</span>
        </div>
        <div class="action-group">
          <button class="action-button" title="选择背景板图片" @click="selectBackgroundImage">
            <AppIcon name="folder-opened" />
            <span>选择</span>
          </button>
          <button
            class="action-button ghost"
            :disabled="!imagePath"
            title="移除背景板图片"
            @click="clearBackgroundImage"
          >
            <AppIcon name="close" />
            <span>移除</span>
          </button>
        </div>
      </div>

      <div class="setting-row opacity-row">
        <div class="setting-main">
          <span class="setting-label">图片透明度</span>
          <span class="setting-value">{{ imageOpacity }}%</span>
        </div>
        <div class="slider-wrapper">
          <Slider
            :model-value="imageOpacity"
            :min="0"
            :max="100"
            :step="1"
            @update:model-value="updateImageOpacity"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.BackgroundPanelBox {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 18px;
  align-items: stretch;

  .background-preview {
    min-height: 128px;
    border: 1px solid var(--border-color-1);
    border-radius: 8px;
    overflow: hidden;
    background:
      linear-gradient(45deg, var(--background-color-2) 25%, transparent 25%),
      linear-gradient(-45deg, var(--background-color-2) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, var(--background-color-2) 75%),
      linear-gradient(-45deg, transparent 75%, var(--background-color-2) 75%);
    background-position:
      0 0,
      0 8px,
      8px -8px,
      -8px 0;
    background-size: 16px 16px;
    background-color: var(--background-color-1);
    display: flex;
    align-items: center;
    justify-content: center;

    img {
      width: 100%;
      height: 100%;
      min-height: 128px;
      object-fit: cover;
      display: block;
    }

    &.empty {
      color: var(--text-color-3);
      background: var(--background-color-2);
    }

    .empty-icon {
      font-size: 28px;
      opacity: 0.7;
    }
  }

  .background-controls {
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 18px;
  }

  .setting-row {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .setting-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .setting-label {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-color-1);
  }

  .setting-value {
    max-width: 320px;
    font-size: 12px;
    color: var(--text-color-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .action-group {
    flex-shrink: 0;
    display: flex;
    gap: 8px;
  }

  .action-button {
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--border-color-1);
    border-radius: 6px;
    background: var(--background-color-1);
    color: var(--text-color-1);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    cursor: pointer;
    font-size: 13px;
    transition:
      background-color 0.2s ease,
      border-color 0.2s ease,
      color 0.2s ease;

    &:hover:not(:disabled) {
      background: var(--hover-background-color);
      border-color: var(--border-color-2);
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    &.ghost {
      background: transparent;
      color: var(--text-color-2);
    }
  }

  .opacity-row {
    align-items: flex-start;
  }

  .slider-wrapper {
    width: min(320px, 50%);
    min-width: 180px;
    padding-top: 2px;
  }
}

@media (max-width: 768px) {
  .BackgroundPanelBox {
    grid-template-columns: 1fr;

    .setting-row {
      align-items: flex-start;
      flex-direction: column;
    }

    .action-group,
    .slider-wrapper {
      width: 100%;
    }

    .action-button {
      flex: 1;
    }

    .setting-value {
      max-width: 100%;
    }
  }
}
</style>
