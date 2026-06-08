<script setup lang="ts">
/**
 * App.vue —— 应用根组件
 *
 * 职责：
 * - 作为整个应用的最外层容器，统一挂载 Naive UI 的全局 Provider
 *   （配置、加载条、对话框、通知、消息），为所有子页面提供主题与全局服务能力。
 * - 通过 <RouterView /> 渲染当前路由对应的页面（如 EditorView / AboutView 等）。
 *
 * 说明：
 * - 无 props / emits，是路由树的根节点。
 * - 当前阶段仅根据 localStorage 中的主题名粗略判断明暗，后续阶段再接入完整主题系统。
 */
import {
  darkTheme,
  dateZhCN,
  NConfigProvider,
  NDialogProvider,
  NLoadingBarProvider,
  NMessageProvider,
  NNotificationProvider,
  zhCN,
} from "naive-ui";
import { computed, ref } from "vue";

// 阶段 1 暂用 localStorage 主题名判断 dark，阶段 4 再接入完整主题系统
const themeName = ref(localStorage.getItem("theme-name") || "normal");
const theme = computed(() => (themeName.value.endsWith("-dark") ? darkTheme : null));
</script>

<template>
  <NConfigProvider
    :theme="theme"
    :locale="zhCN"
    :date-locale="dateZhCN"
    class="app-config-provider"
  >
    <NLoadingBarProvider>
      <NDialogProvider>
        <NNotificationProvider>
          <NMessageProvider>
            <RouterView />
          </NMessageProvider>
        </NNotificationProvider>
      </NDialogProvider>
    </NLoadingBarProvider>
  </NConfigProvider>
</template>

<style>
/* NConfigProvider 渲染为 <div class="n-config-provider"> 会打断 #app 的 flex column 链，
   需要让它自己也成为 flex column 容器，EditorView 的 fragment 才能撑开中间编辑区。 */
.app-config-provider {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}
</style>
