import { computed, ref, watch } from "vue";
import { setWindowTitle } from "@/services/api";
import useContent from "./useContent";

const { filePath, isModified } = useContent();

const title = ref("");

const fileName = computed(() => {
  const parts = filePath.value.split(/[\\/]/);
  return parts.at(-1) ?? "";
});

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

export default function useTitle() {
  return {
    title,
    updateTitle,
  };
}
