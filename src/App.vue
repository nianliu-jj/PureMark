<script setup lang="ts">
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
