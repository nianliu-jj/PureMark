import type { App } from "vue";
import {
  create,
  NButton,
  NCard,
  NConfigProvider,
  NDialogProvider,
  NInput,
  NLayout,
  NLayoutContent,
  NLayoutHeader,
  NLoadingBarProvider,
  NMessageProvider,
  NNotificationProvider,
  NSpace,
  NTag,
} from "naive-ui";

/**
 * 按需注册 Naive UI 组件。避免全量引入造成 bundle 膨胀。
 * 新增组件时扩展此数组即可，保持单处管理。
 */
const components = [
  NButton,
  NCard,
  NConfigProvider,
  NDialogProvider,
  NInput,
  NLayout,
  NLayoutContent,
  NLayoutHeader,
  NLoadingBarProvider,
  NMessageProvider,
  NNotificationProvider,
  NSpace,
  NTag,
];

export default {
  install(app: App) {
    const naive = create({ components });
    app.use(naive);
  },
};
