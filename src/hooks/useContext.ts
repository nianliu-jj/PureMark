/**
 * useContext — 编辑器全局动作的轻量入口。
 *
 * 目前仅封装「重新加载编辑器」一个动作：通过 mitt 广播 `editor:reload`，
 * 通知活跃编辑器实例重建内部 ProseMirror 编辑器（如保存另存、主题切换等场景需要重建时调用）。
 */
import emitter from "@/events";

/**
 * 提供编辑器级别的全局动作。
 * @returns reloadEditor —— 触发活跃编辑器重建内部 ProseMirror 实例。
 */
export function useContext() {
  // 重新加载编辑器（通知活跃的编辑器实例重建内部 ProseMirror 编辑器）
  function reloadEditor() {
    emitter.emit("editor:reload");
  }

  return {
    reloadEditor,
  };
}
