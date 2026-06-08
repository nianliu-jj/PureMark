/**
 * useOutline — 侧栏可见性与文档大纲的模块级共享状态。
 *
 * 维护文件侧栏 / 大纲侧栏的显隐状态（持久化到 localStorage）以及当前文档的标题大纲列表。
 * 显隐状态以模块级 ref 共享，并导出一组命令式函数（show/hide/toggle/set）供组件与其他 hook 调用；
 * 大纲数据通过监听 mitt 的 `outline:Update` 事件更新（在组件挂载/卸载时订阅与取消）。
 */
import { onMounted, onUnmounted, ref } from "vue";
import emitter from "@/events";

export type SidebarPane = "file" | "outline";

const FILE_SIDEBAR_VISIBLE_KEY = "file-sidebar-visible";
const OUTLINE_SIDEBAR_VISIBLE_KEY = "outline-sidebar-visible";

const isFileSidebarVisible = ref(readStoredSidebarVisible(FILE_SIDEBAR_VISIBLE_KEY));
const isOutlineSidebarVisible = ref(readStoredSidebarVisible(OUTLINE_SIDEBAR_VISIBLE_KEY));
const outline = ref<{ id: string; level: number; text: string; pos: number }[]>([]);

/** 从 localStorage 读取某侧栏的可见状态，无值默认隐藏。 */
function readStoredSidebarVisible(key: string): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(key) === "true";
}

/** 把指定侧栏可见状态持久化到 localStorage。 */
function persistSidebarVisible(side: SidebarPane, visible: boolean) {
  if (typeof localStorage === "undefined") return;

  const key = side === "file" ? FILE_SIDEBAR_VISIBLE_KEY : OUTLINE_SIDEBAR_VISIBLE_KEY;
  localStorage.setItem(key, String(visible));
}

/** 取得对应侧栏的可见状态 ref。 */
function getSidebarVisibleRef(side: SidebarPane) {
  return side === "file" ? isFileSidebarVisible : isOutlineSidebarVisible;
}

/** 设置侧栏可见状态并同步持久化。 */
function setSidebarVisible(side: SidebarPane, status: boolean) {
  getSidebarVisibleRef(side).value = status;
  persistSidebarVisible(side, status);
}

/** 切换侧栏显隐：传入 status 则强制设为该值，否则取反当前状态。 */
function toggleSidebar(side: SidebarPane, status?: boolean | null) {
  const toggle = status !== null && status !== undefined;
  const next = toggle ? status : !getSidebarVisibleRef(side).value;
  setSidebarVisible(side, next);
}

function showSidebar(side: SidebarPane) {
  setSidebarVisible(side, true);
}

function hideSidebar(side: SidebarPane) {
  setSidebarVisible(side, false);
}

/** 批量设置文件/大纲侧栏可见性（仅对 boolean 字段生效）。 */
function setSidebarsVisibility(state: { file?: boolean | null; outline?: boolean | null }) {
  if (typeof state.file === "boolean") {
    setSidebarVisible("file", state.file);
  }
  if (typeof state.outline === "boolean") {
    setSidebarVisible("outline", state.outline);
  }
}

/** 更新大纲标题列表（由 outline:Update 事件回调驱动）。 */
function setOutline(headings: any) {
  outline.value = headings;
}

/**
 * 在组件中订阅大纲更新事件并暴露大纲与侧栏可见状态。
 * 挂载时监听 `outline:Update`，卸载时取消，避免重复订阅。
 * @returns outline、isFileSidebarVisible、isOutlineSidebarVisible。
 */
export default function useOutline() {
  onMounted(() => {
    emitter.on("outline:Update", setOutline);
  });
  onUnmounted(() => {
    emitter.off("outline:Update", setOutline);
  });

  return {
    outline,
    isFileSidebarVisible,
    isOutlineSidebarVisible,
  };
}

export {
  hideSidebar,
  isFileSidebarVisible,
  isOutlineSidebarVisible,
  setSidebarsVisibility,
  setSidebarVisible,
  showSidebar,
  toggleSidebar,
};
