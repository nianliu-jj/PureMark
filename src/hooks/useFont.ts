/**
 * useFont — 字体与字号配置的模块级共享状态。
 *
 * 负责加载系统字体列表（getSystemFonts）、读写 useConfig 中的字体/字号配置，并将其作为 CSS
 * 变量应用到 DOM 根容器 `#fontRoot`。currentFont / currentFontSize 是基于 config 的派生
 * computed，UI 修改后通过 setFont / setFontSize 写回配置并即时应用到样式。
 */
import type {
  Font,
  FontConfig,
  FontList,
  FontSizeConfig,
  FontSizeType,
  FontType,
} from "@/types/font";
import { computed, ref } from "vue";
import { fontCssVariables, fontSizeCssVariables, fontSizeOptions } from "@/config/fonts";
import { getSystemFonts } from "@/services/api";
import { useConfig } from "./useConfig";

// 系统字体列表
const fontList = ref<FontList>([]);

// 获取配置管理实例
const { getConf, setConf } = useConfig();

// 当前字体配置
const currentFont = computed(() => normalizeFontConfig(getConf("font").family));

// 当前字体尺寸配置
const currentFontSize = computed(() => getConf("font").size);

/**
 * 初始化字体模块：拉取系统字体列表填充下拉选项，归一化已存字体配置（必要时回写），
 * 并将字体与字号应用到 DOM。出错时仅记录日志，不中断应用启动。
 */
async function init() {
  // 获取系统字体列表
  try {
    const systemFonts = await getSystemFonts();
    // Font 对象数组
    fontList.value = systemFonts.map((fontName) => {
      const name = fontName.replace(/^['"]|['"]$/g, "");
      return {
        label: name,
        value: name,
      };
    });

    // 应用当前字体配置到 DOM
    const fontConfig = getConf("font").family;
    const fontSizeConfig = getConf("font").size;
    const normalizedFontConfig = normalizeFontConfig(fontConfig);
    if (JSON.stringify(normalizedFontConfig) !== JSON.stringify(fontConfig)) {
      setConf("font", "family", normalizedFontConfig);
    }

    // 设置字体
    applyFont(normalizedFontConfig);
    // 设置字体尺寸
    applyFontSize(fontSizeConfig);
  } catch (error) {
    console.error("获取系统字体列表失败:", error);
  }
}

/** 设置指定类型（编辑器/代码）的字体，写回配置并立即应用到 DOM。 */
function setFont(type: FontType, font: Font) {
  setConf("font", `family.${type}`, normalizeFont(font));
  applyFont(getConf("font").family);
}

/** 设置指定类型的字号，写回配置并立即应用到 DOM。 */
function setFontSize(type: FontSizeType, fontSize: string) {
  setConf("font", `size.${type}`, fontSize);
  applyFontSize(getConf("font").size);
}

// 应用字体配置到 DOM 元素
function applyFont(fontConfig: FontConfig) {
  const puredownElement = document.querySelector("#fontRoot") as HTMLElement;
  if (!puredownElement) return;

  // 设置字体样式
  Object.entries(fontConfig).forEach(([type, font]) => {
    const cssVar = fontCssVariables[type as FontType];
    if (cssVar && font) {
      puredownElement.style.setProperty(cssVar, normalizeFontFamilyValue(font.value), "important");
    }
  });
}

function normalizeFont(font: Font): Font {
  return {
    ...font,
    value: normalizeFontFamilyValue(font.value),
  };
}

function normalizeFontFamilyValue(value: string): string {
  return value.trim().replace(/;+$/g, "").trim();
}

function applyFontSize(fontSizeConfig: FontSizeConfig) {
  const puredownElement = document.querySelector("#fontRoot") as HTMLElement;
  if (!puredownElement) return;

  Object.entries(fontSizeConfig).forEach(([type, fontSize]) => {
    const cssVar = fontSizeCssVariables[type as FontSizeType];
    if (cssVar && fontSize) {
      puredownElement.style.setProperty(cssVar, fontSize, "important");

      // get
      // const fontSize = window.getComputedStyle(document.documentElement).getPropertyValue(cssVar)
    }
  });
}

function normalizeFontConfig(fontConfig: FontConfig): FontConfig {
  return {
    "editor-font": normalizeFont(fontConfig["editor-font"]),
    "code-font": normalizeFont(fontConfig["code-font"]),
  };
}

/**
 * 提供字体/字号的状态与操作。
 * @returns fontList（系统字体选项）、currentFont、currentFontSize、fontSizeOptions 及 init/setFont/setFontSize。
 */
export default function useFont() {
  return {
    fontList,
    currentFont,
    currentFontSize,
    fontSizeOptions,
    init,
    setFont,
    setFontSize,
  };
}
