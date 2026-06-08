/**
 * useOtherConfig — 编辑器「其他设置」中的模块级共享状态（当前主要为编辑器内边距）。
 *
 * 基于 useConfig 的 other 配置派生 currentOtherConfig / currentEditorPadding，
 * 并把编辑器内边距以 CSS 变量（--puremark-editor-padding）写入 DOM 根容器 `#fontRoot`。
 */
import { computed, nextTick } from "vue";
import { useConfig } from "./useConfig";

// 编辑器内边距 CSS 变量
const EDITOR_PADDING_CSS_VAR = "--puremark-editor-padding";

// 获取配置管理实例
const { config, getConf, setConf } = useConfig();

// 当前其他配置（直接使用响应式的 config）
const currentOtherConfig = computed(() => config.value.other);

// 当前编辑器内边距
const currentEditorPadding = computed(() => currentOtherConfig.value.editorPadding);

// 初始化配置：把已存的编辑器内边距应用到 DOM
function init() {
  // 应用当前编辑器内边距配置到 DOM
  const editorPadding = getConf("other").editorPadding;

  applyEditorPadding(editorPadding);
}

// 设置编辑器内边距：写回配置并即时应用到 DOM
function setEditorPadding(padding: string) {
  setConf("other", "editorPadding", padding);
  applyEditorPadding(padding);
}

// 应用编辑器内边距：等待 DOM 就绪后写入 CSS 变量
function applyEditorPadding(padding: string) {
  nextTick(() => {
    const fontRootElement = document.querySelector("#fontRoot") as HTMLElement;

    if (!fontRootElement) return;

    fontRootElement.style.setProperty(EDITOR_PADDING_CSS_VAR, padding);
  });
}

/**
 * 提供「其他设置」的状态与操作。
 * @returns currentEditorPadding、currentOtherConfig 及 init/setEditorPadding。
 */
export default function useOtherConfig() {
  return {
    currentEditorPadding,
    currentOtherConfig,
    init,
    setEditorPadding,
  };
}
