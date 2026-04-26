//! 自动更新 commands。
//!
//! 阶段 6 不直接切到 Tauri updater 清单流，而是继续沿用当前自定义
//! GitHub Release 检查 / 下载 / 取消 / 安装逻辑，
//! 保留当前产品依赖的行为：
//! - 自定义版本比较
//! - 平台安装包筛选
//! - 多窗口状态广播
//! - 断点续传
//! - 取消下载

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use once_cell::sync::Lazy;
use regex::Regex;
use reqwest::header::{ACCEPT, RANGE, USER_AGENT};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio::fs::{self, OpenOptions};
use tokio::io::AsyncWriteExt;

use crate::error::{AppError, AppResult};
use crate::window_manager;

const RELEASES_LATEST_API: &str = "https://api.github.com/repos/nianliu-jj/PureMark/releases/latest";

static VERSION_PREFIX_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^(?i:(beta-|alpha-|rc-))?v?").unwrap());
static BUILD_SUFFIX_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[-+]([a-zA-Z][a-zA-Z0-9-]*?)$").unwrap());
static PRERELEASE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"-(alpha|beta|rc)\.?(\d+)?$").unwrap());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
    pub date: Option<String>,
    pub url: String,
    pub filename: String,
    pub size: Option<u64>,
    pub release_page_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub update_info: UpdateInfo,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub percent: f64,
    pub total: u64,
    pub transferred: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusPayload {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub info: Option<UpdateInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UpdateLifecycle {
    Idle,
    Checking,
    Downloading,
    Downloaded,
    Error,
}

#[derive(Debug)]
struct UpdateRuntimeState {
    current_info: Option<UpdateInfo>,
    downloaded_file_path: Option<PathBuf>,
    cancel_flag: Option<Arc<AtomicBool>>,
    lifecycle: UpdateLifecycle,
}

impl Default for UpdateRuntimeState {
    fn default() -> Self {
        Self {
            current_info: None,
            downloaded_file_path: None,
            cancel_flag: None,
            lifecycle: UpdateLifecycle::Idle,
        }
    }
}

static UPDATE_STATE: Lazy<Mutex<UpdateRuntimeState>> =
    Lazy::new(|| Mutex::new(UpdateRuntimeState::default()));

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    body: Option<String>,
    published_at: Option<String>,
    html_url: String,
    #[serde(default)]
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    size: Option<u64>,
}

#[derive(Debug)]
struct ParsedVersion {
    major: u64,
    minor: u64,
    patch: u64,
    prerelease: Option<String>,
    prerelease_number: u64,
}

fn broadcast_to_all<T: Serialize>(app: &AppHandle, event: &str, payload: &T) {
    for label in window_manager::all_editor_labels() {
        let _ = app.emit_to(label.as_str(), event, payload);
    }
}

fn emit_status(
    app: &AppHandle,
    status: &str,
    info: Option<UpdateInfo>,
    error: Option<String>,
) {
    let payload = UpdateStatusPayload {
        status: status.to_string(),
        info,
        error,
    };
    broadcast_to_all(app, "update:status", &payload);
}

fn emit_available(app: &AppHandle, info: &UpdateInfo) {
    broadcast_to_all(app, "update:available", info);
}

fn emit_progress(app: &AppHandle, percent: f64, total: u64, transferred: u64) {
    let payload = UpdateProgress {
        percent,
        total,
        transferred,
    };
    broadcast_to_all(app, "update:download-progress", &payload);
}

fn updates_dir(app: &AppHandle) -> AppResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("updates"))
        .map_err(|e| AppError::Other(anyhow::anyhow!("resolve updates dir: {e}")))
}

fn current_version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

fn update_client(_app: &AppHandle) -> AppResult<Client> {
    Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| AppError::Other(anyhow::anyhow!("build reqwest client: {e}")))
}

fn parse_version(version: &str) -> Option<ParsedVersion> {
    let mut cleaned = VERSION_PREFIX_RE.replace(version, "").to_string();

    if let Some(captures) = BUILD_SUFFIX_RE.captures(&cleaned) {
        let suffix = captures.get(1)?.as_str();
        if !suffix
            .chars()
            .next()
            .map(|ch| ch.is_ascii_digit())
            .unwrap_or(false)
        {
            cleaned = BUILD_SUFFIX_RE.replace(&cleaned, "").to_string();
        }
    }

    let mut prerelease = None;
    let mut prerelease_number = 0;
    if let Some(captures) = PRERELEASE_RE.captures(&cleaned) {
        prerelease = captures.get(1).map(|m| m.as_str().to_ascii_lowercase());
        prerelease_number = captures
            .get(2)
            .and_then(|m| m.as_str().parse::<u64>().ok())
            .unwrap_or(0);
        cleaned = PRERELEASE_RE.replace(&cleaned, "").to_string();
    }

    let mut parts = cleaned
        .split('.')
        .map(|part| part.parse::<u64>())
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    while parts.len() < 3 {
        parts.push(0);
    }

    Some(ParsedVersion {
        major: parts[0],
        minor: parts[1],
        patch: parts[2],
        prerelease,
        prerelease_number,
    })
}

fn is_newer_version(latest: &str, current: &str) -> bool {
    let (Some(latest), Some(current)) = (parse_version(latest), parse_version(current)) else {
        return latest > current;
    };

    if latest.major != current.major {
        return latest.major > current.major;
    }
    if latest.minor != current.minor {
        return latest.minor > current.minor;
    }
    if latest.patch != current.patch {
        return latest.patch > current.patch;
    }

    let prerelease_order = |kind: Option<&String>| -> u8 {
        match kind.map(|s| s.as_str()) {
            Some("alpha") => 1,
            Some("beta") => 2,
            Some("rc") => 3,
            None => 255,
            _ => 0,
        }
    };

    let latest_order = prerelease_order(latest.prerelease.as_ref());
    let current_order = prerelease_order(current.prerelease.as_ref());
    if latest_order != current_order {
        return latest_order > current_order;
    }

    if latest.prerelease.is_some() && current.prerelease.is_some() {
        return latest.prerelease_number > current.prerelease_number;
    }

    false
}

fn platform_extension() -> Option<&'static str> {
    match std::env::consts::OS {
        "windows" => Some(".exe"),
        "macos" => Some(".dmg"),
        "linux" => Some(".AppImage"),
        _ => None,
    }
}

fn select_asset<'a>(assets: &'a [GitHubAsset]) -> Option<&'a GitHubAsset> {
    let ext = platform_extension()?;

    match std::env::consts::OS {
        "windows" => assets
            .iter()
            .find(|asset| asset.name.ends_with(ext) && asset.name.contains("Setup"))
            .or_else(|| assets.iter().find(|asset| asset.name.ends_with(ext))),
        "macos" => {
            let arch = std::env::consts::ARCH;
            let preferred = assets
                .iter()
                .find(|asset| asset.name.ends_with(ext) && asset.name.contains(arch));
            if preferred.is_some() {
                return preferred;
            }

            if arch == "aarch64" {
                assets
                    .iter()
                    .find(|asset| asset.name.ends_with(ext) && !asset.name.contains("x64"))
                    .or_else(|| assets.iter().find(|asset| asset.name.ends_with(ext)))
            } else {
                assets
                    .iter()
                    .find(|asset| asset.name.ends_with(ext) && !asset.name.contains("arm64"))
            }
        }
        _ => assets.iter().find(|asset| asset.name.ends_with(ext)),
    }
}

async fn fetch_latest_release(app: &AppHandle) -> AppResult<GitHubRelease> {
    let client = update_client(app)?;
    let response = client
        .get(RELEASES_LATEST_API)
        .header(USER_AGENT, format!("PureMark/{}", current_version(app)))
        .header(ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| AppError::Other(anyhow::anyhow!("fetch latest release: {e}")))?;

    let response = response
        .error_for_status()
        .map_err(|e| AppError::Other(anyhow::anyhow!("github api error: {e}")))?;

    response
        .json::<GitHubRelease>()
        .await
        .map_err(|e| AppError::Other(anyhow::anyhow!("parse latest release json: {e}")))
}

fn already_downloaded(info: &UpdateInfo, path: &Path) -> bool {
    if !path.exists() {
        return false;
    }
    let Some(expected_size) = info.size else {
        return false;
    };
    std::fs::metadata(path)
        .map(|meta| meta.len() == expected_size)
        .unwrap_or(false)
}

#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    silent: Option<bool>,
) -> AppResult<Option<UpdateCheckResult>> {
    let silent = silent.unwrap_or(false);
    {
        let mut state = UPDATE_STATE.lock().unwrap();
        state.lifecycle = UpdateLifecycle::Checking;
    }
    emit_status(&app, "checking", None, None);

    let release = match fetch_latest_release(&app).await {
        Ok(release) => release,
        Err(error) => {
            if silent {
                tracing::warn!(error = %error, "background update check failed");
                UPDATE_STATE.lock().unwrap().lifecycle = UpdateLifecycle::Idle;
                emit_status(&app, "idle", None, None);
                return Ok(None);
            }

            UPDATE_STATE.lock().unwrap().lifecycle = UpdateLifecycle::Error;
            emit_status(&app, "error", None, Some(error.to_string()));
            return Err(error);
        }
    };

    let current = current_version(&app);
    if !is_newer_version(&release.tag_name, &current) {
        let mut state = UPDATE_STATE.lock().unwrap();
        state.lifecycle = UpdateLifecycle::Idle;
        state.current_info = None;
        state.downloaded_file_path = None;
        emit_status(&app, "not-available", None, None);
        return Ok(None);
    }

    let Some(asset) = select_asset(&release.assets) else {
        let mut state = UPDATE_STATE.lock().unwrap();
        state.lifecycle = UpdateLifecycle::Idle;
        state.current_info = None;
        state.downloaded_file_path = None;
        emit_status(&app, "not-available", None, None);
        return Ok(None);
    };

    let info = UpdateInfo {
        version: release.tag_name,
        notes: release.body.unwrap_or_default(),
        date: release.published_at,
        url: asset.browser_download_url.clone(),
        filename: asset.name.clone(),
        size: asset.size,
        release_page_url: release.html_url,
    };

    {
        let mut state = UPDATE_STATE.lock().unwrap();
        state.lifecycle = UpdateLifecycle::Idle;
        state.current_info = Some(info.clone());
        if state
            .downloaded_file_path
            .as_ref()
            .is_some_and(|path| !already_downloaded(&info, path))
        {
            state.downloaded_file_path = None;
        }
    }

    emit_available(&app, &info);
    emit_status(&app, "available", Some(info.clone()), None);

    Ok(Some(UpdateCheckResult { update_info: info }))
}

#[tauri::command]
pub async fn download_update(app: AppHandle) -> AppResult<Option<String>> {
    let info = {
        let mut state = UPDATE_STATE.lock().unwrap();
        if state.lifecycle == UpdateLifecycle::Downloading {
            return Ok(state
                .downloaded_file_path
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()));
        }

        let Some(info) = state.current_info.clone() else {
            return Err(AppError::Other(anyhow::anyhow!(
                "No update check info found"
            )));
        };

        if let Some(existing) = state.downloaded_file_path.clone() {
            if already_downloaded(&info, &existing) {
                state.lifecycle = UpdateLifecycle::Downloaded;
                emit_progress(&app, 100.0, info.size.unwrap_or(0), info.size.unwrap_or(0));
                emit_status(&app, "downloaded", Some(info.clone()), None);
                return Ok(Some(existing.to_string_lossy().into_owned()));
            }
        }

        let cancel_flag = Arc::new(AtomicBool::new(false));
        state.cancel_flag = Some(cancel_flag.clone());
        state.lifecycle = UpdateLifecycle::Downloading;
        info
    };

    emit_status(&app, "downloading", Some(info.clone()), None);

    let dir = updates_dir(&app)?;
    fs::create_dir_all(&dir)
        .await
        .map_err(|e| AppError::Other(anyhow::anyhow!("create updates dir: {e}")))?;
    let download_path = dir.join(&info.filename);

    let expected_size = info.size.unwrap_or(0);
    let mut start_byte = 0_u64;
    let mut append_mode = false;

    if let Ok(metadata) = fs::metadata(&download_path).await {
        let current_size = metadata.len();

        if expected_size > 0 && current_size == expected_size {
            {
                let mut state = UPDATE_STATE.lock().unwrap();
                state.downloaded_file_path = Some(download_path.clone());
                state.cancel_flag = None;
                state.lifecycle = UpdateLifecycle::Downloaded;
            }
            emit_progress(&app, 100.0, expected_size, expected_size);
            emit_status(&app, "downloaded", Some(info.clone()), None);
            return Ok(Some(download_path.to_string_lossy().into_owned()));
        }

        if expected_size > 0 && current_size < expected_size {
            start_byte = current_size;
            append_mode = true;
        }
    }

    let cancel_flag = {
        let state = UPDATE_STATE.lock().unwrap();
        state
            .cancel_flag
            .clone()
            .ok_or_else(|| AppError::Other(anyhow::anyhow!("cancel flag missing")))?
    };

    let client = update_client(&app)?;
    let mut request = client
        .get(&info.url)
        .header(USER_AGENT, format!("PureMark/{}", current_version(&app)));
    if start_byte > 0 {
        request = request.header(RANGE, format!("bytes={start_byte}-"));
    }

    let response = request
        .send()
        .await
        .map_err(|e| AppError::Other(anyhow::anyhow!("download update: {e}")))?;

    let response_status = response.status();
    let mut response = if response_status == StatusCode::RANGE_NOT_SATISFIABLE {
        append_mode = false;
        start_byte = 0;
        client
            .get(&info.url)
            .header(USER_AGENT, format!("PureMark/{}", current_version(&app)))
            .send()
            .await
            .map_err(|e| AppError::Other(anyhow::anyhow!("restart download: {e}")))?
            .error_for_status()
            .map_err(|e| AppError::Other(anyhow::anyhow!("download update: {e}")))?
    } else {
        response
            .error_for_status()
            .map_err(|e| AppError::Other(anyhow::anyhow!("download update: {e}")))?
    };

    if start_byte > 0 && response_status == StatusCode::OK {
        append_mode = false;
        start_byte = 0;
    }

    let total_bytes = response.content_length().unwrap_or(0) + start_byte;
    let mut transferred = start_byte;

    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .append(append_mode)
        .truncate(!append_mode)
        .open(&download_path)
        .await
        .map_err(|e| AppError::Other(anyhow::anyhow!("open update file: {e}")))?;

    let download_result: AppResult<()> = async {
        loop {
            if cancel_flag.load(Ordering::SeqCst) {
                return Err(AppError::Other(anyhow::anyhow!("download canceled")));
            }

            let Some(chunk) = response
                .chunk()
                .await
                .map_err(|e| AppError::Other(anyhow::anyhow!("read update chunk: {e}")))? else {
                break;
            };

            file.write_all(&chunk)
                .await
                .map_err(|e| AppError::Other(anyhow::anyhow!("write update file: {e}")))?;
            transferred += chunk.len() as u64;

            if total_bytes > 0 {
                let percent = (transferred as f64 / total_bytes as f64) * 100.0;
                emit_progress(&app, percent, total_bytes, transferred);
            }
        }

        file.flush()
            .await
            .map_err(|e| AppError::Other(anyhow::anyhow!("flush update file: {e}")))?;
        Ok(())
    }
    .await;

    match download_result {
        Ok(()) => {
            {
                let mut state = UPDATE_STATE.lock().unwrap();
                state.cancel_flag = None;
                state.downloaded_file_path = Some(download_path.clone());
                state.lifecycle = UpdateLifecycle::Downloaded;
            }
            emit_status(&app, "downloaded", Some(info.clone()), None);
            Ok(Some(download_path.to_string_lossy().into_owned()))
        }
        Err(error) if error.to_string() == "download canceled" => {
            {
                let mut state = UPDATE_STATE.lock().unwrap();
                state.cancel_flag = None;
                state.lifecycle = UpdateLifecycle::Idle;
            }
            emit_status(&app, "idle", None, None);
            Ok(None)
        }
        Err(error) => {
            {
                let mut state = UPDATE_STATE.lock().unwrap();
                state.cancel_flag = None;
                state.lifecycle = UpdateLifecycle::Error;
            }
            emit_status(&app, "error", Some(info), Some(error.to_string()));
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn cancel_update(app: AppHandle) -> AppResult<()> {
    let cancel_flag = UPDATE_STATE.lock().unwrap().cancel_flag.clone();
    if let Some(flag) = cancel_flag {
        flag.store(true, Ordering::SeqCst);
    } else {
        UPDATE_STATE.lock().unwrap().lifecycle = UpdateLifecycle::Idle;
        emit_status(&app, "idle", None, None);
    }
    Ok(())
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> AppResult<()> {
    let (downloaded_path, has_unsaved_window) = {
        let state = UPDATE_STATE.lock().unwrap();
        let unsaved = window_manager::all_editor_labels()
            .into_iter()
            .any(|label| !window_manager::get_window_save_state(&label));
        (state.downloaded_file_path.clone(), unsaved)
    };

    if has_unsaved_window {
        return Err(AppError::Other(anyhow::anyhow!(
            "存在其他窗口的未保存内容，请先保存或关闭后再安装更新"
        )));
    }

    let Some(path) = downloaded_path else {
        return Err(AppError::Other(anyhow::anyhow!("Installer not found")));
    };
    if !path.exists() {
        return Err(AppError::Other(anyhow::anyhow!("Installer not found")));
    }

    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| AppError::Other(anyhow::anyhow!("open installer: {e}")))?;

    let app_clone = app.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(1000)).await;
        app_clone.exit(0);
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compare_normal_versions() {
        assert!(is_newer_version("v1.0.1", "1.0.0"));
        assert!(is_newer_version("1.2.0", "1.1.9"));
        assert!(!is_newer_version("1.0.0", "1.0.0"));
    }

    #[test]
    fn compare_prerelease_versions() {
        assert!(is_newer_version("1.0.0", "1.0.0-rc.1"));
        assert!(is_newer_version("1.0.0-rc.2", "1.0.0-rc.1"));
        assert!(is_newer_version("1.0.0-beta.1", "1.0.0-alpha.9"));
    }

    #[test]
    fn parse_prefixed_versions() {
        let parsed = parse_version("Beta-v0.6.0-puremarkcore").unwrap();
        assert_eq!(parsed.major, 0);
        assert_eq!(parsed.minor, 6);
        assert_eq!(parsed.patch, 0);
    }
}
