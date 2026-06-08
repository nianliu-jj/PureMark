/**
 * useTitle — 窗口标题的模块级共享状态。
 *
 * 基于 useContent 的当前文件路径与修改状态派生窗口标题（未保存时加 `*` 前缀，无文件名用 Untitled），
 * 通过 setWindowTitle 同步到 Tauri 窗口标题。模块级 watch 监听文件名与修改状态变化，
 * 在 Tab 切换 / 编辑 / 保存时自动更新标题。
 */
import { computed, ref, watch } from "vue";
import { setWindowTitle } from "@/services/api";
import useContent from "./useContent";

const { filePath, isModified } = useContent();

const title = ref("");

const fileName = computed(() => {
  const parts = filePath.value.split(/[\\/]/);
  return parts.at(-1) ?? "";
});

/** 根据当前文件名与修改状态重算标题，并同步到 Tauri 窗口标题与本地 title ref。 */
function updateTitle() {
  const name = fileName.value || "Untitled";
  const prefix = isModified.value ? "*" : "";
  const full = `${prefix}${name}`;
  setWindowTitle(full).catch((e) => console.error("[useTitle] setTitle failed:", e));
  title.value = full;
}

// 自动监听文件名和修改状态变化，tab 切换时自动更新标题
watch([fileName, isModified], () => {
  updateTitle();
});

/**
 * 提供窗口标题状态与更新方法。
 * @returns title（当前标题）、updateTitle（手动触发更新）。
 */
export default function useTitle() {
  return {
    title,
    updateTitle,
  };
}
