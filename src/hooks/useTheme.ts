/**
 * useTheme — 主题系统的模块级共享状态与业务逻辑。
 *
 * 负责内置主题（由 src/themes/＊/theme.less 经 import.meta.glob 收集，并从已加载样式表中
 * 提取 .theme-＊ 的 CSS 变量）与本地自定义主题（经 themeManager 持久化）的统一管理：
 *  - 加载/合并主题列表、按名查找、应用主题（切换 <html> 上的 theme-＊ 类、注入自定义 CSS、
 *    切换编辑器主题样式表 link），并将当前主题持久化；
 *  - 新增/编辑/删除/导入/导出自定义主题，临时主题 tempTheme 用于主题编辑器；
 *  - 监听 themeManager 的主题变化以同步列表，组件卸载时卸载监听。
 */
import type { Theme, ThemeName } from "@/types/theme";
import autotoast from "autotoast.js";
import { getCurrentInstance, onMounted, onUnmounted, ref, toRaw } from "vue";
import { cssVarsDesMap, themeNameMap } from "@/config/theme";
import { openThemeEditor as apiOpenThemeEditor } from "@/services/api";
import themeManager from "@/utils/themeManager";
import { randomUUID } from "@/utils/tool";
import { isThemeObject, normalizeTheme } from "@/types/theme";

const {
  localThemes,
  getLocalThemes,
  removeLocalTheme,
  addLocalTheme,
  onThemesChange,
  uninstallListeners,
  getCurrentLocalTheme,
  setCurrentLocalTheme,
  setEditingThemeToStorage,
  getEditingThemeFromStorage,
  clearEditingThemeFromStorage,
} = themeManager;
const currentTheme = ref<ThemeName>("normal");
const tempTheme = ref<Theme>();

const themes = ref<Theme[]>([]);

// 初始化主题：读取本地当前主题名并应用
function init() {
  // 获取本地当前应用的主题name
  currentTheme.value = getCurrentLocalTheme();

  // 应用主题
  setTheme();
}

// 获取主题列表：扫描内置主题文件夹，从样式表精确匹配 .theme-<name> 规则提取 CSS 变量
// （区分应用级与编辑器级 --crepe 变量），再合并本地自定义主题
function getThemes() {
  // 获取文件夹
  const themes = import.meta.glob("@/themes/*/theme.less", { eager: true });

  // 过滤出文件夹并生成主题名称
  const themeList: Theme[] = [];

  for (const path in themes) {
    const pathParts = path.split("/");
    const folderName = pathParts[pathParts.length - 2]; // 获取文件夹名

    // 所有css键和值
    const themeProperties: Record<string, string> = {};

    // 应用css键
    const appCssPropertiesArray: string[] = [];

    // 编辑器css键
    const puredownCssPropertiesArray: string[] = [];

    // 应用css属性
    const appCssProperties: Record<string, string> = {};

    // 编辑器css属性
    const puredownCssProperties: Record<string, string> = {};

    try {
      // 获取所有样式表
      const styleSheets = Array.from(document.styleSheets);

      // 查找主题
      const themeRules = styleSheets
        .flatMap((sheet) => {
          try {
            return Array.from(sheet.cssRules || sheet.rules);
          } catch {
            return [];
          }
        })
        .filter((rule) => {
          // ----------精确匹配主题类名------------------
          if (!(rule instanceof CSSStyleRule)) return false;

          const selectorText = rule.selectorText;
          if (!selectorText) return false;

          // eg：.theme-normal 不应该匹配到 .theme-normal-dark
          const exactThemeClass = `.theme-${folderName}`;

          const themeClassPattern = new RegExp(
            `${exactThemeClass.replace(".", "\\.")}(?=\\s|$|\\{|\\,|\\+)`
          );
          return themeClassPattern.test(selectorText);
        });

      // 提取CSS变量和属性，区分应用CSS和编辑器CSS
      themeRules.forEach((rule) => {
        if (rule instanceof CSSStyleRule) {
          const style = rule.style;
          for (let i = 0; i < style.length; i++) {
            const propertyName = style[i];
            const propertyValue = style.getPropertyValue(propertyName);

            // 区分应用CSS和编辑器CSS
            if (propertyName.startsWith("--crepe")) {
              // 编辑器CSS属性
              puredownCssProperties[propertyName] = propertyValue;
              puredownCssPropertiesArray.push(propertyName);
            } else {
              // 应用CSS属性
              appCssProperties[propertyName] = propertyValue;
              appCssPropertiesArray.push(propertyName);
            }

            // 总体css
            themeProperties[propertyName] = propertyValue;
          }
        }
      });
    } catch (error) {
      console.warn(`匹配主题错误:`, error);
    }

    if (folderName) {
      // 将文件夹名称转换为主题名称格式（将连字符转换为下划线）
      const themeName = folderName;
      themeList.unshift({
        name: themeName as ThemeName,
        label: themeNameMap[themeName as keyof typeof themeNameMap]?.label || themeName,
        description: themeNameMap[themeName as keyof typeof themeNameMap]?.description || "",
        data: {
          // 所有css
          themeProperties,
          // 应用css
          appCssProperties,
          appCssPropertiesArray,
          // 编辑器css
          puredownCssProperties,
          puredownCssPropertiesArray,
        },
      });
    }
  }

  // 合并本地主题
  const localThemesList = getLocalThemes();
  if (localThemesList && localThemesList.length > 0) {
    themeList.push(...localThemesList);
  }

  return themeList;
}

// 根据主题名查找主题，找不到回退第一个
function getThemeByCn(cn: ThemeName) {
  if (!themes.value.length) themes.value = getThemes();

  const theme = themes.value.find((item) => item.name === cn);

  if (!theme) return themes.value[0];

  return theme;
}

// 设置/应用主题：清理启动脚本内联样式与旧 theme-* 类，自定义主题则注入 <style>，
// 切换 <html> 的 theme-* 类与编辑器主题样式表 link，并持久化当前主题
function setTheme(theme: ThemeName = currentTheme.value) {
  // 确保只获取一次
  if (!themes.value.length) themes.value = getThemes();

  // 是否存在该主题
  const isHasTheme = themes.value.some((list) => list.name === theme);

  // 如果没有直接使用默认主题
  if (!isHasTheme) {
    theme = themes.value[0].name;
  }

  const html = document.documentElement;

  // 清除启动脚本设置的内联样式，避免覆盖主题类中的 CSS 变量
  html.style.removeProperty("--primary-color");
  html.style.removeProperty("background");

  // 移除所有以 theme- 开头的类名
  const allClasses = Array.from(html.classList);
  const themeClasses = allClasses.filter((className) => className.startsWith("theme-"));
  html.classList.remove(...themeClasses);

  // 移除之前可能存在的自定义主题样式
  const existingCustomStyle = document.getElementById("custom-theme-style");
  if (existingCustomStyle) {
    existingCustomStyle.remove();
  }

  // 查找当前主题数据
  const currentThemeData = themes.value.find((list) => list.name === theme);

  // 注入 CSS
  if (currentThemeData?.isCustom) {
    const style = document.createElement("style");
    style.id = "custom-theme-style";

    // 生成 CSS
    const cssVars = Object.entries(currentThemeData.data.themeProperties || {})
      .map(([key, value]) => `  ${key}: ${value};`)
      .join("\n");

    style.textContent = `.theme-${theme} {${cssVars}}`;
    document.head.appendChild(style);
  }

  // 应用
  html.classList.add(`theme-${theme}`);

  // 应用编辑器
  const id = "puredown-theme";
  let link = document.getElementById(id) as HTMLLinkElement | null;

  if (!link) {
    link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }

  const basePath = import.meta.env.BASE_URL;
  link.href = `${basePath}puredown-themes/${theme}/style.css`;

  currentTheme.value = theme;
  setCurrentLocalTheme(theme);
}

// 保存临时主题为本地主题
function saveTheme() {
  if (!tempTheme.value) return;

  // 转为普通变量
  const tempThemeData = toRaw(tempTheme.value);

  // 使用 themeManager 添加本地主题
  addLocalTheme(tempThemeData);

  // // 清空临时主题
  // tempTheme.value = undefined
}

// 进入主题编辑：传入 themeName 表示编辑现有主题（存入 localStorage 供编辑器读取）；
// 不传则基于当前主题派生一个临时自定义主题 tempTheme，然后打开主题编辑器窗口
function addTempTheme(themeName?: ThemeName) {
  // 如果传入了主题名称，说明是编辑现有主题
  if (themeName) {
    // 存储到 localStorage
    setEditingThemeToStorage(themeName);

    apiOpenThemeEditor().catch((e) => console.error("[useTheme] openThemeEditor failed:", e));
  } else {
    // 新增主题：基于当前主题创建新主题
    const themeList = themes.value.length ? themes.value : getThemes();

    let currentThemeData = themeList.find((item) => item.name === currentTheme.value);

    if (!currentThemeData) {
      // 就用列表第一个主题来生成
      currentThemeData = themes.value[0];
    }

    const appCssProperties = currentThemeData.data.appCssProperties;
    const puredownCssProperties = currentThemeData.data.puredownCssProperties;

    const themeProperties = {
      ...appCssProperties,
      ...puredownCssProperties,
    };

    const appCssPropertiesArray = Object.keys(appCssProperties);
    const puredownCssPropertiesArray = Object.keys(puredownCssProperties);

    const data = {
      appCssProperties,
      puredownCssProperties,
      themeProperties,
      appCssPropertiesArray,
      puredownCssPropertiesArray,
    };

    tempTheme.value = {
      name: `theme-custom-${randomUUID()}`,
      label: "自定义主题",
      description: "这是自定义主题，包含了用户自定义的css变量",
      isCustom: true,
      data,
    };
  }

  apiOpenThemeEditor().catch((e) => console.error("[useTheme] openThemeEditor failed:", e));
}

// 删除本地主题并刷新主题列表
function removeTheme(themeName: ThemeName) {
  removeLocalTheme(themeName);

  // 重新获取主题列表
  themes.value = getThemes();
}

// 获取所有css变量解释
function getAllCssVarsDes() {
  return cssVarsDesMap;
}

// 监听本地主题变化，返回取消监听函数
function watchLocalThemes(callback: (themes: Theme[] | null) => void) {
  return onThemesChange(callback);
}

// 副作用：本地主题变化时重新汇总主题列表，保持 themes 与持久化数据一致
onThemesChange((localThemesList) => {
  if (localThemesList) {
    themes.value = getThemes();
  }
});

// 导出主题为 JSON 文件并触发下载
function exportTheme(themeName: ThemeName) {
  const theme = getThemeByCn(themeName);
  const dataStr = JSON.stringify(theme, null, 2);
  const dataBlob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(dataBlob);

  // 创建下载元素
  const link = document.createElement("a");
  link.href = url;
  link.download = `${theme.label || theme.name}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  autotoast.show("导出完成", "success");
}

// 导入主题 JSON：解析归一化并校验类型后加入本地主题
function importTheme(theme: any) {
  // parse
  const themeData = normalizeTheme(JSON.parse(theme));

  // 检查是否为Theme类型
  const isTheme = isThemeObject(themeData);

  if (!isTheme) {
    autotoast.show("导入主题格式错误", "error");
  }

  // 添加到本地主题
  addLocalTheme(themeData);
  autotoast.show("导入主题完成", "success");
}

/**
 * 主题 hook 主入口。在组件上下文中于卸载时卸载 themeManager 监听；
 * 返回主题状态（themes/currentTheme/tempTheme/localThemes）与增删改查、监听、编辑、导入导出方法。
 */
export default function useTheme() {
  if (getCurrentInstance()) {
    onMounted(() => {});
    onUnmounted(() => {
      uninstallListeners();
    });
  }
  return {
    // 主题变量
    themes,
    currentTheme,
    tempTheme,
    localThemes,

    // 增删改查
    init,
    getThemes,
    setTheme,
    saveTheme,
    removeTheme,
    getAllCssVarsDes,
    addTempTheme,
    getThemeByCn,

    // 监听主题
    watchLocalThemes,

    // 编辑主题
    getEditingThemeFromStorage,
    clearEditingThemeFromStorage,
    setEditingThemeToStorage,

    // 导出导入主题
    exportTheme,
    importTheme,
  };
}
