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

/// 读取 Markdown 文件的返回结果：规范化路径、归一化内容、原始格式特征。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileResult {
    pub file_path: String,
    pub content: String,
    pub file_traits: FileTraits,
}

/// 按路径读取 Markdown 文件并归一化内容。非 Markdown/不存在时返回 `None`。
///
/// 读盘为阻塞操作，放入 `spawn_blocking` 执行。
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

/// 判断文件是否为只读（用于决定是否禁用编辑）。读取元数据失败时保守返回 `false`。
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

/// `write_temp_image` 的入参：图片字节、目标目录配置、当前文件路径、原文件名、MIME 类型。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteTempImageArgs {
    pub file: Vec<u8>,
    pub target_path: String,
    pub current_file_path: Option<String>,
    pub file_name: Option<String>,
    pub mime_type: Option<String>,
}

/// 将粘贴/拖入的图片字节写入磁盘，并返回可写入 Markdown 的图片路径。
///
/// 副作用：按配置解析目标目录（必要时创建）、生成无冲突文件名、写入图片文件。
/// 返回：相对或绝对的图片引用路径（取决于目录配置）。
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

/// 清理内容中引用的、位于应用临时目录下的本地图片（关闭文档时回收未落盘的临时图片）。
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

/// `save_file` 的入参：目标路径、内容、原格式特征、默认换行风格、图片本地目录配置。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFileArgs {
    pub file_path: String,
    pub content: String,
    pub file_traits: Option<FileTraits>,
    pub default_line_ending: Option<LineEnding>,
    pub image_local_path: Option<String>,
}

/// 保存结果：最终写入的文件路径，以及临时图片迁移后回写到编辑器的内容。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFileResult {
    pub file_path: String,
    pub content: String,
}

/// 保存文件到指定路径：迁移临时图片 → 按 traits 还原格式 → 写盘。
///
/// 副作用：可能创建图片目录、移动/删除临时图片、覆盖目标文件。
/// 返回内容为图片相对化后的最新内容，供前端同步编辑器状态。
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

/// 将文件移动到目标目录（保留原文件名）。
///
/// 校验源为文件、目标为目录、目标不存在同名文件后用 `rename` 移动；
/// 源与目标相同时直接返回。返回移动后的新路径。
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
