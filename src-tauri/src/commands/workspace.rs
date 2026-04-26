//! 工作区 commands。对应原 ipcBridge.ts：
//!   - workspace:getDirectoryFiles  → get_directory_files
//!   - workspace:exists             → workspace_exists
//!   - workspace:createFile         → create_file
//!   - workspace:createFolder       → create_folder
//!   - workspace:deleteFile         → delete_file
//!   - workspace:renameFile         → rename_file
//!   - workspace:watchDirectory     → watch_directory
//!   - workspace:unwatchDirectory   → unwatch_directory
//!   - file:watch                   → watch_files

use std::path::PathBuf;

use serde::Deserialize;
use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::watcher::{start_directory_watch, stop_directory_watch, sync_file_watches};
use crate::workspace::{WorkspaceNode, scan_directory};

#[tauri::command]
pub async fn get_directory_files(dir_path: String) -> AppResult<Vec<WorkspaceNode>> {
    if dir_path.is_empty() {
        return Ok(Vec::new());
    }
    let path = PathBuf::from(&dir_path);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let out = tokio::task::spawn_blocking(move || scan_directory(&path))
        .await
        .map_err(|e| anyhow::anyhow!(e))?;
    Ok(out)
}

#[tauri::command]
pub async fn workspace_exists(dir_path: String) -> AppResult<bool> {
    if dir_path.is_empty() {
        return Ok(false);
    }
    let r = tokio::task::spawn_blocking(move || PathBuf::from(dir_path).exists())
        .await
        .map_err(|e| anyhow::anyhow!(e))?;
    Ok(r)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFileArgs {
    pub dir_path: String,
    pub file_name: String,
}

#[tauri::command]
pub async fn create_file(args: CreateFileArgs) -> AppResult<Option<String>> {
    let CreateFileArgs { dir_path, file_name } = args;
    let result: Result<String, std::io::Error> = tokio::task::spawn_blocking(move || {
        let file_path = PathBuf::from(&dir_path).join(&file_name);
        std::fs::write(&file_path, "")?;
        Ok(file_path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| anyhow::anyhow!(e))?;
    match result {
        Ok(p) => Ok(Some(p)),
        Err(e) => {
            tracing::warn!(error = %e, "create_file failed");
            Ok(None)
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFolderArgs {
    pub dir_path: String,
    pub folder_name: String,
}

#[tauri::command]
pub async fn create_folder(args: CreateFolderArgs) -> AppResult<Option<String>> {
    let CreateFolderArgs {
        dir_path,
        folder_name,
    } = args;
    let result: Result<String, std::io::Error> = tokio::task::spawn_blocking(move || {
        let folder_path = PathBuf::from(&dir_path).join(&folder_name);
        std::fs::create_dir_all(&folder_path)?;
        Ok(folder_path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| anyhow::anyhow!(e))?;
    match result {
        Ok(p) => Ok(Some(p)),
        Err(e) => {
            tracing::warn!(error = %e, "create_folder failed");
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn delete_file(file_path: String) -> AppResult<bool> {
    let r: Result<(), std::io::Error> = tokio::task::spawn_blocking(move || {
        let p = PathBuf::from(&file_path);
        if p.is_dir() {
            std::fs::remove_dir_all(&p)
        } else {
            std::fs::remove_file(&p)
        }
    })
    .await
    .map_err(|e| anyhow::anyhow!(e))?;
    match r {
        Ok(_) => Ok(true),
        Err(e) => {
            tracing::warn!(error = %e, "delete_file failed");
            Ok(false)
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameFileArgs {
    pub old_path: String,
    pub new_name: String,
}

#[tauri::command]
pub async fn rename_file(args: RenameFileArgs) -> AppResult<Option<String>> {
    let RenameFileArgs { old_path, new_name } = args;
    let result: AppResult<String> = tokio::task::spawn_blocking(move || {
        let old = PathBuf::from(&old_path);
        let parent = old.parent().ok_or_else(|| {
            AppError::Other(anyhow::anyhow!("rename: missing parent: {old_path}"))
        })?;
        let new_path = parent.join(&new_name);
        std::fs::rename(&old, &new_path)?;
        Ok(new_path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| anyhow::anyhow!(e))?;
    match result {
        Ok(p) => Ok(Some(p)),
        Err(e) => {
            tracing::warn!(error = %e, "rename_file failed");
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn watch_directory(app: AppHandle, dir_path: String) -> AppResult<()> {
    start_directory_watch(app, PathBuf::from(dir_path)).await
}

#[tauri::command]
pub async fn unwatch_directory() -> AppResult<()> {
    stop_directory_watch().await;
    Ok(())
}

#[tauri::command]
pub async fn watch_files(app: AppHandle, file_paths: Vec<String>) -> AppResult<()> {
    let paths = file_paths.into_iter().map(PathBuf::from).collect();
    sync_file_watches(app, paths).await
}
