/**
 * useContent — 当前活跃 Tab 内容的响应式视图。
 *
 * 该 hook 把「当前 Tab（useTab.currentTab）」的 content / originalContent / filePath / isModified
 * 包装成可读写的 computed，作为编辑器与各业务 hook 访问「当前文档内容」的统一入口；
 * 写入这些 computed 会回写到当前 Tab 对象上。
 *
 * 采用延迟初始化（模块级缓存），避免模块加载阶段过早调用 useTab 造成的初始化顺序问题。
 * 同时在初始化时建立副作用：监听是否存在未保存 Tab，将保存状态同步给前端组件（mitt 事件）
 * 和 Rust 宿主（apiChangeSaveStatus，用于关闭窗口时的未保存确认）。
 */
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

/**
 * 首次调用时建立各 computed 与保存状态副作用，幂等（重复调用直接返回）。
 * 内部将当前 Tab 的字段映射为可读写 computed，并监听未保存状态向前端与 Rust 同步。
 */
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

/**
 * 返回当前活跃 Tab 内容的响应式引用。
 * @returns markdown / originalContent / filePath（可读写 computed）与 isModified（只读 computed）。
 */
export default () => {
  initialize();

  return {
    markdown: _markdown!,
    originalContent: _originalContent!,
    filePath: _filePath!,
    isModified: _isModified!,
  };
};
