import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * 应用级全局状态。阶段 1 仅用于验证 Pinia 响应式链路，
 * 后续阶段接入真实状态（主题、Tab、工作区）时会扩充。
 */
export const useAppStore = defineStore("app", () => {
  const version = ref(__APP_VERSION__);
  const platform = ref<string>("unknown");
  const ready = ref(false);

  function markReady() {
    ready.value = true;
  }

  function setPlatform(p: string) {
    platform.value = p;
  }

  return { version, platform, ready, markReady, setPlatform };
});
