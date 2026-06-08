/**
 * useSourceCode — 源码模式（显示原始 Markdown）开关的模块级共享状态。
 *
 * isShowSource 反映编辑器当前是否处于源码模式：状态来源于编辑器，通过监听 mitt 的
 * `sourceView:changed` 事件单向同步（全局只注册一次监听）。toggleSourceCode 仅发出
 * `sourceView:toggle` 事件请求编辑器切换，由编辑器在切换完成后回发 changed 事件回写状态。
 */
import { ref } from "vue";
import emitter from "@/events";

const isShowSource = ref(false);

// 监听源码模式状态变化（全局监听，只注册一次）——状态由编辑器单向回写
let isListenerRegistered = false;
if (!isListenerRegistered) {
  emitter.on("sourceView:changed", (enabled: boolean) => {
    isShowSource.value = enabled;
  });
  isListenerRegistered = true;
}

/**
 * 提供源码模式状态与切换动作。
 * @returns isShowSource（当前是否源码模式）、toggleSourceCode（请求编辑器切换）。
 */
export default function useSourceCode() {
  const toggleSourceCode = () => {
    // 通过事件通知编辑器切换源码模式
    emitter.emit("sourceView:toggle");
  };

  return {
    isShowSource,
    toggleSourceCode,
  };
}
