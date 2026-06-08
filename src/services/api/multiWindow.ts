/**
 * 多窗口 / 标签页跨窗能力封装层（services/api）。
 *
 * 作为渲染层访问 Tauri 多窗口系统能力的统一入口，覆盖：
 * 新建编辑器窗口、读取窗口初始状态/边界、保存状态与打开文件同步，
 * 以及标签页（tab）在窗口间的"撕离（tear-off）/合并预览/整窗拖拽"全套跨窗交互。
 * 里程碑分段（M2~M4）对应宿主层逐步实现的跨窗功能。
 */
import type { TearOffTabData } from "@/shared/types/tearoff";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** 创建编辑器窗口的入参（位置、尺寸、初始 tab/状态、是否快速创建）。 */
export interface CreateEditorWindowArgs {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** 新窗口初始携带的标签页数据（如撕离出去的 tab） */
  tabData?: TearOffTabData | null;
  /** 新窗口的初始 UI 状态（工作区、侧边栏等） */
  initState?: WindowInitState | null;
  /** 是否走快速创建路径（跳过部分初始化以更快显示） */
  fastCreate?: boolean;
}

/** 创建窗口后返回的标识。 */
export interface CreatedWindow {
  /** 新窗口的 label */
  label: string;
}

/** 窗口初始 UI 状态。 */
export interface WindowInitState {
  workspacePath?: string | null;
  fileSidebarVisible?: boolean;
  outlineSidebarVisible?: boolean;
  sidebarVisible?: boolean;
  sidebarTab?: "outline" | "file";
}

/**
 * 创建一个新的编辑器窗口。
 *
 * @param args 创建参数，见 {@link CreateEditorWindowArgs}
 * @returns 新窗口标识，见 {@link CreatedWindow}
 * @remarks 调用 Tauri command `create_editor_window`
 */
export async function createEditorWindow(args: CreateEditorWindowArgs): Promise<CreatedWindow> {
  return invoke<CreatedWindow>("create_editor_window", { args });
}

/**
 * 读取指定窗口的初始 UI 状态。
 *
 * @param label 目标窗口 label；省略时取当前窗口
 * @returns 初始状态，无则返回 null
 * @remarks 调用 Tauri command `get_window_init_state`
 */
export async function getWindowInitState(label?: string): Promise<WindowInitState | null> {
  const target = label ?? getCurrentWindow().label;
  return invoke<WindowInitState | null>("get_window_init_state", { label: target });
}

/** 窗口位置与尺寸。 */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 读取指定窗口的位置与尺寸。
 *
 * @param label 目标窗口 label；省略时取当前窗口
 * @returns 窗口边界，无则返回 null
 * @remarks 调用 Tauri command `get_window_bounds`
 */
export async function getWindowBounds(label?: string): Promise<WindowBounds | null> {
  const target = label ?? getCurrentWindow().label;
  return invoke<WindowBounds | null>("get_window_bounds", { label: target });
}

/**
 * 同步当前文档的保存状态到宿主（用于标题栏修改标记等）。
 *
 * @param isSaved 是否已保存
 * @param label 目标窗口 label；省略时取当前窗口
 * @remarks 调用 Tauri command `change_save_status`
 */
export async function changeSaveStatus(isSaved: boolean, label?: string): Promise<void> {
  const target = label ?? getCurrentWindow().label;
  await invoke("change_save_status", { label: target, isSaved });
}

/**
 * 同步窗口当前打开的文件路径集合到宿主（用于跨窗口去重定位）。
 *
 * @param paths 当前窗口打开的文件路径数组
 * @param label 目标窗口 label；省略时取当前窗口
 * @remarks 调用 Tauri command `update_window_open_files_cmd`
 */
export async function updateWindowOpenFiles(paths: string[], label?: string): Promise<void> {
  const target = label ?? getCurrentWindow().label;
  await invoke("update_window_open_files_cmd", { label: target, paths });
}

/**
 * 返回当前窗口的 label。
 *
 * @returns 当前窗口标识
 */
export function currentWindowLabel(): string {
  return getCurrentWindow().label;
}

// ── M2：新窗口初始化 + 跨窗口文件去重 ─────────────────────

/**
 * 读取新窗口初始携带的标签页数据（如由撕离创建的窗口）。
 *
 * @param label 目标窗口 label；省略时取当前窗口
 * @returns 初始标签页数据，无则返回 null
 * @remarks 调用 Tauri command `tab_get_init_data`
 */
export async function getInitialTabData(label?: string): Promise<TearOffTabData | null> {
  const target = label ?? getCurrentWindow().label;
  return invoke<TearOffTabData | null>("tab_get_init_data", { label: target });
}

/**
 * 若某文件已在其它窗口打开，则聚焦该窗口（跨窗口去重，避免重复打开）。
 *
 * @param filePath 待定位的文件绝对路径
 * @returns `{ found }`：是否已在其它窗口找到并聚焦
 * @remarks 调用 Tauri command `file_focus_if_open`
 */
export async function focusFileIfOpen(filePath: string): Promise<{ found: boolean }> {
  const sourceLabel = getCurrentWindow().label;
  return invoke<{ found: boolean }>("file_focus_if_open", { filePath, sourceLabel });
}

/**
 * 监听"激活某文件"事件（其它窗口请求本窗口切到指定文件）。
 *
 * @param cb 收到文件路径时的回调
 * @returns 取消监听函数
 * @remarks 监听窗口事件 `tab:activate-file`
 */
export async function onActivateFile(cb: (filePath: string) => void): Promise<UnlistenFn> {
  return getCurrentWindow().listen<string>("tab:activate-file", (event) => {
    cb(event.payload);
  });
}

// ── M3：tear-off + 合并预览 ──────────────────────────────

/**
 * 开始撕离标签页：从当前窗口拖出某个 tab，进入跨窗拖拽状态。
 *
 * @param tabData 被撕离的标签页数据
 * @param screenX 当前指针屏幕 X 坐标
 * @param screenY 当前指针屏幕 Y 坐标
 * @param offsetX 指针相对 tab 的 X 偏移
 * @param offsetY 指针相对 tab 的 Y 偏移
 * @returns 是否成功进入撕离状态
 * @remarks 调用 Tauri command `tab_tear_off_start`
 */
export async function tearOffTabStart(
  tabData: TearOffTabData,
  screenX: number,
  screenY: number,
  offsetX: number,
  offsetY: number
): Promise<boolean> {
  const sourceLabel = getCurrentWindow().label;
  return invoke<boolean>("tab_tear_off_start", {
    args: { tabData, screenX, screenY, offsetX, offsetY, sourceLabel },
  });
}

/**
 * 结束撕离：在松手位置决定新建窗口、合并到目标窗口或失败。
 *
 * @param screenX 松手时屏幕 X 坐标
 * @param screenY 松手时屏幕 Y 坐标
 * @returns `{ action }`：created（新建窗口）/ merged（合并到已有窗口）/ failed
 * @remarks 调用 Tauri command `tab_tear_off_end`
 */
export async function tearOffTabEnd(
  screenX: number,
  screenY: number
): Promise<{ action: "created" | "merged" | "failed" }> {
  const sourceLabel = getCurrentWindow().label;
  return invoke<{ action: "created" | "merged" | "failed" }>("tab_tear_off_end", {
    args: { screenX, screenY, sourceLabel },
  });
}

/**
 * 取消正在进行的撕离操作。
 *
 * @returns 是否成功取消
 * @remarks 调用 Tauri command `tab_tear_off_cancel`
 */
export async function tearOffTabCancel(): Promise<boolean> {
  const sourceLabel = getCurrentWindow().label;
  return invoke<boolean>("tab_tear_off_cancel", { args: { sourceLabel } });
}

/**
 * 监听"合并预览"开始事件：有 tab 拖到本窗口上方，需展示合并预览。
 *
 * @param cb 回调，提供标签页数据与屏幕坐标
 * @returns 取消监听函数
 * @remarks 监听窗口事件 `tab:merge-preview`
 */
export async function onTabMergePreview(
  cb: (tabData: TearOffTabData, screenX: number, screenY: number) => void
): Promise<UnlistenFn> {
  return getCurrentWindow().listen<[TearOffTabData, number, number]>(
    "tab:merge-preview",
    (event) => {
      const [data, x, y] = event.payload;
      cb(data, x, y);
    }
  );
}

/**
 * 监听"合并预览"坐标更新事件：拖拽过程中指针移动。
 *
 * @param cb 回调，提供最新屏幕坐标
 * @returns 取消监听函数
 * @remarks 监听窗口事件 `tab:merge-preview-update`
 */
export async function onTabMergePreviewUpdate(
  cb: (screenX: number, screenY: number) => void
): Promise<UnlistenFn> {
  return getCurrentWindow().listen<[number, number]>("tab:merge-preview-update", (event) => {
    const [x, y] = event.payload;
    cb(x, y);
  });
}

/**
 * 监听"合并预览取消"事件：拖拽离开本窗口，应隐藏预览。
 *
 * @param cb 回调
 * @returns 取消监听函数
 * @remarks 监听窗口事件 `tab:merge-preview-cancel`
 */
export async function onTabMergePreviewCancel(cb: () => void): Promise<UnlistenFn> {
  return getCurrentWindow().listen("tab:merge-preview-cancel", () => cb());
}

/**
 * 监听"合并预览确认"事件：在本窗口松手，预览将转为真正的合并。
 *
 * @param cb 回调
 * @returns 取消监听函数
 * @remarks 监听窗口事件 `tab:merge-preview-finalize`
 */
export async function onTabMergePreviewFinalize(cb: () => void): Promise<UnlistenFn> {
  return getCurrentWindow().listen("tab:merge-preview-finalize", () => cb());
}

/**
 * 监听"合并进入"事件：一个标签页正式合并进本窗口，需在前端创建该 tab。
 *
 * @param cb 回调，提供被合并进来的标签页数据
 * @returns 取消监听函数
 * @remarks 监听窗口事件 `tab:merge-in`
 */
export async function onTabMergeIn(cb: (tabData: TearOffTabData) => void): Promise<UnlistenFn> {
  return getCurrentWindow().listen<TearOffTabData>("tab:merge-in", (event) => {
    cb(event.payload);
  });
}

// ── M4：单 Tab 整窗拖拽 ─────────────────────────────────

/**
 * 开始整窗拖拽：当窗口仅剩单个 tab 时，直接拖动整个窗口参与合并。
 *
 * @param tabData 当前唯一标签页数据
 * @param offsetX 指针相对窗口的 X 偏移
 * @param offsetY 指针相对窗口的 Y 偏移
 * @remarks 调用 Tauri command `window_start_drag`
 */
export async function startWindowDrag(
  tabData: TearOffTabData,
  offsetX: number,
  offsetY: number
): Promise<void> {
  const sourceLabel = getCurrentWindow().label;
  await invoke("window_start_drag", { args: { tabData, offsetX, offsetY, sourceLabel } });
}

/**
 * 停止整窗拖拽。
 *
 * @remarks 调用 Tauri command `window_stop_drag`
 */
export async function stopWindowDrag(): Promise<void> {
  await invoke("window_stop_drag");
}

/**
 * 整窗拖拽松手：尝试将该窗口的 tab 合并到落点窗口。
 *
 * @param tabData 被拖拽窗口的标签页数据
 * @param screenX 松手屏幕 X 坐标
 * @param screenY 松手屏幕 Y 坐标
 * @returns `{ action }`：merged（已合并）/ none（未命中目标）
 * @remarks 调用 Tauri command `window_drop_merge`
 */
export async function dropMerge(
  tabData: TearOffTabData,
  screenX: number,
  screenY: number
): Promise<{ action: "merged" | "none" }> {
  const sourceLabel = getCurrentWindow().label;
  return invoke<{ action: "merged" | "none" }>("window_drop_merge", {
    args: { tabData, screenX, screenY, sourceLabel },
  });
}
