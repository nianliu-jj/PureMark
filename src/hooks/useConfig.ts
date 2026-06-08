/**
 * useConfig — 应用全局配置的模块级共享状态。
 *
 * 该 hook 维护一份持久化到 localStorage（key 为 `puremark-config`）的应用配置 `AppConfig`，
 * 覆盖字体、图片粘贴/上传、外观、编辑器其他设置、Mermaid、导出、快捷键、工作区等模块。
 * 通过 `useStorage` 自动完成响应式 ↔ localStorage 双向同步，并在序列化读取阶段执行：
 *  - 历史 key 迁移（milkup-config → puremark-config）；
 *  - 旧结构合并（散落在独立 localStorage key 的 image / upload 配置）；
 *  - 缺省值合并与字段归一化（mergeAppConfig）。
 *
 * 对外暴露 getConf / setConf / watchConf，供各业务 hook（useFont、useWorkSpace 等）读写配置。
 */
import type { FontConfig, FontSizeConfig } from "@/types/font";
import type { ImagePasteMethod, ShortcutKeyMap } from "@/core";
import { useStorage } from "@vueuse/core";
import { readonly, watch } from "vue";

import { defaultFontConfig, defaultFontSizeConfig } from "@/config/fonts";
import type { StartupMode } from "@/services/launchState";
import type { DefaultLineEndingMode } from "@/utils/lineEnding";
import type { ImageExportFormat } from "@/shared/types/export";
import type { UploadConfig } from "@/utils/uploadConfig";
import { setNestedProperty } from "@/utils/tool";
import { migrateStorageValue } from "@/shared/utils/storage";
import {
  defaultUploadConfig,
  getLegacyUploadConfig,
  normalizeUploadConfig,
} from "@/utils/uploadConfig";

interface AppConfig extends Record<string, any> {
  font: {
    family: FontConfig;
    size: FontSizeConfig;
  };
  image: {
    pasteMethod: ImagePasteMethod;
    localPath: string;
  };
  upload: UploadConfig;
  appearance: {
    workspaceBackgroundImagePath: string;
    workspaceBackgroundOpacity: number;
  };
  other: {
    editorPadding: string;
    autoPairSymbols: boolean;
    defaultLineEnding: DefaultLineEndingMode;
  };
  mermaid: {
    defaultDisplayMode: "code" | "mixed" | "diagram";
  };
  export: {
    imageFormat: ImageExportFormat;
  };
  shortcuts: ShortcutKeyMap;
  workspace: {
    sortBy: "name" | "mtime";
    startupMode: StartupMode;
    startupPath: string;
    autoExpandSidebar: boolean;
    fileSidebarWidth: number;
    outlineSidebarWidth: number;
    sidebarWidth?: number;
  };
}

const defaultConfig: AppConfig = {
  font: {
    family: defaultFontConfig,
    size: defaultFontSizeConfig,
  },
  image: {
    pasteMethod: "local",
    localPath: "/assets",
  },
  upload: defaultUploadConfig,
  appearance: {
    workspaceBackgroundImagePath: "",
    workspaceBackgroundOpacity: 35,
  },
  other: {
    editorPadding: "120px",
    autoPairSymbols: true,
    defaultLineEnding: "system",
  },
  mermaid: {
    defaultDisplayMode: "diagram",
  },
  export: {
    imageFormat: "png",
  },
  shortcuts: {},
  workspace: {
    sortBy: "name",
    startupMode: "new-file",
    startupPath: "",
    autoExpandSidebar: false,
    fileSidebarWidth: 280,
    outlineSidebarWidth: 280,
  },
};

const APP_CONFIG_STORAGE_KEY = "puremark-config";
const LEGACY_APP_CONFIG_STORAGE_KEYS = ["milkup-config"] as const;

/**
 * 将外部传入的局部配置与默认配置深合并，得到一份字段完整、已归一化的 AppConfig。
 * 兼容旧字段（如 workspace.sidebarWidth 拆分为 file/outline 两个宽度），并对粘贴方式、
 * 字体、背景透明度、启动模式等做缺省回退与取值校验。
 * @param partial 可能不完整的历史配置或外部配置
 * @returns 字段完整的 AppConfig
 */
function mergeAppConfig(partial?: Partial<AppConfig>): AppConfig {
  const imagePasteMethod =
    partial?.image?.pasteMethod === "remote" || partial?.image?.pasteMethod === "local"
      ? partial.image.pasteMethod
      : defaultConfig.image.pasteMethod;
  const fontFamily = normalizeFontConfig({
    ...defaultConfig.font.family,
    ...partial?.font?.family,
  });

  return {
    ...defaultConfig,
    ...partial,
    font: {
      ...defaultConfig.font,
      ...partial?.font,
      family: fontFamily,
    },
    image: {
      ...defaultConfig.image,
      ...partial?.image,
      pasteMethod: imagePasteMethod,
    },
    upload: {
      ...defaultConfig.upload,
      ...partial?.upload,
    },
    appearance: {
      ...defaultConfig.appearance,
      ...partial?.appearance,
      workspaceBackgroundOpacity: normalizeWorkspaceBackgroundOpacity(
        partial?.appearance?.workspaceBackgroundOpacity
      ),
    },
    other: {
      ...defaultConfig.other,
      ...partial?.other,
    },
    mermaid: {
      ...defaultConfig.mermaid,
      ...partial?.mermaid,
    },
    export: {
      ...defaultConfig.export,
      ...partial?.export,
    },
    shortcuts: partial?.shortcuts || defaultConfig.shortcuts,
    workspace: {
      ...defaultConfig.workspace,
      ...partial?.workspace,
      fileSidebarWidth:
        partial?.workspace?.fileSidebarWidth ??
        partial?.workspace?.sidebarWidth ??
        defaultConfig.workspace.fileSidebarWidth,
      outlineSidebarWidth:
        partial?.workspace?.outlineSidebarWidth ??
        partial?.workspace?.sidebarWidth ??
        defaultConfig.workspace.outlineSidebarWidth,
      startupMode:
        partial?.workspace?.startupMode ??
        (partial?.workspace?.startupPath
          ? "custom-workspace"
          : defaultConfig.workspace.startupMode),
    },
  };
}

/** 将工作区背景透明度规整为 0–100 的整数，非法值回退默认值。 */
function normalizeWorkspaceBackgroundOpacity(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return defaultConfig.appearance.workspaceBackgroundOpacity;
  }

  return Math.min(Math.max(Math.round(value), 0), 100);
}

/** 归一化字体配置中的编辑器字体与代码字体两项。 */
function normalizeFontConfig(fontConfig: FontConfig): FontConfig {
  return {
    "editor-font": normalizeFont(fontConfig["editor-font"]),
    "code-font": normalizeFont(fontConfig["code-font"]),
  };
}

/** 归一化单个字体项，清理其 value 中多余的分号与空白。 */
function normalizeFont(font: FontConfig[keyof FontConfig]) {
  return {
    ...font,
    value: normalizeFontFamilyValue(font.value),
  };
}

function normalizeFontFamilyValue(value: string): string {
  return value.trim().replace(/;+$/g, "").trim();
}

// 兼容两层历史配置：
// 1. 更早期的 milkup-config 键名；
// 2. 已升级到 puremark-config，但 image/upload 仍散落在独立 localStorage key 中的旧结构。
migrateStorageValue(localStorage, APP_CONFIG_STORAGE_KEY, LEGACY_APP_CONFIG_STORAGE_KEYS);

function getLegacyImageConfig(): AppConfig["image"] {
  // 早期版本会把图片设置单独存到 localStorage，读取新配置时需要一并吸收。
  const pasteMethod = localStorage.getItem("pasteMethod");
  const localPath = localStorage.getItem("localImagePath");

  return {
    pasteMethod:
      pasteMethod === "local" || pasteMethod === "remote"
        ? pasteMethod
        : defaultConfig.image.pasteMethod,
    localPath: localPath || defaultConfig.image.localPath,
  };
}

// 持久化的全局配置：useStorage 提供响应式 ref 并自动与 localStorage 双向同步。
// 自定义 serializer 在读取时合并默认值、吸收旧结构（image/upload）并归一化。
const config = useStorage<AppConfig>(APP_CONFIG_STORAGE_KEY, defaultConfig, localStorage, {
  serializer: {
    read: (value: string) => {
      try {
        const parsed = JSON.parse(value) as Partial<AppConfig>;
        const merged = mergeAppConfig(parsed);

        return {
          ...merged,
          image: {
            ...getLegacyImageConfig(),
            ...merged.image,
          },
          upload: normalizeUploadConfig({
            ...getLegacyUploadConfig(),
            ...merged.upload,
          }),
        };
      } catch {
        return mergeAppConfig({
          image: getLegacyImageConfig(),
          upload: normalizeUploadConfig(getLegacyUploadConfig()),
        });
      }
    },
    write: (value: AppConfig) => JSON.stringify(value),
  },
});

/**
 * 提供应用配置的读写能力。
 * @returns
 *  - `config`：响应式的完整配置 ref（与 localStorage 同步）。
 *  - `getConf`：按顶层 key 读取只读配置片段。
 *  - `setConf`：按顶层 key 写入；当传入 value(string) + pathValue 时按嵌套路径设值（不可变更新）。
 *  - `watchConf`：深度监听某个顶层 key 的变化。
 */
export function useConfig() {
  return {
    config,

    // 以只读形式返回某个配置片段，避免调用方直接修改响应式对象。
    getConf: <K extends keyof AppConfig>(key: K) => readonly(config.value[key]),

    // 写入配置：始终生成新对象（不可变更新），支持「整段替换」与「按嵌套路径设值」两种形式。
    setConf: <K extends keyof AppConfig>(key: K, value: AppConfig[K] | string, pathValue?: any) => {
      if (typeof value === "string" && pathValue !== undefined) {
        config.value = {
          ...config.value,
          [key]: setNestedProperty(config.value[key], value, pathValue),
        };
      } else {
        config.value = { ...config.value, [key]: value as AppConfig[K] };
      }
    },

    // 深度监听某个顶层配置 key 的变化，返回取消监听函数。
    watchConf: <K extends keyof AppConfig>(key: K, callback: (value: AppConfig[K]) => void) => {
      return watch(() => config.value[key], callback, { deep: true });
    },
  };
}
