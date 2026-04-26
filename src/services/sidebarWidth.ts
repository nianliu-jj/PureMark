import { readonly, ref } from "vue";

export type SidebarPane = "file" | "outline";

export const DEFAULT_SIDEBAR_WIDTH = 280;
export const MIN_SIDEBAR_WIDTH = 220;
export const MAX_SIDEBAR_WIDTH = 520;

const fileSidebarWidth = ref(DEFAULT_SIDEBAR_WIDTH);
const outlineSidebarWidth = ref(DEFAULT_SIDEBAR_WIDTH);

function resolveMaxSidebarWidth(containerWidth?: number): number {
  if (!containerWidth || containerWidth <= 0) {
    return MAX_SIDEBAR_WIDTH;
  }

  return Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.min(MAX_SIDEBAR_WIDTH, Math.floor(containerWidth * 0.38))
  );
}

function getWidthRef(side: SidebarPane) {
  return side === "file" ? fileSidebarWidth : outlineSidebarWidth;
}

export function clampSidebarWidth(width: number, containerWidth?: number): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH;

  const maxWidth = resolveMaxSidebarWidth(containerWidth);
  return Math.round(Math.max(MIN_SIDEBAR_WIDTH, Math.min(width, maxWidth)));
}

export function setSidebarWidth(side: SidebarPane, width: number, containerWidth?: number): number {
  const nextWidth = clampSidebarWidth(width, containerWidth);
  getWidthRef(side).value = nextWidth;
  return nextWidth;
}

export function getSidebarWidth(side: SidebarPane): number {
  return getWidthRef(side).value;
}

export function useSidebarWidth(side: SidebarPane) {
  return readonly(getWidthRef(side));
}
