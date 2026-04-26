import type { ComputedRef, WritableComputedRef } from "vue";
import { computed, watch } from "vue";
import emitter from "@/events";
import { changeSaveStatus as apiChangeSaveStatus } from "@/services/api";
import useTab from "./useTab";

// 延迟初始化，避免模块加载时立即调用useTab
let isInitialized = false;

// 用于外部访问的 computed 引用（模块级缓存）
let _markdown: WritableComputedRef<string> | null = null;
let _originalContent: WritableComputedRef<string> | null = null;
let _filePath: WritableComputedRef<string> | null = null;
let _isModified: ComputedRef<boolean> | null = null;

function initialize() {
  if (isInitialized) return;

  const { currentTab, hasUnsavedTabs } = useTab();

  _markdown = computed({
    get: () => currentTab.value?.content ?? "",
    set: (val) => {
      if (currentTab.value) currentTab.value.content = val;
    },
  });

  _originalContent = computed({
    get: () => currentTab.value?.originalContent ?? "",
    set: (val) => {
      if (currentTab.value) currentTab.value.originalContent = val;
    },
  });

  _filePath = computed({
    get: () => currentTab.value?.filePath ?? "",
    set: (val: string) => {
      if (currentTab.value) currentTab.value.filePath = val;
    },
  });

  _isModified = computed(() => currentTab.value?.isModified ?? false);

  // 监听 isModified 变化：
  //  - 通过 mitt 通知前端组件（阶段 4 引入）
  //  - 通过 Tauri command 同步到 Rust 侧 WINDOW_SAVE_STATE，供 close_discard 未保存确认使用
  watch(
    () => hasUnsavedTabs.value,
    (hasUnsaved) => {
      const md = currentTab.value?.content ?? "";
      const orig = currentTab.value?.originalContent ?? "";
      if (md || orig) {
        emitter.emit("save-status-changed" as any, !hasUnsaved as any);
      }
      apiChangeSaveStatus(!hasUnsaved).catch(() => {});
    },
    { immediate: true }
  );

  isInitialized = true;
}

export default () => {
  initialize();

  return {
    markdown: _markdown!,
    originalContent: _originalContent!,
    filePath: _filePath!,
    isModified: _isModified!,
  };
};
