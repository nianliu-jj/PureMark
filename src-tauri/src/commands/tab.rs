//! Tab 级 commands：tear-off / 合并 / 跨窗口去重 / 初始数据 / 单 Tab 拖拽。
//!
//! 拖拽跟随的核心机制：在后台 tokio 任务里以约 60fps 轮询全局鼠标位置，
//! 让跟随窗口贴住光标，并对其他窗口做 hit-test 以触发「合并预览」高亮，
//! 拖拽结束时根据是否命中目标窗口决定「合并到目标」或「保留为独立窗口」。

use std::time::Duration;

use mouse_position::mouse_position::Mouse;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition};
use tokio::time::sleep;

use crate::commands::window::{CreateEditorWindowArgs, create_editor_window};
use crate::error::{AppError, AppResult};
use crate::tearoff::TearOffTabData;
use crate::window_manager::{
    self, DragFollowState, drag_follow_is_running, drag_follow_set_hidden, drag_follow_set_running,
    get_merge_preview_target, set_drag_follow, set_merge_preview_target, take_drag_follow,
};

// ─── M2 已有：初始数据 + 跨窗口文件去重 ─────────────────

/// 取出新窗口待消费的 tear-off 标签初始数据；若该标签为已修改状态，同步标记窗口为未保存。
#[tauri::command]
pub async fn tab_get_init_data(
    _app: AppHandle,
    label: String,
) -> AppResult<Option<TearOffTabData>> {
    let data = window_manager::consume_pending_tab_data(&label);
    if let Some(d) = &data {
        if d.is_modified {
            window_manager::set_window_save_state(&label, false);
        }
    }
    Ok(data)
}

/// `file_focus_if_open` 的结果：是否在其他窗口找到了该文件。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusResult {
    pub found: bool,
}

/// 跨窗口文件去重：若指定文件已在其他窗口打开，则聚焦该窗口并激活对应 Tab，返回是否命中。
///
/// 副作用：命中时 emit `tab:activate-file` 并 `set_focus` 目标窗口。
#[tauri::command]
pub async fn file_focus_if_open(
    app: AppHandle,
    file_path: String,
    source_label: String,
) -> AppResult<FocusResult> {
    let Some(target_label) =
        window_manager::find_window_with_file(&file_path, Some(&source_label))
    else {
        return Ok(FocusResult { found: false });
    };
    let Some(target) = app.get_webview_window(&target_label) else {
        return Ok(FocusResult { found: false });
    };
    app.emit_to(target_label.as_str(), "tab:activate-file", &file_path)
        .map_err(|e| AppError::Other(anyhow::anyhow!("emit tab:activate-file: {e}")))?;
    target
        .set_focus()
        .map_err(|e| AppError::Other(anyhow::anyhow!("set_focus: {e}")))?;
    Ok(FocusResult { found: true })
}

// ─── 内部工具：hit-test + 合并预览维护 ────────────────────

/// 命中测试：在所有编辑器窗口中找出包含给定屏幕坐标、且不在排除列表中的窗口 label。
fn hit_test_target(
    app: &AppHandle,
    screen_x: i32,
    screen_y: i32,
    exclude_labels: &[&str],
) -> Option<String> {
    for label in window_manager::all_editor_labels() {
        if exclude_labels.contains(&label.as_str()) {
            continue;
        }
        let Some(win) = app.get_webview_window(&label) else {
            continue;
        };
        let Ok(pos) = win.outer_position() else {
            continue;
        };
        let Ok(size) = win.outer_size() else {
            continue;
        };
        if screen_x >= pos.x
            && screen_x <= pos.x + size.width as i32
            && screen_y >= pos.y
            && screen_y <= pos.y + size.height as i32
        {
            return Some(label);
        }
    }
    None
}

/// 维护合并预览高亮：目标窗口变化时向旧目标发 cancel、向新目标发 preview，
/// 目标未变时仅发 update 跟随光标。记录当前 source→target 映射供拖拽结束时复用。
fn update_merge_preview(
    app: &AppHandle,
    source_label: &str,
    target_label: Option<String>,
    tab_data: &TearOffTabData,
    screen_x: i32,
    screen_y: i32,
) {
    let prev = get_merge_preview_target(source_label);
    if prev == target_label {
        if let Some(tgt) = &target_label {
            let _ = app.emit_to(tgt.as_str(), "tab:merge-preview-update", (screen_x, screen_y));
        }
        return;
    }

    if let Some(prev_label) = prev {
        let _ = app.emit_to(prev_label.as_str(), "tab:merge-preview-cancel", ());
    }

    if let Some(tgt) = &target_label {
        let _ = app.emit_to(
            tgt.as_str(),
            "tab:merge-preview",
            (tab_data, screen_x, screen_y),
        );
    }

    set_merge_preview_target(source_label, target_label);
}

// ─── M3：多 Tab tear-off ──────────────────────────────────

/// `tab_tear_off_start` 的入参：被拖出的标签数据、光标屏幕坐标、光标到窗口偏移、来源窗口。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TearOffStartArgs {
    pub tab_data: TearOffTabData,
    /// 浏览器 screenX/Y 在高 DPI 屏上是 f64（如 636.666…）；这里用 f64 接收后内部转 i32。
    pub screen_x: f64,
    pub screen_y: f64,
    pub offset_x: f64,
    pub offset_y: f64,
    pub source_label: String,
}

/// 开始多 Tab tear-off：立即创建一个跟随光标的新窗口承载被拖出的标签，
/// 并启动后台轮询任务持续更新窗口位置与合并预览，直到拖拽结束。
///
/// 副作用：创建编辑器窗口、设置全局拖拽跟随状态、spawn 轮询任务（命中目标时隐藏跟随窗口）。
#[tauri::command]
pub async fn tab_tear_off_start(app: AppHandle, args: TearOffStartArgs) -> AppResult<bool> {
    drag_follow_set_running(false);
    take_drag_follow();

    let screen_x = args.screen_x as i32;
    let screen_y = args.screen_y as i32;

    let create_args = CreateEditorWindowArgs {
        x: Some(screen_x - args.offset_x as i32),
        y: Some(screen_y - args.offset_y as i32),
        width: None,
        height: None,
        tab_data: Some(args.tab_data.clone()),
        init_state: None,
        fast_create: true,
    };
    let created = create_editor_window(app.clone(), create_args).await?;

    set_drag_follow(DragFollowState {
        window_label: created.label.clone(),
        source_label: Some(args.source_label.clone()),
        tab_data: args.tab_data.clone(),
        offset_x: args.offset_x,
        offset_y: args.offset_y,
        hidden_for_preview: false,
    });

    drag_follow_set_running(true);

    let app_for_task = app.clone();
    let source_label = args.source_label.clone();
    let follow_label = created.label.clone();
    let tab_data = args.tab_data.clone();
    let offset_x = args.offset_x;
    let offset_y = args.offset_y;

    tokio::spawn(async move {
        let mut prev = (i32::MIN, i32::MIN);
        while drag_follow_is_running() {
            sleep(Duration::from_millis(16)).await;
            if !drag_follow_is_running() {
                break;
            }
            let (x, y) = match Mouse::get_mouse_position() {
                Mouse::Position { x, y } => (x, y),
                Mouse::Error => continue,
            };
            if (x, y) == prev {
                continue;
            }
            prev = (x, y);

            if let Some(win) = app_for_task.get_webview_window(&follow_label) {
                let _ = win.set_position(PhysicalPosition::new(
                    x as f64 - offset_x,
                    y as f64 - offset_y,
                ));
            }

            let target_label =
                hit_test_target(&app_for_task, x, y, &[&source_label, &follow_label]);

            update_merge_preview(
                &app_for_task,
                &source_label,
                target_label.clone(),
                &tab_data,
                x,
                y,
            );

            if let Some(follow_win) = app_for_task.get_webview_window(&follow_label) {
                if target_label.is_some() {
                    let _ = follow_win.hide();
                    drag_follow_set_hidden(true);
                } else {
                    let _ = follow_win.show();
                    drag_follow_set_hidden(false);
                }
            }
        }
    });

    Ok(true)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TearOffEndArgs {
    /// 浏览器 screenX/Y 在高 DPI 屏上是 f64；这里用 f64 接收后内部转 i32。
    pub screen_x: f64,
    pub screen_y: f64,
    pub source_label: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TearOffEndResult {
    pub action: String, // "created" | "merged" | "failed"
}

#[tauri::command]
pub async fn tab_tear_off_end(app: AppHandle, args: TearOffEndArgs) -> AppResult<TearOffEndResult> {
    drag_follow_set_running(false);
    let Some(state) = take_drag_follow() else {
        return Ok(TearOffEndResult {
            action: "failed".into(),
        });
    };

    let screen_x = args.screen_x as i32;
    let screen_y = args.screen_y as i32;

    // 1) 若已有合并预览 target → finalize + 销毁跟随窗口
    if let Some(target_label) = get_merge_preview_target(&args.source_label) {
        let _ = app.emit_to(target_label.as_str(), "tab:merge-preview-finalize", ());
        if let Some(target) = app.get_webview_window(&target_label) {
            let _ = target.set_focus();
        }
        set_merge_preview_target(&args.source_label, None);
        if let Some(follow) = app.get_webview_window(&state.window_label) {
            let _ = follow.destroy();
        }
        return Ok(TearOffEndResult {
            action: "merged".into(),
        });
    }

    // 2) 按光标坐标再次 hit-test
    let target = hit_test_target(
        &app,
        screen_x,
        screen_y,
        &[&args.source_label, &state.window_label],
    );
    if let Some(target_label) = target {
        let _ = app.emit_to(target_label.as_str(), "tab:merge-in", &state.tab_data);
        if let Some(target) = app.get_webview_window(&target_label) {
            let _ = target.set_focus();
        }
        if let Some(follow) = app.get_webview_window(&state.window_label) {
            let _ = follow.destroy();
        }
        return Ok(TearOffEndResult {
            action: "merged".into(),
        });
    }

    // 3) 保留跟随窗口作为独立窗口；显示并延迟 200ms 获取焦点
    if let Some(follow) = app.get_webview_window(&state.window_label) {
        let _ = follow.show();
        let follow_clone = follow.clone();
        tokio::spawn(async move {
            sleep(Duration::from_millis(200)).await;
            let _ = follow_clone.set_focus();
        });
    }
    Ok(TearOffEndResult {
        action: "created".into(),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TearOffCancelArgs {
    pub source_label: String,
}

#[tauri::command]
pub async fn tab_tear_off_cancel(
    app: AppHandle,
    args: TearOffCancelArgs,
) -> AppResult<bool> {
    drag_follow_set_running(false);
    let state = take_drag_follow();

    if let Some(target_label) = get_merge_preview_target(&args.source_label) {
        let _ = app.emit_to(target_label.as_str(), "tab:merge-preview-cancel", ());
        set_merge_preview_target(&args.source_label, None);
    }

    if let Some(state) = state {
        if let Some(win) = app.get_webview_window(&state.window_label) {
            let _ = win.destroy();
        }
    }

    Ok(true)
}

// ─── M4：单 Tab 整窗跟随拖拽 ─────────────────────────────

use crate::window_manager::{
    SingleTabDragState, set_single_tab_drag, single_tab_drag_is_running,
    single_tab_drag_set_running, take_single_tab_drag,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowStartDragArgs {
    pub tab_data: TearOffTabData,
    pub offset_x: f64,
    pub offset_y: f64,
    pub source_label: String,
}

#[tauri::command]
pub async fn window_start_drag(app: AppHandle, args: WindowStartDragArgs) -> AppResult<()> {
    // 清理可能残留
    single_tab_drag_set_running(false);
    let _ = take_single_tab_drag();

    set_single_tab_drag(SingleTabDragState {
        window_label: args.source_label.clone(),
        tab_data: args.tab_data.clone(),
        offset_x: args.offset_x,
        offset_y: args.offset_y,
    });

    single_tab_drag_set_running(true);

    let app_clone = app.clone();
    let source_label = args.source_label.clone();
    let tab_data = args.tab_data.clone();
    let offset_x = args.offset_x;
    let offset_y = args.offset_y;

    tokio::spawn(async move {
        let mut prev = (i32::MIN, i32::MIN);
        while single_tab_drag_is_running() {
            sleep(Duration::from_millis(16)).await;
            if !single_tab_drag_is_running() {
                break;
            }
            let (x, y) = match Mouse::get_mouse_position() {
                Mouse::Position { x, y } => (x, y),
                Mouse::Error => continue,
            };
            if (x, y) == prev {
                continue;
            }
            prev = (x, y);

            let Some(win) = app_clone.get_webview_window(&source_label) else {
                break;
            };

            // 合并预览 hit-test（排除自己）
            let target = hit_test_target(&app_clone, x, y, &[&source_label]);
            update_merge_preview(&app_clone, &source_label, target.clone(), &tab_data, x, y);

            // 位置跟随。Tauri 2.10 没有 set_opacity，不做透明化；合并预览由目标窗口的虚线
            // Tab 提供视觉反馈。
            let _ = win.set_position(PhysicalPosition::new(
                x as f64 - offset_x,
                y as f64 - offset_y,
            ));
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn window_stop_drag(_app: AppHandle) -> AppResult<()> {
    single_tab_drag_set_running(false);
    let _ = take_single_tab_drag();
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowDropMergeArgs {
    pub tab_data: TearOffTabData,
    /// 浏览器 screenX/Y 在高 DPI 屏上是 f64；这里用 f64 接收后内部转 i32。
    pub screen_x: f64,
    pub screen_y: f64,
    pub source_label: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowDropMergeResult {
    pub action: String, // "merged" | "none"
}

#[tauri::command]
pub async fn window_drop_merge(
    app: AppHandle,
    args: WindowDropMergeArgs,
) -> AppResult<WindowDropMergeResult> {
    let screen_x = args.screen_x as i32;
    let screen_y = args.screen_y as i32;

    // 1) 若已有合并预览 target → finalize
    if let Some(target_label) = get_merge_preview_target(&args.source_label) {
        let _ = app.emit_to(target_label.as_str(), "tab:merge-preview-finalize", ());
        if let Some(win) = app.get_webview_window(&target_label) {
            let _ = win.set_focus();
        }
        set_merge_preview_target(&args.source_label, None);
        return Ok(WindowDropMergeResult {
            action: "merged".into(),
        });
    }

    // 2) 按光标 hit-test
    if let Some(target_label) = hit_test_target(&app, screen_x, screen_y, &[&args.source_label]) {
        let _ = app.emit_to(target_label.as_str(), "tab:merge-in", &args.tab_data);
        if let Some(win) = app.get_webview_window(&target_label) {
            let _ = win.set_focus();
        }
        return Ok(WindowDropMergeResult {
            action: "merged".into(),
        });
    }

    // 3) 无目标 → 清理预览状态
    set_merge_preview_target(&args.source_label, None);
    Ok(WindowDropMergeResult {
        action: "none".into(),
    })
}
