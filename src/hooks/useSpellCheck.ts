/**
 * useSpellCheck — 拼写检查开关的模块级共享状态。
 *
 * isSpellCheckEnabled 表示是否启用浏览器原生拼写检查；状态既反映到 <html> 的 spellcheck 属性，
 * 也持久化到 localStorage（key 为 `spellcheck`）。init 在启动时从 localStorage 恢复状态。
 */
import { nextTick, ref } from "vue";

const isSpellCheckEnabled = ref(false);

/** 应用拼写检查状态：更新 ref，并在 DOM 就绪后写入 <html> 的 spellcheck 属性与 localStorage。 */
function applySpellCheck(isEnabled: boolean) {
  isSpellCheckEnabled.value = isEnabled;
  nextTick(() => {
    const html = document.documentElement;
    if (isEnabled) {
      html.setAttribute("spellcheck", "true");
      localStorage.setItem("spellcheck", "true");
    } else {
      html.setAttribute("spellcheck", "false");
      localStorage.setItem("spellcheck", "false");
    }
  });
}

// 初始化拼写检查状态：从 localStorage 恢复并应用
function init() {
  const savedSpellCheck = localStorage.getItem("spellcheck");
  const isEnabled = savedSpellCheck === "true";
  applySpellCheck(isEnabled);
}

/**
 * 提供拼写检查状态与操作。
 * @returns isSpellCheckEnabled、applySpellCheck、init。
 */
export default function useSpellCheck() {
  return {
    isSpellCheckEnabled,
    applySpellCheck,
    init,
  };
}
