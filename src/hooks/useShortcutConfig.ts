/**
 * useShortcutConfig — 快捷键配置 Hook。
 *
 * 基于内核默认快捷键（DEFAULT_SHORTCUTS）与用户在 useConfig.shortcuts 中的自定义覆盖，
 * 派生出完整的快捷键列表 shortcuts；并提供冲突检测（同一按键绑定多个动作）以及
 * 单项更新 / 清除 / 重置、全部重置等写入操作（均以不可变方式回写配置）。
 * 另导出两个工具函数：formatKeyForDisplay（ProseMirror key → 平台显示文案）、
 * keyEventToProseMirrorKey（KeyboardEvent → ProseMirror key，用于录制快捷键）。
 */

import { computed } from "vue";
import { useConfig } from "./useConfig";
import { DEFAULT_SHORTCUTS, CATEGORY_LABELS } from "@/core";
import type { ShortcutActionId, ShortcutDefinition } from "@/core";

/**
 * 提供快捷键的派生状态与读写操作。
 * @returns shortcuts（合并后的完整列表）、conflicts（冲突映射）、hasConflict/getConflictLabels（冲突查询）、
 *          updateShortcut/clearShortcut/resetShortcut/resetAll（写回配置）及 CATEGORY_LABELS（分类文案）。
 */
export function useShortcutConfig() {
  const { config } = useConfig();

  // 解析某动作的实际按键：未自定义返回默认值，自定义为 null/空表示「已清除绑定」。
  function getResolvedKey(id: ShortcutActionId, defaultKey: string): string {
    const customKey = config.value.shortcuts?.[id];
    return customKey === undefined ? defaultKey : (customKey ?? "");
  }

  /** 合并默认值和用户自定义值后的完整快捷键列表 */
  const shortcuts = computed<ShortcutDefinition[]>(() => {
    return DEFAULT_SHORTCUTS.map((def) => ({
      ...def,
      key: getResolvedKey(def.id, def.defaultKey),
    }));
  });

  /** 冲突检测：同一快捷键绑定了多个动作 */
  const conflicts = computed<Map<string, ShortcutActionId[]>>(() => {
    const keyToActions = new Map<string, ShortcutActionId[]>();
    for (const s of shortcuts.value) {
      if (!s.key) continue;
      const existing = keyToActions.get(s.key);
      if (existing) {
        existing.push(s.id);
      } else {
        keyToActions.set(s.key, [s.id]);
      }
    }
    // 只保留有冲突的
    const result = new Map<string, ShortcutActionId[]>();
    for (const [key, ids] of keyToActions) {
      if (ids.length > 1) {
        result.set(key, ids);
      }
    }
    return result;
  });

  /** 检查某个动作是否有冲突 */
  function hasConflict(id: ShortcutActionId): boolean {
    const s = shortcuts.value.find((s) => s.id === id);
    if (!s) return false;
    const conflicting = conflicts.value.get(s.key);
    return !!conflicting && conflicting.length > 1;
  }

  /** 获取与某个动作冲突的其他动作名称 */
  function getConflictLabels(id: ShortcutActionId): string[] {
    const s = shortcuts.value.find((s) => s.id === id);
    if (!s) return [];
    const conflicting = conflicts.value.get(s.key);
    if (!conflicting) return [];
    return conflicting
      .filter((cid) => cid !== id)
      .map((cid) => {
        const def = DEFAULT_SHORTCUTS.find((d) => d.id === cid);
        return def?.label || cid;
      });
  }

  /** 更新单个快捷键 */
  function updateShortcut(id: ShortcutActionId, newKey: string | null) {
    const current = { ...config.value.shortcuts };
    const def = DEFAULT_SHORTCUTS.find((d) => d.id === id);
    // 如果和默认值相同，删除自定义项
    if (def && newKey === def.defaultKey) {
      delete current[id];
    } else {
      current[id] = newKey;
    }
    config.value = { ...config.value, shortcuts: current };
  }

  /** 清除单个快捷键绑定 */
  function clearShortcut(id: ShortcutActionId) {
    updateShortcut(id, null);
  }

  /** 重置单个快捷键 */
  function resetShortcut(id: ShortcutActionId) {
    const current = { ...config.value.shortcuts };
    delete current[id];
    config.value = { ...config.value, shortcuts: current };
  }

  /** 重置所有快捷键 */
  function resetAll() {
    config.value = { ...config.value, shortcuts: {} };
  }

  return {
    shortcuts,
    conflicts,
    hasConflict,
    getConflictLabels,
    updateShortcut,
    clearShortcut,
    resetShortcut,
    resetAll,
    CATEGORY_LABELS,
  };
}

/**
 * 将 ProseMirror 格式的快捷键转为显示格式
 * 例如：Mod-b → Ctrl+B (Windows) / Cmd+B (Mac)
 */
export function formatKeyForDisplay(key: string): string {
  if (!key) return "未绑定";
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  return key
    .split("-")
    .map((part) => {
      if (part === "Mod") return isMac ? "Cmd" : "Ctrl";
      if (part === "Shift") return "Shift";
      if (part === "Alt") return isMac ? "Option" : "Alt";
      if (part === "minus") return "-";
      if (part === "/") return "/";
      if (part === "`") return "`";
      if (part.length === 1) return part.toUpperCase();
      return part;
    })
    .join("+");
}

/**
 * 将 KeyboardEvent 转为 ProseMirror 格式字符串（用于录制快捷键）
 */
export function keyEventToProseMirrorKey(event: KeyboardEvent): string | null {
  const parts: string[] = [];

  if (event.ctrlKey || event.metaKey) parts.push("Mod");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");

  let key = event.key;

  // 忽略单独的修饰键
  if (["Control", "Meta", "Shift", "Alt"].includes(key)) {
    return null;
  }

  // 标准化按键名
  if (key === "-") key = "minus";
  else if (key === "/") key = "/";
  else if (key === "`") key = "`";
  else if (key >= "0" && key <= "9") {
    /* 保持数字 */
  } else if (key.length === 1) key = key.toLowerCase();

  parts.push(key);

  // 至少需要一个修饰键
  if (!event.ctrlKey && !event.metaKey && !event.altKey) {
    return null;
  }

  return parts.join("-");
}
