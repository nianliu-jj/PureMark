//! 外链与本地路径的智能打开。对应原 ipcBridge.ts 的 shell:openLink / shell:openExternal。
//!
//! 阶段 5：在本地 md 决议前加跨窗口文件去重，命中则 emit tab:activate-file 到目标窗口。

use std::path::{Path, PathBuf};
use std::process::Command;

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Window};
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, AppResult};
use crate::markdown_file::{is_markdown_file_path, read_markdown_file};
use crate::window_manager;

static URL_SCHEME_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[a-zA-Z][a-zA-Z\d+\-.]*:").unwrap());
static WIN_DRIVE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[a-zA-Z]:[\\/]").unwrap());

/// 判断 target 是否带 URI scheme（如 `https:`），同时排除 Windows 盘符（`C:\`）误判。
fn has_uri_scheme(target: &str) -> bool {
    URL_SCHEME_RE.is_match(target) && !WIN_DRIVE_RE.is_match(target)
}

/// 判断是否为外部链接：协议相对（`//`）或带非 `file:` 的 scheme。
fn is_external_link(target: &str) -> bool {
    target.starts_with("//")
        || (has_uri_scheme(target) && !target.to_lowercase().starts_with("file:"))
}

/// 规范化外部链接：协议相对补 `https:`，无 scheme 的裸地址补 `https://`，其余原样返回。
fn normalize_external(target: &str) -> String {
    let trimmed = target.trim();
    if trimmed.starts_with("//") {
        format!("https:{trimmed}")
    } else if is_external_link(trimmed) || trimmed.to_lowercase().starts_with("file:") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    }
}

/// 将链接解析为本地文件路径：处理 `file:` URL、绝对路径，以及相对当前文件目录的相对路径。
/// 锚点链接、空链接、外部链接返回 `None`。
fn resolve_local_link(target: &str, current_file_path: Option<&str>) -> Option<PathBuf> {
    let trimmed = target.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }

    if trimmed.to_lowercase().starts_with("file:") {
        return url::Url::parse(trimmed)
            .ok()
            .and_then(|u| u.to_file_path().ok());
    }

    if is_external_link(trimmed) {
        return None;
    }

    let clean = trimmed.split(['?', '#']).next().unwrap_or("");
    if clean.is_empty() {
        return None;
    }

    // 绝对路径
    let as_path = Path::new(clean);
    if as_path.is_absolute() || WIN_DRIVE_RE.is_match(clean) {
        return Some(PathBuf::from(clean));
    }

    // 相对路径：以 current_file_path 的父目录为根
    let current = current_file_path?;
    let parent = Path::new(current).parent()?;
    Some(parent.join(clean))
}

/// `open_link` 的入参：被点击的链接 href，以及当前文件路径（用于解析相对链接）。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenLinkArgs {
    pub href: String,
    pub current_file_path: Option<String>,
}

/// `open_link` 的处理结果，区分外链、内部 Markdown、跨窗口聚焦、其他本地文件与无操作。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum OpenLinkResult {
    External {
        url: String,
    },
    MarkdownOpened {
        file_path: String,
    },
    /// 文件已在其他窗口打开，目标窗口已经 focus + 激活对应 Tab
    CrossWindowFocused {
        file_path: String,
        window_label: String,
    },
    LocalOther {
        path: String,
    },
    Noop,
}

/// 智能打开链接：本地 Markdown 优先在应用内打开（命中其他窗口已开则聚焦该窗口并激活对应 Tab），
/// 其他本地文件交系统默认程序，外链用系统浏览器打开。
///
/// 副作用：可能 emit `tab:activate-file`、聚焦目标窗口、调用系统 opener。
#[tauri::command]
pub async fn open_link(
    app: AppHandle,
    window: Window,
    args: OpenLinkArgs,
) -> AppResult<OpenLinkResult> {
    let source_label = window.label().to_string();
    let OpenLinkArgs {
        href,
        current_file_path,
    } = args;

    if let Some(local) = resolve_local_link(&href, current_file_path.as_deref()) {
        let local_str = local.to_string_lossy().into_owned();

        if is_markdown_file_path(&local_str) {
            // 阶段 5：跨窗口文件去重
            if let Some(target_label) =
                window_manager::find_window_with_file(&local_str, Some(&source_label))
            {
                if let Some(target_win) = app.get_webview_window(&target_label) {
                    let _ = app.emit_to(target_label.as_str(), "tab:activate-file", &local_str);
                    let _ = target_win.set_focus();
                    return Ok(OpenLinkResult::CrossWindowFocused {
                        file_path: local_str,
                        window_label: target_label,
                    });
                }
            }

            let local_for_read = local_str.clone();
            let result = tokio::task::spawn_blocking(move || read_markdown_file(&local_for_read))
                .await
                .map_err(|e| anyhow::anyhow!(e))??;
            if result.is_some() {
                return Ok(OpenLinkResult::MarkdownOpened {
                    file_path: local.to_string_lossy().into_owned(),
                });
            }
        }

        // 非 md / 或读取失败：走 opener 打开（系统默认应用）
        app.opener()
            .open_path(local.to_string_lossy(), None::<&str>)
            .map_err(|e| AppError::Other(anyhow::anyhow!("open path: {e}")))?;
        return Ok(OpenLinkResult::LocalOther {
            path: local.to_string_lossy().into_owned(),
        });
    }

    let url = normalize_external(&href);
    if url.is_empty() {
        return Ok(OpenLinkResult::Noop);
    }
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| AppError::Other(anyhow::anyhow!("open url: {e}")))?;
    Ok(OpenLinkResult::External { url })
}

/// 用系统默认浏览器打开外部 URL（规范化后再打开）。
#[tauri::command]
pub async fn open_external(app: AppHandle, url: String) -> AppResult<()> {
    let normalized = normalize_external(&url);
    app.opener()
        .open_url(&normalized, None::<&str>)
        .map_err(|e| AppError::Other(anyhow::anyhow!("open url: {e}")))?;
    Ok(())
}

/// 在系统文件管理器中定位并选中指定文件（Windows explorer / macOS Finder / Linux xdg-open）。
#[tauri::command]
pub async fn reveal_file_in_folder(file_path: String) -> AppResult<()> {
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err(AppError::Other(anyhow::anyhow!(
            "reveal file: path does not exist: {file_path}"
        )));
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("/select,{}", path.to_string_lossy()))
            .spawn()
            .map_err(|e| AppError::Other(anyhow::anyhow!("reveal file: {e}")))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| AppError::Other(anyhow::anyhow!("reveal file: {e}")))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = path.parent().unwrap_or_else(|| Path::new("."));
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| AppError::Other(anyhow::anyhow!("reveal file: {e}")))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Ok(())
}
