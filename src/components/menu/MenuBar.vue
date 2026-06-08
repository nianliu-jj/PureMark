<script setup lang="ts">
/**
 * MenuBar.vue —— 偏好设置面板的左侧导航 + 右侧内容容器
 *
 * 职责：
 * - 作为「设置/偏好」整体页面的骨架：左列竖向菜单（文件、设置、外观、快捷键、关于），
 *   右侧根据当前选中项动态挂载对应的设置子组件。
 * - 进入面板时自动做一次静默的后台更新检查。
 *
 * 主要 emits：
 * - exit-preferences：点击「返回」时通知父级退出偏好设置、回到编辑器。
 *
 * UI 位置：覆盖编辑区的偏好设置全屏面板。
 */
import { computed, onMounted, ref, type Component } from "vue";
import About from "@/components/settings/About.vue";
import appearancePage from "@/components/settings/AppearancePage.vue";
import FileOptions from "@/components/settings/FileOptions.vue";
import SettingBase from "@/components/settings/SettingBase.vue";
import ShortcutPage from "@/components/settings/ShortcutPage.vue";
import AppIcon from "@/components/ui/AppIcon.vue";
import { checkUpdate } from "@/services/api/update.js";

type MenuTab = "settings" | "about" | "appearance" | "file" | "shortcut";

// 模块级标志，确保整个会话只自动检查一次更新
let hasAutoCheckedUpdate = false;

const activeTab = ref<MenuTab>("file");
// 菜单项标识 -> 对应的设置子组件，供右侧 <component :is> 动态渲染
const menuComponents: Record<MenuTab, Component> = {
  settings: SettingBase,
  about: About,
  appearance: appearancePage,
  file: FileOptions,
  shortcut: ShortcutPage,
};
/** 当前选中菜单对应的设置组件 */
const activeComponent = computed(() => menuComponents[activeTab.value]);
const emit = defineEmits<{
  /** 退出偏好设置面板 */
  (event: "exit-preferences"): void;
}>();

// 左侧导航菜单配置：点击切换 activeTab，驱动右侧内容更新
const menuOptions: Array<{
  label: string;
  action: () => void;
  icon: string;
  value: MenuTab;
}> = [
  { label: "文件", action: () => (activeTab.value = "file"), icon: "document", value: "file" },
  {
    label: "设置",
    action: () => (activeTab.value = "settings"),
    icon: "config-props",
    value: "settings",
  },
  {
    label: "外观",
    action: () => (activeTab.value = "appearance"),
    icon: "waiguan",
    value: "appearance",
  },
  {
    label: "快捷键",
    action: () => (activeTab.value = "shortcut"),
    icon: "shortcut-key",
    value: "shortcut",
  },
  { label: "关于", action: () => (activeTab.value = "about"), icon: "github", value: "about" },
];

/** 通知父级退出偏好设置 */
function exitPreferences() {
  emit("exit-preferences");
}

onMounted(() => {
  if (hasAutoCheckedUpdate) return;
  hasAutoCheckedUpdate = true;

  // 避免在 render 期间触发更新检查副作用，影响菜单动态子树切换。
  // 自动后台检查失败时静默处理，不在控制台制造异常噪音。
  checkUpdate({ silent: true }).catch(() => {});
});
</script>

<template>
  <div class="MenubarBox">
    <div class="optionsContainer">
      <div class="menu-options">
        <button
          v-for="option in menuOptions"
          :key="option.label"
          class="menu-option"
          :class="{ active: activeTab === option.value }"
          @click="option.action"
        >
          <AppIcon :name="option.icon" class="menu-option-icon" />
          {{ option.label }}
        </button>
      </div>
      <button class="back-button" title="返回" @click="exitPreferences">
        <AppIcon name="arrow-left" class="back-button-icon" />
        返回
      </button>
    </div>
    <div class="detailContainer">
      <div class="scrollView">
        <div class="components">
          <component :is="activeComponent" :key="activeTab" />
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.MenubarBox {
  height: 100%;
  display: flex;

  .detailContainer {
    flex: 1;
    height: calc(100% - 24px);
    padding: 12px;
    padding-top: 0;
    padding-right: 0;
    background: var(--background-color-2);

    .scrollView {
      height: 100%;
      overflow-y: auto;
      background: var(--background-color-2);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .components {
      height: 100%;
      padding-top: 12px;
    }
  }

  .optionsContainer {
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: stretch;
    padding: 12px 0;
    width: 200px;
    gap: 4px;
    -webkit-app-region: drag;
    background: var(--background-color);

    .menu-options {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }

    .menu-option {
      cursor: pointer;
      width: 100%;
      -webkit-app-region: no-drag;
      padding: 16px 12px;
      font-size: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
      border: none;
      background: transparent;
      text-align: left;
      color: var(--text-color);

      .menu-option-icon {
        font-size: 18px;
        flex-shrink: 0;
      }

      &:hover {
        background: var(--hover-color);
      }

      &.active {
        background: var(--active-color);
        font-weight: bold;
      }
    }

    .back-button {
      cursor: pointer;
      -webkit-app-region: no-drag;
      flex-shrink: 0;
      margin: 4px 12px 0;
      padding: 12px;
      font-size: 15px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border: 1px solid var(--border-color-1);
      border-radius: 8px;
      background: transparent;
      color: var(--text-color-2);
      transition:
        background-color 0.2s ease,
        color 0.2s ease,
        border-color 0.2s ease;

      .back-button-icon {
        font-size: 18px;
        flex-shrink: 0;
      }

      &:hover {
        background: var(--hover-color);
        color: var(--text-color);
        border-color: var(--border-color-2);
      }
    }
  }
}
</style>
