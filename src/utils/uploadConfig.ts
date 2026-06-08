/**
 * 图片上传（图床）配置工具。
 *
 * 定义上传配置的数据结构与默认值，并负责从 localStorage 读取、
 * 归一化（容错补默认值）以及兼容旧版分散存储的配置项。
 */
import { getStorageItemWithFallback } from "@/shared/utils/storage";

/** 上传请求方法 */
export type UploadRequestMethod = "POST" | "PUT";
/** 上传请求体类型 */
export type UploadBodyType =
  | "multipart/form-data"
  | "application/json"
  | "application/x-www-form-urlencoded";

/** 图床上传完整配置 */
export interface UploadConfig {
  /** 上传接口地址 */
  url: string;
  /** 请求方法 */
  method: UploadRequestMethod;
  /** 自定义请求头（原始字符串，由调用方解析） */
  headers: string;
  /** 请求体类型 */
  bodyType: UploadBodyType;
  /** 文件字段名（multipart 表单中的 key） */
  fileField: string;
  /** 附加请求体内容（原始字符串） */
  extraBody: string;
  /** 从响应中提取图片 URL 的字段路径，如 "data.url" */
  responseUrlPath: string;
}

/** 上传配置默认值 */
export const defaultUploadConfig: UploadConfig = {
  url: "",
  method: "POST",
  headers: "",
  bodyType: "multipart/form-data",
  fileField: "file",
  extraBody: "",
  responseUrlPath: "data.url",
};

/** 应用配置在 localStorage 中的主键 */
export const APP_CONFIG_STORAGE_KEY = "puremark-config";
/** 旧版本应用配置主键（读取时作兼容回退） */
export const LEGACY_APP_CONFIG_STORAGE_KEYS = ["milkup-config"] as const;

// 归一化请求方法：仅 PUT 识别为 PUT，其余一律 POST
function normalizeUploadMethod(value?: string | null): UploadRequestMethod {
  return value?.toUpperCase() === "PUT" ? "PUT" : "POST";
}

// 归一化请求体类型：仅接受三种合法值，否则回退默认
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

/**
 * 归一化上传配置。
 *
 * 将可能不完整的部分配置补齐为完整配置：去除字符串首尾空白，
 * 空值回退到默认配置，方法与请求体类型经合法性校验。
 *
 * @param partial 可能不完整的上传配置
 * @returns 完整且合法的上传配置
 */
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

/**
 * 读取旧版分散存储的上传配置。
 *
 * 旧版本图床设置并未收口到 puremark-config.upload，而是分散存放在多个独立 key 中
 * （uploadUrl、uploadMethod 等），此处逐项读取并补默认值用于迁移兼容。
 *
 * @param storage 存储对象（默认 localStorage）
 * @returns 由旧字段拼装出的部分上传配置
 */
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

/**
 * 从存储中读取并归一化上传配置。
 *
 * 优先读取新版应用配置（含旧 key 回退）中的 upload 字段，
 * 与旧版分散配置合并后归一化；读取或解析失败时回退到旧版配置。
 *
 * @param storage 存储对象（默认 localStorage）
 * @returns 完整且合法的上传配置
 */
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
