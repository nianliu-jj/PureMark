import autotoast from "autotoast.js";
import { readUploadConfigFromStorage } from "@/utils/uploadConfig";

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

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  if (!raw.trim()) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label}必须是 JSON 对象`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${label}格式不正确，请输入合法 JSON 对象`);
  }
}

function parseHeaders(raw: string): Record<string, string> {
  const parsed = parseJsonObject(raw, "请求头");
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [
      key,
      typeof value === "string" ? value : `${value}`,
    ])
  );
}

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
