import { onMounted, onUnmounted, ref } from "vue";
import emitter from "@/events";

export type SidebarPane = "file" | "outline";

const FILE_SIDEBAR_VISIBLE_KEY = "file-sidebar-visible";
const OUTLINE_SIDEBAR_VISIBLE_KEY = "outline-sidebar-visible";

const isFileSidebarVisible = ref(readStoredSidebarVisible(FILE_SIDEBAR_VISIBLE_KEY));
const isOutlineSidebarVisible = ref(readStoredSidebarVisible(OUTLINE_SIDEBAR_VISIBLE_KEY));
const outline = ref<{ id: string; level: number; text: string; pos: number }[]>([]);

function readStoredSidebarVisible(key: string): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(key) === "true";
}

function persistSidebarVisible(side: SidebarPane, visible: boolean) {
  if (typeof localStorage === "undefined") return;

  const key = side === "file" ? FILE_SIDEBAR_VISIBLE_KEY : OUTLINE_SIDEBAR_VISIBLE_KEY;
  localStorage.setItem(key, String(visible));
}

function getSidebarVisibleRef(side: SidebarPane) {
  return side === "file" ? isFileSidebarVisible : isOutlineSidebarVisible;
}

function setSidebarVisible(side: SidebarPane, status: boolean) {
  getSidebarVisibleRef(side).value = status;
  persistSidebarVisible(side, status);
}

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

function setSidebarsVisibility(state: { file?: boolean | null; outline?: boolean | null }) {
  if (typeof state.file === "boolean") {
    setSidebarVisible("file", state.file);
  }
  if (typeof state.outline === "boolean") {
    setSidebarVisible("outline", state.outline);
  }
}

function setOutline(headings: any) {
  outline.value = headings;
}

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
