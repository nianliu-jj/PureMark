//! 启动文件处理：命令行参数、macOS Finder open-file、deep-link。
//! 不是 command 而是 setup hook 的辅助函数，对应原 src/main/index.ts 的
//! `sendLaunchFileIfExists` + `open-file` 事件 + `renderer-ready` 延迟发送。

use std::path::PathBuf;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::file_format::FileTraits;
use crate::markdown_file::{is_markdown_file_path, read_markdown_file};

/// 启动时打开文件事件 `open-file-at-launch` 的载荷：路径、内容、格式特征。
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpenFileAtLaunchPayload {
    pub file_path: String,
    pub content: String,
    pub file_traits: FileTraits,
}

/// 未 ready 时 pending 的启动文件路径。
static PENDING: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));
/// renderer 是否已 ready。
static RENDERER_READY: Lazy<Mutex<bool>> = Lazy::new(|| Mutex::new(false));

/// 从命令行参数中找第一个 .md / .markdown 文件并入队。
pub fn capture_cli_file() {
    for arg in std::env::args().skip(1) {
        if is_markdown_file_path(&arg) {
            let abs = PathBuf::from(&arg)
                .canonicalize()
                .unwrap_or_else(|_| PathBuf::from(&arg));
            *PENDING.lock().unwrap() = Some(abs.to_string_lossy().into_owned());
            return;
        }
    }
}

/// macOS: Finder 双击触发；也被 deep-link 复用。
pub fn enqueue_launch_file(path: &str) {
    if !is_markdown_file_path(path) {
        return;
    }
    *PENDING.lock().unwrap() = Some(path.to_string());
}

/// 通知前端已 ready：标记 ready 状态，若此前有 pending 的启动文件则立即读取并 emit。
#[tauri::command]
pub async fn renderer_ready(app: AppHandle) -> crate::error::AppResult<()> {
    *RENDERER_READY.lock().unwrap() = true;
    let pending = PENDING.lock().unwrap().take();
    if let Some(path) = pending {
        emit_open_file(&app, &path).await?;
    }
    Ok(())
}

/// 读取指定 Markdown 文件并向主窗口 emit `open-file-at-launch` 事件。
///
/// 读盘放入 `spawn_blocking`；文件不可读时仅记录告警并静默返回。
pub async fn emit_open_file(app: &AppHandle, path: &str) -> crate::error::AppResult<()> {
    let path_owned = path.to_string();
    let out = tokio::task::spawn_blocking(move || read_markdown_file(&path_owned))
        .await
        .map_err(|e| anyhow::anyhow!(e))??;

    let Some(out) = out else {
        tracing::warn!(path = %path, "launch file unreadable");
        return Ok(());
    };

    let payload = OpenFileAtLaunchPayload {
        file_path: out.file_path.to_string_lossy().into_owned(),
        content: out.content,
        file_traits: out.file_traits,
    };

    if let Some(win) = app.get_webview_window("main") {
        win.emit("open-file-at-launch", &payload)?;
    }
    Ok(())
}

/// 查询 renderer 是否已就绪（用于 macOS RunEvent 中决定是否立即 emit）。
#[allow(dead_code)]
pub fn is_renderer_ready() -> bool {
    *RENDERER_READY.lock().unwrap()
}
