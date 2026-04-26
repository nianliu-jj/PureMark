import { getStorageItemWithFallback } from "@/shared/utils/storage";

export type UploadRequestMethod = "POST" | "PUT";
export type UploadBodyType =
  | "multipart/form-data"
  | "application/json"
  | "application/x-www-form-urlencoded";

export interface UploadConfig {
  url: string;
  method: UploadRequestMethod;
  headers: string;
  bodyType: UploadBodyType;
  fileField: string;
  extraBody: string;
  responseUrlPath: string;
}

export const defaultUploadConfig: UploadConfig = {
  url: "",
  method: "POST",
  headers: "",
  bodyType: "multipart/form-data",
  fileField: "file",
  extraBody: "",
  responseUrlPath: "data.url",
};

export const APP_CONFIG_STORAGE_KEY = "puremark-config";
export const LEGACY_APP_CONFIG_STORAGE_KEYS = ["milkup-config"] as const;

function normalizeUploadMethod(value?: string | null): UploadRequestMethod {
  return value?.toUpperCase() === "PUT" ? "PUT" : "POST";
}

function normalizeUploadBodyType(value?: string | null): UploadBodyType {
  switch (value) {
    case "application/json":
    case "application/x-www-form-urlencoded":
    case "multipart/form-data":
      return value;
    default:
      return defaultUploadConfig.bodyType;
  }
}

export function normalizeUploadConfig(partial?: Partial<UploadConfig> | null): UploadConfig {
  return {
    url: partial?.url?.trim() || defaultUploadConfig.url,
    method: normalizeUploadMethod(partial?.method),
    headers: partial?.headers?.trim() || defaultUploadConfig.headers,
    bodyType: normalizeUploadBodyType(partial?.bodyType),
    fileField: partial?.fileField?.trim() || defaultUploadConfig.fileField,
    extraBody: partial?.extraBody?.trim() || defaultUploadConfig.extraBody,
    responseUrlPath: partial?.responseUrlPath?.trim() || defaultUploadConfig.responseUrlPath,
  };
}

export function getLegacyUploadConfig(storage: Storage = localStorage): Partial<UploadConfig> {
  // 旧版图床设置并未收口到 puremark-config.upload，而是分散存放在多个独立 key 中。
  return {
    url: storage.getItem("uploadUrl") || defaultUploadConfig.url,
    method: normalizeUploadMethod(storage.getItem("uploadMethod")),
    headers: storage.getItem("uploadHeaders") || defaultUploadConfig.headers,
    bodyType: normalizeUploadBodyType(storage.getItem("uploadBodyType")),
    fileField: storage.getItem("uploadFileField") || defaultUploadConfig.fileField,
    extraBody: storage.getItem("uploadExtraBody") || defaultUploadConfig.extraBody,
    responseUrlPath:
      storage.getItem("uploadResponseUrlPath") || defaultUploadConfig.responseUrlPath,
  };
}

export function readUploadConfigFromStorage(storage: Storage = localStorage): UploadConfig {
  try {
    const rawConfig = getStorageItemWithFallback(storage, [
      APP_CONFIG_STORAGE_KEY,
      ...LEGACY_APP_CONFIG_STORAGE_KEYS,
    ]);
    if (!rawConfig) {
      return normalizeUploadConfig(getLegacyUploadConfig(storage));
    }

    const parsed = JSON.parse(rawConfig) as { upload?: Partial<UploadConfig> };
    return normalizeUploadConfig({
      ...getLegacyUploadConfig(storage),
      ...parsed.upload,
    });
  } catch {
    return normalizeUploadConfig(getLegacyUploadConfig(storage));
  }
}
