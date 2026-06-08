/**
 * services/api 聚合入口（barrel）。
 *
 * 一方面统一 re-export 各系统能力子模块（fs/dialog/clipboard/launch/workspace/watch/
 * theme/shell/window/font/multiWindow/closeFlow/update），让渲染层从单一入口访问 Tauri 能力；
 * 另一方面实现「远程图床上传」逻辑——这是少数不走 Tauri command、而是直接走 HTTP fetch 的能力，
 * 因此实现内联在本文件中，并依赖用户在设置里配置的图床参数。
 */
import autotoast from "autotoast.js";
import { readUploadConfigFromStorage } from "@/utils/uploadConfig";

/**
 * 将 File 读取为 base64 字符串（去除 data URL 前缀）。
 *
 * @param file 浏览器 File 对象
 * @returns 纯 base64 内容（不含 `data:...;base64,` 前缀）
 */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        const base64Content = result.includes(",") ? result.split(",")[1] : result;
        resolve(base64Content);
      } else {
        reject(new Error("Failed to read file as base64"));
      }
    };
    reader.onerror = () => {
      reject(reader.error || new Error("Failed to read file as base64"));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * 解析一段文本为 JSON 对象。空字符串视为空对象；非对象或解析失败时抛出友好错误。
 *
 * @param raw 原始 JSON 文本
 * @param label 字段名，用于拼接错误提示
 * @returns 解析后的对象
 */
function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  if (!raw.trim()) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label}必须是 JSON 对象`);
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${label}格式不正确，请输入合法 JSON 对象`);
  }
}

/**
 * 解析自定义请求头文本为字符串键值对，非字符串值统一转为字符串。
 *
 * @param raw 请求头 JSON 文本
 * @returns 规范化后的请求头对象
 */
function parseHeaders(raw: string): Record<string, string> {
  const parsed = parseJsonObject(raw, "请求头");
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [
      key,
      typeof value === "string" ? value : `${value}`,
    ])
  );
}

/**
 * 按点分路径从对象中取值（如 `data.url`、`a.b.c`）。空路径返回原数据。
 *
 * @param data 任意来源数据（图床响应）
 * @param path 点分访问路径
 * @returns 路径对应的值；任一层不存在时返回 undefined
 */
function getValueByPath(data: unknown, path: string): unknown {
  if (!path.trim()) return data;

  return path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((current, part) => {
      if (current && typeof current === "object" && part in current) {
        return (current as Record<string, unknown>)[part];
      }
      return undefined;
    }, data);
}

/**
 * 上传图片到用户配置的远程图床并返回图片 URL。
 *
 * 流程：
 * 1. 读取本地图床配置，校验上传地址；
 * 2. 解析额外字段与请求头，并按需移除 multipart 的 Content-Type（交给浏览器自动加 boundary）；
 * 3. 依据 bodyType 构造请求体：
 *    - multipart/form-data：以 FormData 直传文件；
 *    - application/json：文件转 base64 后塞入指定字段；
 *    - application/x-www-form-urlencoded：不支持传文件，仅发送文件名并提示；
 * 4. 发送 fetch 请求，解析 JSON 响应，按配置的取值路径提取图片地址。
 *
 * @param file 待上传的图片 File 对象
 * @returns 远程图片 URL
 * @throws 未配置地址、上传失败、响应非 JSON 或未找到有效地址时抛出错误（并 toast 提示）
 */
export async function uploadImage(file: File): Promise<string> {
  const config = readUploadConfigFromStorage();
  if (!config.url) {
    const message = "请先配置图床上传地址";
    autotoast.show(message, "error");
    throw new Error(message);
  }

  const parsedExtraBody = parseJsonObject(config.extraBody, "额外字段");

  let body: BodyInit | null = null;
  const method = config.method;
  let headers: Record<string, string> = {};
  if (config.headers) {
    headers = parseHeaders(config.headers);
  }

  for (const key of Object.keys(headers)) {
    if (
      key.toLowerCase() === "content-type" &&
      headers[key]?.toLowerCase().includes("multipart/form-data")
    ) {
      delete headers[key];
    }
  }

  switch (config.bodyType) {
    case "multipart/form-data": {
      const formData = new FormData();
      formData.append(config.fileField, file);
      for (const [key, value] of Object.entries(parsedExtraBody)) {
        formData.append(key, typeof value === "string" ? value : JSON.stringify(value));
      }
      body = formData;
      break;
    }
    case "application/json": {
      const jsonBody: Record<string, unknown> = { ...parsedExtraBody };
      jsonBody[config.fileField] = await fileToBase64(file);
      body = JSON.stringify(jsonBody);
      const hasContentTypeHeader = Object.keys(headers).some(
        (key) => key.toLowerCase() === "content-type"
      );
      if (!hasContentTypeHeader) {
        headers["Content-Type"] = "application/json";
      }
      break;
    }
    case "application/x-www-form-urlencoded": {
      const searchParams = new URLSearchParams();
      searchParams.append(config.fileField, file.name);
      for (const [key, value] of Object.entries(parsedExtraBody)) {
        searchParams.append(key, typeof value === "string" ? value : JSON.stringify(value));
      }
      autotoast.show(
        "application/x-www-form-urlencoded 不支持直接上传文件，将只发送文件名。",
        "warn"
      );
      body = searchParams;
      break;
    }
    default:
      body = null;
  }
  try {
    const response = await fetch(config.url, {
      method,
      headers,
      body,
    });
    if (!response.ok) {
      throw new Error(`上传失败：${response.status} ${response.statusText}`);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error("上传接口返回的不是合法 JSON");
    }

    const result = getValueByPath(data, config.responseUrlPath);
    if (typeof result !== "string" || !result.trim()) {
      throw new Error(`响应中未找到有效图片地址：${config.responseUrlPath}`);
    }

    return result.trim();
  } catch (error) {
    autotoast.show(error instanceof Error ? error.message : "图片上传失败", "error");
    throw error;
  }
}

// Stage 2: 新增 fs/dialog/clipboard/launch barrel
export * from "./fs";
export * from "./dialog";
export * from "./clipboard";
export * from "./launch";

// Stage 3: workspace + watch barrel
export * from "./workspace";
export * from "./watch";

// Stage 4: theme + shell + window + font barrel
export * from "./theme";
export * from "./shell";
export * from "./window";
export * from "./font";

// Stage 5: multi-window + tab tear-off barrel
export * from "./multiWindow";
export * from "./closeFlow";

// Stage 6: updater barrel
export * from "./update";
