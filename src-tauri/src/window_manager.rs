//! Tauri 多窗口状态管理器（对齐 src/main/windowManager.ts）。
//!
//! 三套核心状态：
//! - EDITOR_WINDOW_LABELS：label 集合的本地缓存
//! - PENDING_TAB_DATA：新窗口 label → 尚未被 renderer 消费的 tear-off 数据
//! - WINDOW_OPEN_FILES：窗口 label → 该窗口当前打开的文件路径集合（跨窗口文件去重索引）
//! 其他瞬态：WINDOW_CLOSING / WINDOW_SAVE_STATE 及后续 Milestone 追加的 drag / preview 状态。

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

use crate::tearoff::TearOffTabData;

// ─── 基础索引 ─────────────────────────────────────────────

static EDITOR_WINDOW_LABELS: Lazy<Mutex<HashSet<String>>> =
    Lazy::new(|| Mutex::new(HashSet::new()));

static PENDING_TAB_DATA: Lazy<Mutex<HashMap<String, TearOffTabData>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// 新窗口初始化时需要继承的 UI/工作区状态（侧边栏可见性、当前工作区等）。
///
/// 由创建方暂存到 `PENDING_WINDOW_INIT_STATE`，新窗口 renderer 就绪后取走消费。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInitState {
    pub workspace_path: Option<String>,
    pub file_sidebar_visible: Option<bool>,
    pub outline_sidebar_visible: Option<bool>,
    pub sidebar_visible: Option<bool>,
    pub sidebar_tab: Option<String>,
}

static PENDING_WINDOW_INIT_STATE: Lazy<Mutex<HashMap<String, WindowInitState>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

static WINDOW_OPEN_FILES: Lazy<Mutex<HashMap<String, HashSet<PathBuf>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

static WINDOW_CLOSING: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

static WINDOW_SAVE_STATE: Lazy<Mutex<HashMap<String, bool>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// 主窗口的固定 label（由 tauri.conf.json 静态声明）。
pub const MAIN_LABEL: &str = "main";

/// 登记一个编辑器窗口 label 到全局索引（窗口创建时调用）。
pub fn track_window(label: &str) {
    EDITOR_WINDOW_LABELS
        .lock()
        .unwrap()
        .insert(label.to_string());
}

/// 注销窗口并清理其在所有索引中的残留状态（窗口销毁时调用，防止内存泄漏）。
pub fn untrack_window(label: &str) {
    EDITOR_WINDOW_LABELS.lock().unwrap().remove(label);
    PENDING_TAB_DATA.lock().unwrap().remove(label);
    PENDING_WINDOW_INIT_STATE.lock().unwrap().remove(label);
    WINDOW_OPEN_FILES.lock().unwrap().remove(label);
    WINDOW_CLOSING.lock().unwrap().remove(label);
    WINDOW_SAVE_STATE.lock().unwrap().remove(label);
}

/// 返回当前所有已跟踪的编辑器窗口 label。
pub fn all_editor_labels() -> Vec<String> {
    EDITOR_WINDOW_LABELS
        .lock()
        .unwrap()
        .iter()
        .cloned()
        .collect()
}

/// 为新窗口暂存待消费的 tear-off 标签数据。
pub fn set_pending_tab_data(label: &str, data: TearOffTabData) {
    PENDING_TAB_DATA
        .lock()
        .unwrap()
        .insert(label.to_string(), data);
}

/// 取出并移除某窗口待消费的 tear-off 数据（仅能成功消费一次）。
pub fn consume_pending_tab_data(label: &str) -> Option<TearOffTabData> {
    PENDING_TAB_DATA.lock().unwrap().remove(label)
}

/// 为新窗口暂存待消费的初始化状态。
pub fn set_pending_window_init_state(label: &str, state: WindowInitState) {
    PENDING_WINDOW_INIT_STATE
        .lock()
        .unwrap()
        .insert(label.to_string(), state);
}

/// 取出并移除某窗口待消费的初始化状态（仅能成功消费一次）。
pub fn consume_pending_window_init_state(label: &str) -> Option<WindowInitState> {
    PENDING_WINDOW_INIT_STATE.lock().unwrap().remove(label)
}

/// 全量更新某窗口当前打开的文件集合，作为跨窗口文件去重索引的数据源。
pub fn update_window_open_files(label: &str, paths: Vec<PathBuf>) {
    WINDOW_OPEN_FILES
        .lock()
        .unwrap()
        .insert(label.to_string(), paths.into_iter().collect());
}

/// 返回已打开指定文件的窗口 label（O(N) 扫描；N = 当前窗口数，通常 < 10）。
pub fn find_window_with_file(file_path: &str, exclude_label: Option<&str>) -> Option<String> {
    let target = PathBuf::from(file_path);
    for (label, files) in WINDOW_OPEN_FILES.lock().unwrap().iter() {
        if Some(label.as_str()) == exclude_label {
            continue;
        }
        if files.contains(&target) {
            return Some(label.clone());
        }
    }
    None
}

/// 标记窗口进入关闭流程。返回 `true` 表示首次标记，`false` 表示此前已标记（用于关闭去重）。
pub fn mark_window_closing(label: &str) -> bool {
    WINDOW_CLOSING.lock().unwrap().insert(label.to_string())
}

/// 查询窗口是否已处于关闭流程中。
pub fn is_window_closing(label: &str) -> bool {
    WINDOW_CLOSING.lock().unwrap().contains(label)
}

/// 记录窗口的保存状态（是否全部已保存），供关闭确认逻辑判断是否需要弹框。
pub fn set_window_save_state(label: &str, is_saved: bool) {
    WINDOW_SAVE_STATE
        .lock()
        .unwrap()
        .insert(label.to_string(), is_saved);
}

/// 获取窗口保存状态，未初始化时默认 `true`（已保存）。
pub fn get_window_save_state(label: &str) -> bool {
    // 默认为 true（已保存），避免未初始化状态下的误弹框
    WINDOW_SAVE_STATE
        .lock()
        .unwrap()
        .get(label)
        .copied()
        .unwrap_or(true)
}

/// 返回除指定 label 外的其余所有编辑器窗口（用于「关闭其他窗口」等批处理）。
pub fn remaining_editor_windows_excluding(label: &str) -> Vec<String> {
    EDITOR_WINDOW_LABELS
        .lock()
        .unwrap()
        .iter()
        .filter(|l| l.as_str() != label)
        .cloned()
        .collect()
}

// ─── Tear-off drag follow 状态 ────────────────────────────

use std::sync::atomic::{AtomicBool, Ordering};

/// tear-off 拖拽中跟随光标移动的预览窗口状态。
///
/// 记录跟随窗口 label、来源窗口、被拖拽的标签数据、光标到窗口的偏移量，
/// 以及是否因合并预览而临时隐藏。
pub struct DragFollowState {
    pub window_label: String,
    pub source_label: Option<String>,
    pub tab_data: TearOffTabData,
    pub offset_x: f64,
    pub offset_y: f64,
    pub hidden_for_preview: bool,
}

static DRAG_FOLLOW: Lazy<Mutex<Option<DragFollowState>>> = Lazy::new(|| Mutex::new(None));
static DRAG_FOLLOW_RUNNING: AtomicBool = AtomicBool::new(false);

/// 设置当前的拖拽跟随状态。
pub fn set_drag_follow(state: DragFollowState) {
    *DRAG_FOLLOW.lock().unwrap() = Some(state);
}

/// 取出并清空拖拽跟随状态（拖拽结束时调用）。
pub fn take_drag_follow() -> Option<DragFollowState> {
    DRAG_FOLLOW.lock().unwrap().take()
}

/// 获取当前拖拽跟随窗口的 label。
pub fn drag_follow_label() -> Option<String> {
    DRAG_FOLLOW
        .lock()
        .unwrap()
        .as_ref()
        .map(|s| s.window_label.clone())
}

/// 设置跟随窗口是否因合并预览而隐藏。
pub fn drag_follow_set_hidden(hidden: bool) {
    if let Some(s) = DRAG_FOLLOW.lock().unwrap().as_mut() {
        s.hidden_for_preview = hidden;
    }
}

/// 标记跟随循环线程是否在运行（用原子量避免重复启动跟随循环）。
pub fn drag_follow_set_running(running: bool) {
    DRAG_FOLLOW_RUNNING.store(running, Ordering::SeqCst);
}

/// 查询跟随循环线程是否正在运行。
pub fn drag_follow_is_running() -> bool {
    DRAG_FOLLOW_RUNNING.load(Ordering::SeqCst)
}

// ─── 单 Tab 整窗拖拽状态 ──────────────────────────────────

/// 单标签窗口被整体拖拽时的状态（区别于 tear-off：整窗跟随而非生成预览）。
pub struct SingleTabDragState {
    pub window_label: String,
    pub tab_data: TearOffTabData,
    pub offset_x: f64,
    pub offset_y: f64,
}

static SINGLE_TAB_DRAG: Lazy<Mutex<Option<SingleTabDragState>>> = Lazy::new(|| Mutex::new(None));
static SINGLE_TAB_DRAG_RUNNING: AtomicBool = AtomicBool::new(false);

/// 设置当前单标签整窗拖拽状态。
pub fn set_single_tab_drag(state: SingleTabDragState) {
    *SINGLE_TAB_DRAG.lock().unwrap() = Some(state);
}

/// 取出并清空单标签整窗拖拽状态。
pub fn take_single_tab_drag() -> Option<SingleTabDragState> {
    SINGLE_TAB_DRAG.lock().unwrap().take()
}

/// 查询单标签拖拽循环线程是否正在运行。
pub fn single_tab_drag_is_running() -> bool {
    SINGLE_TAB_DRAG_RUNNING.load(Ordering::SeqCst)
}

/// 标记单标签拖拽循环线程是否在运行。
pub fn single_tab_drag_set_running(running: bool) {
    SINGLE_TAB_DRAG_RUNNING.store(running, Ordering::SeqCst);
}

// ─── 合并预览状态（sourceLabel → targetLabel）────────────

static MERGE_PREVIEW_TARGETS: Lazy<Mutex<HashMap<String, String>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// 查询某来源窗口当前悬停命中的合并目标窗口。
pub fn get_merge_preview_target(source_label: &str) -> Option<String> {
    MERGE_PREVIEW_TARGETS
        .lock()
        .unwrap()
        .get(source_label)
        .cloned()
}

/// 设置或清除来源窗口的合并预览目标（传 `None` 表示清除）。
pub fn set_merge_preview_target(source_label: &str, target_label: Option<String>) {
    let mut map = MERGE_PREVIEW_TARGETS.lock().unwrap();
    match target_label {
        Some(t) => {
            map.insert(source_label.to_string(), t);
        }
        None => {
            map.remove(source_label);
        }
    }
}

// ─── UT ───────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_tab(id: &str) -> TearOffTabData {
        TearOffTabData {
            id: id.into(),
            name: "x.md".into(),
            file_path: Some("/tmp/x.md".into()),
            source_label: None,
            content: "".into(),
            original_content: "".into(),
            is_modified: false,
            scroll_ratio: None,
            read_only: false,
            file_traits: None,
        }
    }

    #[test]
    fn track_and_untrack_window() {
        track_window("wm-ut-main");
        track_window("wm-ut-editor-abc");
        assert!(all_editor_labels().contains(&"wm-ut-main".to_string()));
        untrack_window("wm-ut-editor-abc");
        assert!(!all_editor_labels().contains(&"wm-ut-editor-abc".to_string()));
        untrack_window("wm-ut-main");
    }

    #[test]
    fn pending_tab_data_consumed_once() {
        set_pending_tab_data("wm-ut-editor-xyz", sample_tab("t1"));
        assert!(consume_pending_tab_data("wm-ut-editor-xyz").is_some());
        assert!(consume_pending_tab_data("wm-ut-editor-xyz").is_none());
    }

    #[test]
    fn find_window_with_file_indexes_by_label() {
        update_window_open_files(
            "wm-ut-main2",
            vec![PathBuf::from("/tmp/a.md"), PathBuf::from("/tmp/b.md")],
        );
        update_window_open_files("wm-ut-editor-2", vec![PathBuf::from("/tmp/c.md")]);

        assert_eq!(
            find_window_with_file("/tmp/b.md", None),
            Some("wm-ut-main2".into())
        );
        assert_eq!(
            find_window_with_file("/tmp/b.md", Some("wm-ut-main2")),
            None,
            "exclude_label 应把 main 排除"
        );
        assert_eq!(
            find_window_with_file("/tmp/c.md", Some("wm-ut-main2")),
            Some("wm-ut-editor-2".into())
        );
        assert_eq!(find_window_with_file("/tmp/nope.md", None), None);
        untrack_window("wm-ut-main2");
        untrack_window("wm-ut-editor-2");
    }

    #[test]
    fn window_closing_dedup() {
        assert!(mark_window_closing("wm-ut-editor-close"));
        assert!(!mark_window_closing("wm-ut-editor-close"), "二次 mark 应返回 false");
        assert!(is_window_closing("wm-ut-editor-close"));
        untrack_window("wm-ut-editor-close");
    }

    #[test]
    fn save_state_defaults_to_saved() {
        assert!(get_window_save_state("wm-ut-never-seen"));
        set_window_save_state("wm-ut-editor-save9", false);
        assert!(!get_window_save_state("wm-ut-editor-save9"));
        untrack_window("wm-ut-editor-save9");
    }

    #[test]
    fn merge_preview_target_set_and_clear() {
        set_merge_preview_target("wm-ut-src", Some("wm-ut-tgt".into()));
        assert_eq!(get_merge_preview_target("wm-ut-src"), Some("wm-ut-tgt".into()));
        set_merge_preview_target("wm-ut-src", None);
        assert_eq!(get_merge_preview_target("wm-ut-src"), None);
    }
}
