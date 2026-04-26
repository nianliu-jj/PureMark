import type { FontConfig, FontSizeConfig } from "@/types/font";
import type { ImagePasteMethod, ShortcutKeyMap } from "@/core";
import { useStorage } from "@vueuse/core";
import { readonly, watch } from "vue";

import { defaultFontConfig, defaultFontSizeConfig } from "@/config/fonts";
import type { StartupMode } from "@/services/launchState";
import type { DefaultLineEndingMode } from "@/utils/lineEnding";
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
  other: {
    editorPadding: string;
    autoPairSymbols: boolean;
    defaultLineEnding: DefaultLineEndingMode;
  };
  mermaid: {
    defaultDisplayMode: "code" | "mixed" | "diagram";
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
  other: {
    editorPadding: "120px",
    autoPairSymbols: true,
    defaultLineEnding: "system",
  },
  mermaid: {
    defaultDisplayMode: "diagram",
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
    other: {
      ...defaultConfig.other,
      ...partial?.other,
    },
    mermaid: {
      ...defaultConfig.mermaid,
      ...partial?.mermaid,
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

function normalizeFontConfig(fontConfig: FontConfig): FontConfig {
  return {
    "editor-font": normalizeFont(fontConfig["editor-font"]),
    "code-font": normalizeFont(fontConfig["code-font"]),
  };
}

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

export function useConfig() {
  return {
    config,

    getConf: <K extends keyof AppConfig>(key: K) => readonly(config.value[key]),

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

    watchConf: <K extends keyof AppConfig>(key: K, callback: (value: AppConfig[K]) => void) => {
      return watch(() => config.value[key], callback, { deep: true });
    },
  };
}
