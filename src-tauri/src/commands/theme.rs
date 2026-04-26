//! 主题 commands。对应原 ipcBridge.ts：
//!   - save-custom-theme     → save_custom_theme（+ 广播 custom-theme-saved）
//!   - open-theme-editor     → open_theme_editor（运行时创建 WebviewWindow）
//!   - theme-editor-window-control → theme_editor_window_control
//! 新增：
//!   - load_custom_themes    → 前端冷启动时一次性读取
//!   - remove_custom_theme   → 删除自定义主题
//!   - get_current_theme / set_current_theme → 当前主题名持久化

use serde::Deserialize;
use serde_json::Value as JsonValue;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::error::{AppError, AppResult};
use crate::theme_store::{ThemeFile, load, remove_theme, save, upsert_theme};

fn user_data_dir(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::Other(anyhow::anyhow!("resolve userData dir: {e}")))
}

#[tauri::command]
pub async fn load_custom_themes(app: AppHandle) -> AppResult<ThemeFile> {
    let dir = user_data_dir(&app)?;
    tokio::task::spawn_blocking(move || load(&dir))
        .await
        .map_err(|e| anyhow::anyhow!(e))?
}

#[tauri::command]
pub async fn save_custom_theme(app: AppHandle, theme: JsonValue) -> AppResult<()> {
    let dir = user_data_dir(&app)?;
    let theme_clone = theme.clone();

    tokio::task::spawn_blocking(move || -> AppResult<()> {
        let mut file = load(&dir)?;
        upsert_theme(&mut file, theme_clone)?;
        save(&dir, &file)?;
        Ok(())
    })
    .await
    .map_err(|e| anyhow::anyhow!(e))??;

    // 广播到所有窗口
    if let Err(err) = app.emit("custom-theme-saved", &theme) {
        tracing::warn!(error = %err, "emit custom-theme-saved failed");
    }
    Ok(())
}

#[tauri::command]
pub async fn remove_custom_theme(app: AppHandle, name: String) -> AppResult<bool> {
    let dir = user_data_dir(&app)?;
    let name_for_emit = name.clone();

    let removed = tokio::task::spawn_blocking(move || -> AppResult<bool> {
        let mut file = load(&dir)?;
        let ok = remove_theme(&mut file, &name);
        if ok {
            save(&dir, &file)?;
        }
        Ok(ok)
    })
    .await
    .map_err(|e| anyhow::anyhow!(e))??;

    if removed {
        let _ = app.emit("custom-theme-removed", &name_for_emit);
    }
    Ok(removed)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetCurrentThemeArgs {
    pub name: String,
}

#[tauri::command]
pub async fn set_current_theme(app: AppHandle, args: SetCurrentThemeArgs) -> AppResult<()> {
    let dir = user_data_dir(&app)?;
    let name = args.name.clone();
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        let mut file = load(&dir)?;
        file.current = Some(name);
        save(&dir, &file)?;
        Ok(())
    })
    .await
    .map_err(|e| anyhow::anyhow!(e))??;
    Ok(())
}

#[tauri::command]
pub async fn get_current_theme(app: AppHandle) -> AppResult<Option<String>> {
    let dir = user_data_dir(&app)?;
    let f = tokio::task::spawn_blocking(move || load(&dir))
        .await
        .map_err(|e| anyhow::anyhow!(e))??;
    Ok(f.current)
}

// ── 主题编辑器窗口 ───────────────────────────────────────────

const THEME_EDITOR_LABEL: &str = "theme-editor";

#[tauri::command]
pub async fn open_theme_editor(app: AppHandle) -> AppResult<()> {
    if let Some(existing) = app.get_webview_window(THEME_EDITOR_LABEL) {
        existing
            .set_focus()
            .map_err(|e| AppError::Other(anyhow::anyhow!("focus theme-editor: {e}")))?;
        return Ok(());
    }

    let url = WebviewUrl::App("theme-editor.html".into());
    let builder = WebviewWindowBuilder::new(&app, THEME_EDITOR_LABEL, url)
        .title("PureMark · 主题编辑器")
        .inner_size(1000.0, 700.0)
        .min_inner_size(800.0, 600.0)
        .decorations(false)
        .resizable(true)
        .center();

    builder
        .build()
        .map_err(|e| AppError::Other(anyhow::anyhow!("build theme-editor window: {e}")))?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowControlArgs {
    pub action: String, // "minimize" | "maximize" | "close"
}

#[tauri::command]
pub async fn theme_editor_window_control(
    app: AppHandle,
    args: WindowControlArgs,
) -> AppResult<()> {
    let Some(win) = app.get_webview_window(THEME_EDITOR_LABEL) else {
        return Ok(());
    };
    match args.action.as_str() {
        "minimize" => win
            .minimize()
            .map_err(|e| AppError::Other(anyhow::anyhow!("minimize: {e}")))?,
        "maximize" => {
            if win
                .is_maximized()
                .map_err(|e| AppError::Other(anyhow::anyhow!("is_maximized: {e}")))?
            {
                win.unmaximize()
                    .map_err(|e| AppError::Other(anyhow::anyhow!("unmaximize: {e}")))?;
            } else {
                win.maximize()
                    .map_err(|e| AppError::Other(anyhow::anyhow!("maximize: {e}")))?;
            }
        }
        "close" => win
            .close()
            .map_err(|e| AppError::Other(anyhow::anyhow!("close: {e}")))?,
        other => {
            return Err(AppError::Other(anyhow::anyhow!(
                "unknown window control action: {other}"
            )));
        }
    }
    Ok(())
}
