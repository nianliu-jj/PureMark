import { invoke, listen } from "@/composables/useTauri";

export interface StoredThemeFile {
  themes: unknown[];
  current?: string | null;
}

export async function loadCustomThemes(): Promise<StoredThemeFile> {
  return invoke<StoredThemeFile>("load_custom_themes");
}

export async function saveCustomTheme(theme: unknown): Promise<void> {
  await invoke<void>("save_custom_theme", { theme });
}

export async function removeCustomTheme(name: string): Promise<boolean> {
  return invoke<boolean>("remove_custom_theme", { name });
}

export async function getCurrentTheme(): Promise<string | null> {
  return invoke<string | null>("get_current_theme");
}

export async function setCurrentTheme(name: string): Promise<void> {
  await invoke<void>("set_current_theme", { args: { name } });
}

export async function openThemeEditor(): Promise<void> {
  await invoke<void>("open_theme_editor");
}

export type WindowControlAction = "minimize" | "maximize" | "close";
export async function themeEditorWindowControl(action: WindowControlAction): Promise<void> {
  await invoke<void>("theme_editor_window_control", { args: { action } });
}

/** 订阅 custom-theme-saved 广播事件。 */
export async function onCustomThemeSaved(handler: (theme: unknown) => void): Promise<() => void> {
  return listen<unknown>("custom-theme-saved", handler);
}

export async function onCustomThemeRemoved(handler: (name: string) => void): Promise<() => void> {
  return listen<string>("custom-theme-removed", handler);
}
