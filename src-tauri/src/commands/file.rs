//! 文件读写 / 只读判断 / 临时图片写入 / 本地图片清理 / 保存（含 traits 还原）。
//! 对应 IPC：
//!   - `file:readByPath`     → read_file_by_path
//!   - `file:isReadOnly`     → is_read_only
//!   - `file:cleanupLocalImages` → cleanup_local_images
//!   - `clipboard:writeTempImage` → write_temp_image
//!   - `dialog:saveFile`     → save_file

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::file_format::{FileTraits, LineEnding, restore_file_traits};
use crate::image::{
    cleanup_temporary_images, create_image_file_name, prepare_image_content_for_save,
    resolve_image_markdown_path, resolve_image_save_directory,
};
use crate::markdown_file::read_markdown_file;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileResult {
    pub file_path: String,
    pub content: String,
    pub file_traits: FileTraits,
}

#[tauri::command]
pub async fn read_file_by_path(file_path: String) -> AppResult<Option<ReadFileResult>> {
    let out = tokio::task::spawn_blocking(move || read_markdown_file(&file_path))
        .await
        .map_err(|e| anyhow::anyhow!(e))??;

    Ok(out.map(|o| ReadFileResult {
        file_path: o.file_path.to_string_lossy().into_owned(),
        content: o.content,
        file_traits: o.file_traits,
    }))
}

#[tauri::command]
pub async fn is_read_only(file_path: String) -> AppResult<bool> {
    let result = tokio::task::spawn_blocking(move || {
        let meta = std::fs::metadata(&file_path)?;
        Ok::<bool, std::io::Error>(meta.permissions().readonly())
    })
    .await
    .map_err(|e| anyhow::anyhow!(e))?;

    match result {
        Ok(ro) => Ok(ro),
        Err(_) => Ok(false),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteTempImageArgs {
    pub file: Vec<u8>,
    pub target_path: String,
    pub current_file_path: Option<String>,
    pub file_name: Option<String>,
    pub mime_type: Option<String>,
}

#[tauri::command]
pub async fn write_temp_image(app: AppHandle, args: WriteTempImageArgs) -> AppResult<String> {
    let user_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(anyhow::anyhow!("resolve userData dir: {e}")))?;

    let result: AppResult<String> = tokio::task::spawn_blocking(move || {
        let current_file_path = args.current_file_path.as_deref().map(PathBuf::from);
        let dir = resolve_image_save_directory(
            &args.target_path,
            current_file_path.as_deref(),
            &user_data_dir,
        );

        if !dir.absolute_dir.exists() {
            std::fs::create_dir_all(&dir.absolute_dir)?;
        }

        let file_name =
            create_image_file_name(args.file_name.as_deref(), args.mime_type.as_deref());
        let out_path = dir.absolute_dir.join(&file_name);
        std::fs::write(&out_path, &args.file)?;

        Ok(resolve_image_markdown_path(
            &out_path,
            dir.is_relative,
            current_file_path.as_deref(),
        ))
    })
    .await
    .map_err(|e| anyhow::anyhow!(e))?;
    result
}

#[tauri::command]
pub async fn cleanup_local_images(app: AppHandle, content: String) -> AppResult<()> {
    let user_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(anyhow::anyhow!("resolve userData dir: {e}")))?;

    tokio::task::spawn_blocking(move || cleanup_temporary_images(&content, &user_data_dir))
        .await
        .map_err(|e| anyhow::anyhow!(e))??;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFileArgs {
    pub file_path: String,
    pub content: String,
    pub file_traits: Option<FileTraits>,
    pub default_line_ending: Option<LineEnding>,
    pub image_local_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFileResult {
    pub file_path: String,
    pub content: String,
}

#[tauri::command]
pub async fn save_file(app: AppHandle, args: SaveFileArgs) -> AppResult<SaveFileResult> {
    let user_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(anyhow::anyhow!("resolve userData dir: {e}")))?;

    let SaveFileArgs {
        file_path,
        content,
        file_traits,
        default_line_ending,
        image_local_path,
    } = args;

    let out: AppResult<SaveFileResult> = tokio::task::spawn_blocking(move || {
        let target = PathBuf::from(&file_path);
        let prepared = prepare_image_content_for_save(
            &content,
            &target,
            image_local_path.as_deref().unwrap_or("/assets"),
            &user_data_dir,
        )?;
        let restored = restore_file_traits(&prepared, file_traits.as_ref(), default_line_ending);
        std::fs::write(&target, restored)?;
        Ok(SaveFileResult {
            file_path: target.to_string_lossy().into_owned(),
            content: prepared,
        })
    })
    .await
    .map_err(|e| anyhow::anyhow!(e))?;

    out
}

#[tauri::command]
pub async fn move_file_to_directory(file_path: String, target_dir: String) -> AppResult<String> {
    let out: AppResult<String> = tokio::task::spawn_blocking(move || {
        let source = PathBuf::from(&file_path);
        if !source.is_file() {
            return Err(AppError::Other(anyhow::anyhow!(
                "move file: source is not a file: {file_path}"
            )));
        }

        let target_dir = PathBuf::from(&target_dir);
        if !target_dir.is_dir() {
            return Err(AppError::Other(anyhow::anyhow!(
                "move file: target is not a directory: {}",
                target_dir.to_string_lossy()
            )));
        }

        let file_name = source.file_name().ok_or_else(|| {
            AppError::Other(anyhow::anyhow!("move file: missing file name: {file_path}"))
        })?;
        let target = target_dir.join(file_name);

        if source == target {
            return Ok(target.to_string_lossy().into_owned());
        }
        if target.exists() {
            return Err(AppError::Other(anyhow::anyhow!(
                "move file: target already exists: {}",
                target.to_string_lossy()
            )));
        }

        std::fs::rename(&source, &target)?;
        Ok(target.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| anyhow::anyhow!(e))?;

    out
}
