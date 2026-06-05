// 默认主题
const supportedThemes = [
  "normal",
  "normal-dark",
  "crepe",
  "crepe-dark",
  "frame",
  "frame-dark",
  "glass",
] as const;

export type ThemeName = (typeof supportedThemes)[number] | string;

export interface Theme {
  name: ThemeName;
  label: string;
  description: string;
  isCustom?: boolean;
  data: {
    themeProperties?: Record<string, string>;
    appCssProperties: Record<string, string>;
    appCssPropertiesArray?: string[];
    puredownCssProperties: Record<string, string>;
    puredownCssPropertiesArray?: string[];
  };
}

interface LegacyThemeData {
  themeProperties?: Record<string, unknown>;
  appCssProperties?: Record<string, unknown>;
  appCssPropertiesArray?: unknown;
  puredownCssProperties?: Record<string, unknown>;
  puredownCssPropertiesArray?: unknown;
  // 兼容旧主题文件字段，读取时会统一映射到 puredown*。
  milkdownCssProperties?: Record<string, unknown>;
  milkdownCssPropertiesArray?: unknown;
}

function normalizeCssProperties(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, String(item)])
  );
}

function normalizeCssPropertyArray(value: unknown, fallback: Record<string, string>): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  return Object.keys(fallback);
}

export function normalizeThemeData(data?: LegacyThemeData | null): Theme["data"] {
  const appCssProperties = normalizeCssProperties(data?.appCssProperties);
  const puredownCssProperties = normalizeCssProperties(
    data?.puredownCssProperties || data?.milkdownCssProperties
  );
  const themeProperties = normalizeCssProperties(data?.themeProperties);

  return {
    themeProperties:
      Object.keys(themeProperties).length > 0
        ? themeProperties
        : {
            ...appCssProperties,
            ...puredownCssProperties,
          },
    appCssProperties,
    appCssPropertiesArray: normalizeCssPropertyArray(data?.appCssPropertiesArray, appCssProperties),
    puredownCssProperties,
    puredownCssPropertiesArray: normalizeCssPropertyArray(
      data?.puredownCssPropertiesArray || data?.milkdownCssPropertiesArray,
      puredownCssProperties
    ),
  };
}

export function normalizeTheme(obj: any): Theme {
  return {
    name: typeof obj?.name === "string" ? obj.name : "",
    label: typeof obj?.label === "string" ? obj.label : "",
    description: typeof obj?.description === "string" ? obj.description : "",
    isCustom: obj?.isCustom === true ? true : undefined,
    data: normalizeThemeData(obj?.data),
  };
}

// 检查对象是否为Theme类型
export function isThemeObject(obj: any): obj is Theme {
  const data = obj?.data;
  return (
    obj &&
    typeof obj === "object" &&
    typeof obj.name === "string" &&
    typeof obj.label === "string" &&
    typeof obj.description === "string" &&
    data &&
    typeof data === "object" &&
    ((data.themeProperties && typeof data.themeProperties === "object") ||
      (data.appCssProperties && typeof data.appCssProperties === "object") ||
      (data.puredownCssProperties && typeof data.puredownCssProperties === "object") ||
      (data.milkdownCssProperties && typeof data.milkdownCssProperties === "object"))
  );
}
