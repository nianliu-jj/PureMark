//! 对话框相关 command。对应 IPC：
//!   - `dialog:openFile`           → open_file
//!   - `dialog:saveFileAs`         → save_file_as
//!   - `dialog:showOverwriteConfirm` → show_overwrite_confirm
//!   - `dialog:showCloseConfirm`   → show_close_confirm
//!   - `dialog:showOpenDialog`     → show_open_dialog

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, FilePath, MessageDialogButtons, MessageDialogKind};

use crate::commands::file::{ReadFileResult, SaveFileResult};
use crate::error::{AppError, AppResult};
use crate::file_format::{FileTraits, LineEnding, restore_file_traits};
use crate::image::prepare_image_content_for_save;
use crate::markdown_file::read_markdown_file;

/// 打开文件对话框并读取选中的 Markdown。取消时返回 None。
#[tauri::command]
pub async fn open_file(app: AppHandle) -> AppResult<Option<ReadFileResult>> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .blocking_pick_file();

    let Some(picked) = picked else {
        return Ok(None);
    };
    let file_path = match picked {
        FilePath::Path(p) => p,
        FilePath::Url(u) => PathBuf::from(u.path()),
    };

    let out = tokio::task::spawn_blocking(move || {
        read_markdown_file(&file_path.to_string_lossy())
    })
    .await
    .map_err(|e| anyhow::anyhow!(e))??;

    Ok(out.map(|o| ReadFileResult {
        file_path: o.file_path.to_string_lossy().into_owned(),
        content: o.content,
        file_traits: o.file_traits,
    }))
}

/// `save_file_as` 的入参：内容、原文件格式特征、默认换行风格、图片本地目录、默认保存路径与文件名。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFileAsArgs {
    pub content: String,
    pub file_traits: Option<FileTraits>,
    pub default_line_ending: Option<LineEnding>,
    pub image_local_path: Option<String>,
    pub default_path: Option<String>,
    pub file_name: Option<String>,
}

/// 另存为：弹保存对话框 + 写盘 + 临时图片迁移 + traits 还原。
#[tauri::command]
pub async fn save_file_as(
    app: AppHandle,
    args: SaveFileAsArgs,
) -> AppResult<Option<SaveFileResult>> {
    let mut builder = app.dialog().file().add_filter("Markdown", &["md", "markdown"]);
    if let Some(default_path) = &args.default_path {
        builder = builder.set_directory(default_path);
    }
    builder = builder.set_file_name(args.file_name.as_deref().unwrap_or("Untitled.md"));
    let picked = builder.blocking_save_file();

    let Some(picked) = picked else {
        return Ok(None);
    };
    let target = match picked {
        FilePath::Path(p) => p,
        FilePath::Url(u) => PathBuf::from(u.path()),
    };

    let user_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(anyhow::anyhow!("resolve userData dir: {e}")))?;

    let SaveFileAsArgs {
        content,
        file_traits,
        default_line_ending,
        image_local_path,
        default_path: _,
        file_name: _,
    } = args;

    let result: AppResult<SaveFileResult> = tokio::task::spawn_blocking(move || {
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

    result.map(Some)
}

/// 覆盖确认：返回 0=取消 1=覆盖 2=保存（与当前桌面端交互约定对齐）。
#[tauri::command]
pub async fn show_overwrite_confirm(app: AppHandle, file_name: String) -> AppResult<u8> {
    let overwrite = app
        .dialog()
        .message(format!(r#"文件 "{file_name}" 已存在，是否要覆盖当前内容？"#))
        .kind(MessageDialogKind::Info)
        .title("文件已存在")
        .buttons(MessageDialogButtons::YesNo)
        .blocking_show();
    if overwrite {
        return Ok(1);
    }
    let save = app
        .dialog()
        .message("是否先保存当前内容后再打开新文件？")
        .kind(MessageDialogKind::Info)
        .title("保存当前内容")
        .buttons(MessageDialogButtons::YesNo)
        .blocking_show();
    if save { Ok(2) } else { Ok(0) }
}

/// 关闭确认：返回 0=取消 1=不保存 2=保存。
#[tauri::command]
pub async fn show_close_confirm(app: AppHandle, file_name: String) -> AppResult<u8> {
    let save = app
        .dialog()
        .message(format!(r#"文件 "{file_name}" 有未保存的更改，是否要保存？"#))
        .kind(MessageDialogKind::Warning)
        .title("文件未保存")
        .buttons(MessageDialogButtons::YesNo)
        .blocking_show();
    if save {
        return Ok(2);
    }
    let discard = app
        .dialog()
        .message("确定不保存吗？未保存的更改将会丢失。")
        .kind(MessageDialogKind::Warning)
        .title("确认不保存")
        .buttons(MessageDialogButtons::YesNo)
        .blocking_show();
    if discard { Ok(1) } else { Ok(0) }
}

/// `show_open_dialog` 的入参：标题、默认路径、文件类型过滤器、是否选目录、是否多选。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDialogOptions {
    pub title: Option<String>,
    pub default_path: Option<String>,
    pub filters: Option<Vec<OpenDialogFilter>>,
    #[serde(default)]
    pub directory: bool,
    #[serde(default)]
    pub multiple: bool,
}

/// 文件类型过滤器：显示名 + 扩展名列表。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDialogFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

/// 打开对话框结果：是否被用户取消，以及选中的路径列表。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDialogResult {
    pub canceled: bool,
    pub file_paths: Vec<String>,
}

/// 通用打开对话框：按 `options` 选择文件或目录、单选或多选，返回选中路径。
///
/// 调用 Tauri dialog 插件的阻塞式选择 API，用户取消时 `canceled = true`。
#[tauri::command]
pub async fn show_open_dialog(
    app: AppHandle,
    options: OpenDialogOptions,
) -> AppResult<OpenDialogResult> {
    let mut builder = app.dialog().file();
    if let Some(t) = &options.title {
        builder = builder.set_title(t);
    }
    if let Some(p) = &options.default_path {
        builder = builder.set_directory(p);
    }
    if let Some(filters) = &options.filters {
        for f in filters {
            let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
            builder = builder.add_filter(&f.name, &exts);
        }
    }

    let paths = if options.directory {
        if options.multiple {
            builder
                .blocking_pick_folders()
                .map(|v| v.into_iter().map(file_path_to_string).collect())
        } else {
            builder
                .blocking_pick_folder()
                .map(|fp| vec![file_path_to_string(fp)])
        }
    } else if options.multiple {
        builder
            .blocking_pick_files()
            .map(|v| v.into_iter().map(file_path_to_string).collect())
    } else {
        builder
            .blocking_pick_file()
            .map(|fp| vec![file_path_to_string(fp)])
    };

    match paths {
        Some(file_paths) => Ok(OpenDialogResult {
            canceled: false,
            file_paths,
        }),
        None => Ok(OpenDialogResult {
            canceled: true,
            file_paths: vec![],
        }),
    }
}

/// 把 Tauri `FilePath`（可能是本地路径或 URL）统一转为字符串。
fn file_path_to_string(fp: FilePath) -> String {
    match fp {
        FilePath::Path(p) => p.to_string_lossy().into_owned(),
        FilePath::Url(u) => u.to_string(),
    }
}
