<script setup lang="ts">
import { computed, onMounted, ref, type Component } from "vue";
import About from "@/components/settings/About.vue";
import appearancePage from "@/components/settings/AppearancePage.vue";
import FileOptions from "@/components/settings/FileOptions.vue";
import SettingBase from "@/components/settings/SettingBase.vue";
import ShortcutPage from "@/components/settings/ShortcutPage.vue";
import AppIcon from "@/components/ui/AppIcon.vue";
import { checkUpdate } from "@/services/api/update.js";

type MenuTab = "settings" | "about" | "appearance" | "file" | "shortcut";

let hasAutoCheckedUpdate = false;

const activeTab = ref<MenuTab>("file");
const menuComponents: Record<MenuTab, Component> = {
  settings: SettingBase,
  about: About,
  appearance: appearancePage,
  file: FileOptions,
  shortcut: ShortcutPage,
};
const activeComponent = computed(() => menuComponents[activeTab.value]);

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
    align-items: flex-start;
    padding: 12px 0;
    width: 200px;
    gap: 4px;
    -webkit-app-region: drag;
    background: var(--background-color);

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
  }
}
</style>
