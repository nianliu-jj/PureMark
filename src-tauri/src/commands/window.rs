//! 编辑器窗口生命周期 commands。对齐原 `src/main/windowManager.ts::createEditorWindow`。

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::tearoff::TearOffTabData;
use crate::window_manager::{self, WindowInitState};

/// `create_editor_window` 的入参：窗口位置/尺寸、可选携带的标签数据与初始状态、是否抢焦点。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEditorWindowArgs {
    /// 屏幕物理坐标 X（窗口左上角）
    pub x: Option<i32>,
    /// 屏幕物理坐标 Y
    pub y: Option<i32>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    /// 若提供，窗口启动后调用 `tab_get_init_data` 可取回
    pub tab_data: Option<TearOffTabData>,
    /// 若提供，窗口启动后可取回工作区 / 侧边栏初始状态
    pub init_state: Option<WindowInitState>,
    /// true = 不抢焦点（拖拽跟随窗口用）
    #[serde(default)]
    pub fast_create: bool,
}

/// 创建编辑器窗口返回值：新窗口的唯一 label。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedWindow {
    pub label: String,
}

/// 运行时创建一个新的编辑器窗口（无边框透明），并登记到 `window_manager`。
///
/// 副作用：暂存待消费的 tab_data / init_state、注册销毁回调以自动 untrack、
/// 同步设置位置后再显示（规避多屏跳屏），按 `fast_create` 决定是否抢焦点。
/// 返回新窗口 label。
#[tauri::command]
pub async fn create_editor_window(
    app: AppHandle,
    args: CreateEditorWindowArgs,
) -> AppResult<CreatedWindow> {
    let label = format!("editor-{}", Uuid::new_v4());
    let width = args.width.unwrap_or(1000.0);
    let height = args.height.unwrap_or(700.0);

    // 若带 tab_data，先存入 pending，renderer ready 后会 consume
    if let Some(data) = args.tab_data.clone() {
        window_manager::set_pending_tab_data(&label, data);
    }
    if let Some(init_state) = args.init_state.clone() {
        window_manager::set_pending_window_init_state(&label, init_state);
    }

    let url = WebviewUrl::App("index.html".into());

    let builder = WebviewWindowBuilder::new(&app, &label, url)
        .title("PureMark")
        .inner_size(width, height)
        .min_inner_size(800.0, 600.0)
        .resizable(true)
        .visible(false)
        .decorations(false)
        .transparent(true)
        .shadow(true);

    let window = builder
        .build()
        .map_err(|e| AppError::Other(anyhow::anyhow!("build editor window: {e}")))?;

    window_manager::track_window(&label);

    // WindowEvent::Destroyed → untrack
    let label_for_closed = label.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            window_manager::untrack_window(&label_for_closed);
        }
    });

    // 同步 set_position → show（规避 #11430 多屏跳屏，同时避免事件时序问题）
    if let (Some(x), Some(y)) = (args.x, args.y) {
        let _ = window.set_position(PhysicalPosition::new(x as f64, y as f64));
    }
    window
        .show()
        .map_err(|e| AppError::Other(anyhow::anyhow!("show window: {e}")))?;
    if !args.fast_create {
        let _ = window.set_focus();
    }

    Ok(CreatedWindow { label })
}

/// 取出并消费指定窗口的待初始化状态（新窗口 renderer 就绪后调用，仅能取一次）。
#[tauri::command]
pub async fn get_window_init_state(
    _app: AppHandle,
    label: String,
) -> AppResult<Option<WindowInitState>> {
    Ok(window_manager::consume_pending_window_init_state(&label))
}

/// 窗口外框的屏幕坐标与尺寸。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// 获取指定窗口的外框边界（位置 + 尺寸），窗口不存在时返回 `None`。
#[tauri::command]
pub async fn get_window_bounds(app: AppHandle, label: String) -> AppResult<Option<WindowBounds>> {
    let Some(win) = app.get_webview_window(&label) else {
        return Ok(None);
    };
    let pos = win
        .outer_position()
        .map_err(|e| AppError::Other(anyhow::anyhow!("outer_position: {e}")))?;
    let size = win
        .outer_size()
        .map_err(|e| AppError::Other(anyhow::anyhow!("outer_size: {e}")))?;
    Ok(Some(WindowBounds {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    }))
}

/// 更新指定窗口的保存状态（供关闭确认判断是否需要弹框）。
#[tauri::command]
pub async fn change_save_status(_app: AppHandle, label: String, is_saved: bool) -> AppResult<()> {
    window_manager::set_window_save_state(&label, is_saved);
    Ok(())
}

/// 更新指定窗口当前打开的文件集合，刷新跨窗口文件去重索引。
#[tauri::command]
pub async fn update_window_open_files_cmd(
    _app: AppHandle,
    label: String,
    paths: Vec<String>,
) -> AppResult<()> {
    window_manager::update_window_open_files(
        &label,
        paths.into_iter().map(std::path::PathBuf::from).collect(),
    );
    Ok(())
}

/// 渲染层确认无未保存内容（或用户选择丢弃）后，真实关闭当前窗口。
/// 若关闭后没有剩余编辑器窗口则退出应用。
#[tauri::command]
pub async fn close_discard(app: AppHandle, label: String) -> AppResult<()> {
    if !window_manager::mark_window_closing(&label) {
        return Ok(()); // 已在关闭流程
    }

    if let Some(win) = app.get_webview_window(&label) {
        // `close()` 会触发前端 onCloseRequested；这里属于已经完成确认后的程序主动关闭，
        // 必须直接销毁，否则可能被渲染层再次 preventDefault 拦下。
        win.destroy()
            .map_err(|e| AppError::Other(anyhow::anyhow!("destroy window: {e}")))?;
    }

    // untrack 由 WindowEvent::Destroyed 完成。这里判断"是否退出应用"：
    let remaining = window_manager::remaining_editor_windows_excluding(&label);
    if remaining.is_empty() {
        // 让事件循环先处理 close()，再退出
        let app_clone = app.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            app_clone.exit(0);
        });
    } else if let Some(next) = remaining.first() {
        if let Some(win) = app.get_webview_window(next) {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }

    Ok(())
}
