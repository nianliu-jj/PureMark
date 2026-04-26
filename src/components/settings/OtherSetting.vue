<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AppIcon from "@/components/ui/AppIcon.vue";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import useOtherConfig from "@/hooks/useOtherConfig";
import { useConfig } from "@/hooks/useConfig";
import {
  formatLineEnding,
  resolveDefaultLineEnding,
  type DefaultLineEndingMode,
} from "@/utils/lineEnding";

const { currentEditorPadding, setEditorPadding } = useOtherConfig();
const { config } = useConfig();

const paddingSettingsExpanded = ref(false);
const mermaidSettingsExpanded = ref(false);
const behaviorSettingsExpanded = ref(false);
const systemLineEndingLabel = ref("Unix (LF)");

// 从完整值中提取数字部分用于显示（如 "20px" -> "20"）
const displayPaddingValue = computed(() => {
  const value = currentEditorPadding.value || "";
  // 提取数字部分（包括小数点）
  const match = value.match(/^(\d+\.?\d*)/);
  return match ? match[1] : "";
});

function togglePaddingSettings() {
  paddingSettingsExpanded.value = !paddingSettingsExpanded.value;
}

function handlePaddingChange(value: string) {
  // 如果提取到数字，自动添加 "px" 单位

  setEditorPadding(`${value}px`);
}

function toggleMermaidSettings() {
  mermaidSettingsExpanded.value = !mermaidSettingsExpanded.value;
}

function toggleBehaviorSettings() {
  behaviorSettingsExpanded.value = !behaviorSettingsExpanded.value;
}

const mermaidModeOptions = [
  { value: "code", label: "代码" },
  { value: "mixed", label: "混合" },
  { value: "diagram", label: "图表" },
];

const lineEndingOptions: Array<{ value: DefaultLineEndingMode; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "crlf", label: "Windows (CRLF)" },
  { value: "lf", label: "Unix (LF)" },
];

const autoPairSymbols = computed(() => config.value.other?.autoPairSymbols ?? true);
const defaultLineEnding = computed<DefaultLineEndingMode>(
  () => config.value.other?.defaultLineEnding ?? "system"
);

function setMermaidMode(mode: string) {
  config.value = {
    ...config.value,
    mermaid: { ...config.value.mermaid, defaultDisplayMode: mode as "code" | "mixed" | "diagram" },
  };
}

function updateOtherConfig(patch: Partial<typeof config.value.other>) {
  config.value = {
    ...config.value,
    other: {
      ...config.value.other,
      ...patch,
    },
  };
}

function setAutoPairSymbols(enabled: boolean) {
  updateOtherConfig({ autoPairSymbols: enabled });
}

function setDefaultLineEnding(mode: DefaultLineEndingMode) {
  updateOtherConfig({ defaultLineEnding: mode });
}

onMounted(async () => {
  systemLineEndingLabel.value = formatLineEnding(await resolveDefaultLineEnding("system"));
});
</script>

<template>
  <div class="other-setting-page">
    <!-- 边距设置折叠抽屉 -->
    <div class="collapsible-section">
      <div class="section-header" @click="togglePaddingSettings">
        <div class="section-content-wrapper">
          <h2 class="section-title">
            <span class="title-icon">
              <AppIcon name="waiguan" />
            </span>
            <span class="title-text">编辑器其他外观设置</span>
          </h2>
          <p class="section-desc">配置编辑器其他外观设置</p>
        </div>
        <AppIcon
          name="arrow-right"
          class="section-arrow"
          :class="{ active: paddingSettingsExpanded }"
        />
      </div>
      <div class="section-content" :class="{ expanded: paddingSettingsExpanded }">
        <div class="setting-list">
          <div class="setting-item">
            <label class="setting-label">左右边距(PX)</label>
            <div class="setting-input-wrapper">
              <Input
                type="number"
                :model-value="displayPaddingValue"
                placeholder="请输入数字"
                @update:model-value="handlePaddingChange"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Mermaid 设置折叠抽屉 -->
    <div class="collapsible-section">
      <div class="section-header" @click="toggleMermaidSettings">
        <div class="section-content-wrapper">
          <h2 class="section-title">
            <span class="title-icon accent">
              <AppIcon name="magic-wand" />
            </span>
            <span class="title-text">Mermaid 图表设置</span>
          </h2>
          <p class="section-desc">配置 Mermaid 代码块的默认显示模式</p>
        </div>
        <AppIcon
          name="arrow-right"
          class="section-arrow"
          :class="{ active: mermaidSettingsExpanded }"
        />
      </div>
      <div class="section-content" :class="{ expanded: mermaidSettingsExpanded }">
        <div class="setting-list">
          <div class="setting-item">
            <label class="setting-label">默认显示模式</label>
            <div class="setting-input-wrapper mode-select">
              <span
                v-for="opt in mermaidModeOptions"
                :key="opt.value"
                class="mode-option"
                :class="{ active: config.mermaid?.defaultDisplayMode === opt.value }"
                @click="setMermaidMode(opt.value)"
              >
                {{ opt.label }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="collapsible-section">
      <div class="section-header" @click="toggleBehaviorSettings">
        <div class="section-content-wrapper">
          <h2 class="section-title">
            <span class="title-icon behavior">
              <AppIcon name="shortcut-key" />
            </span>
            <span class="title-text">编辑行为与文件格式</span>
          </h2>
          <p class="section-desc">配置成对符号补全，以及新建文件保存时默认使用的换行风格</p>
        </div>
        <AppIcon
          name="arrow-right"
          class="section-arrow"
          :class="{ active: behaviorSettingsExpanded }"
        />
      </div>
      <div class="section-content" :class="{ expanded: behaviorSettingsExpanded }">
        <div class="setting-list">
          <div class="setting-item">
            <div class="setting-main">
              <label class="setting-label">成对补全符号</label>
              <p class="setting-hint">输入括号、引号等符号时自动补全配对符号，默认开启。</p>
            </div>
            <div class="setting-input-wrapper switch-align">
              <Switch :model-value="autoPairSymbols" @update:model-value="setAutoPairSymbols" />
            </div>
          </div>

          <div class="setting-item line-ending-item">
            <div class="setting-main">
              <label class="setting-label">默认换行风格</label>
              <p class="setting-hint">
                仅在新建文件或没有原始文件格式信息时生效。跟随系统时，当前为
                {{ systemLineEndingLabel }}。
              </p>
            </div>
            <div class="setting-input-wrapper mode-select line-ending-options">
              <span
                v-for="opt in lineEndingOptions"
                :key="opt.value"
                class="mode-option"
                :class="{ active: defaultLineEnding === opt.value }"
                @click="setDefaultLineEnding(opt.value)"
              >
                {{ opt.label }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.other-setting-page {
  display: flex;
  flex-direction: column;
  gap: 16px;

  // 折叠抽屉样式
  .collapsible-section {
    background: var(--background-color-2);
    border: 1px solid var(--border-color-1);
    border-radius: 8px;
    transition: all 0.2s ease;

    &:hover {
      border-color: var(--border-color-2);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .section-header {
      padding: 16px 20px;
      cursor: pointer;
      transition: all 0.2s ease;
      border-bottom: 1px solid var(--border-color-1);
      display: flex;
      align-items: center;
      justify-content: space-between;

      &:hover {
        background: var(--background-color-3);
      }

      .section-content-wrapper {
        flex: 1;
      }

      .section-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--text-color);
        margin: 0 0 4px 0;
        line-height: 1.4;
        display: flex;
        align-items: center;
        gap: 10px;

        .title-text {
          display: block;
        }

        .title-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border-radius: 10px;
          background: color-mix(in srgb, var(--primary-color) 14%, transparent);
          color: var(--primary-color);

          &.accent {
            background: color-mix(in srgb, #14b8a6 14%, transparent);
            color: #14b8a6;
          }

          &.behavior {
            background: color-mix(in srgb, #2563eb 14%, transparent);
            color: #2563eb;
          }
        }
      }

      .section-desc {
        font-size: 12px;
        color: var(--text-color-2);
        margin: 0;
        line-height: 1.4;
      }

      .section-arrow {
        font-size: 20px;
        color: var(--text-color-2);
        transition: transform 0.2s ease;
        margin-left: 12px;
        flex-shrink: 0;

        &.active {
          transform: rotate(90deg);
        }
      }
    }

    .section-content {
      max-height: 0;
      overflow: hidden;
      transition:
        max-height 0.3s ease,
        opacity 0.3s ease;
      opacity: 0;

      &.expanded {
        max-height: 1500px;
        opacity: 1;
      }
    }
  }

  // 设置列表样式
  .setting-list {
    padding: 20px;

    .setting-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid var(--border-color-1);

      &:last-child {
        border-bottom: none;
      }

      &.line-ending-item {
        align-items: flex-start;
      }

      .setting-main {
        min-width: 120px;
        padding-right: 16px;
        flex: 1;
      }

      .setting-label {
        font-size: 14px;
        font-weight: 500;
        color: var(--text-color-3);
        margin: 0;
        display: block;
      }

      .setting-hint {
        margin: 6px 0 0;
        font-size: 12px;
        line-height: 1.5;
        color: var(--text-color-2);
      }

      .setting-input-wrapper {
        flex: 1;
        min-width: 0;

        &.switch-align {
          display: flex;
          justify-content: flex-end;
        }

        :deep(.input-container) {
          .label {
            display: none;
          }
        }

        &.mode-select {
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
}

// 响应式设计
@media (max-width: 768px) {
  .other-setting-page {
    gap: 12px;

    .collapsible-section {
      .section-header {
        padding: 12px 16px;

        .section-title {
          font-size: 14px;
        }

        .section-desc {
          font-size: 11px;
        }
      }
    }

    .setting-list {
      padding: 16px;

      .setting-item {
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;

        .setting-main {
          min-width: auto;
          padding-right: 0;
        }

        .setting-input-wrapper {
          width: 100%;
        }
      }
    }
  }
}
</style>
