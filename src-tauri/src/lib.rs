mod commands;
mod error;
mod file_format;
mod image;
mod markdown_file;
mod tearoff;
mod theme_store;
mod watcher;
mod window_manager;
mod workspace;

pub use error::{AppError, AppResult};

use tracing_subscriber::{EnvFilter, fmt};

use commands::clipboard::get_file_path_in_clipboard;
use commands::dialog::{
    open_file, save_file_as, show_close_confirm, show_open_dialog, show_overwrite_confirm,
};
use commands::file::{
    cleanup_local_images, is_read_only, move_file_to_directory, read_file_by_path, save_file,
    write_temp_image,
};
use commands::font::get_system_fonts;
use commands::launch::{capture_cli_file, renderer_ready};
use commands::shell::{open_external, open_link, reveal_file_in_folder};
use commands::tab::{
    file_focus_if_open, tab_get_init_data, tab_tear_off_cancel, tab_tear_off_end,
    tab_tear_off_start, window_drop_merge, window_start_drag, window_stop_drag,
};
use commands::theme::{
    get_current_theme, load_custom_themes, open_theme_editor, remove_custom_theme,
    save_custom_theme, set_current_theme, theme_editor_window_control,
};
use commands::update::{cancel_update, check_update, download_update, install_update};
use commands::window::{
    change_save_status, close_discard, create_editor_window, get_window_bounds,
    get_window_init_state, update_window_open_files_cmd,
};
use commands::workspace::{
    create_file, create_folder, delete_file, get_directory_files, rename_file, unwatch_directory,
    watch_directory, watch_files, workspace_exists,
};

#[tauri::command]
async fn ping(name: &str) -> AppResult<String> {
    tracing::info!(name = %name, "ping called");
    Ok(format!("pong: {name}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> anyhow::Result<()> {
    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,tao=warn,wry=warn")),
        )
        .with_target(false)
        .init();

    tracing::info!(version = env!("CARGO_PKG_VERSION"), "starting PureMark");

    // 命令行参数带文件时先入队，等 renderer ready 再 emit。
    capture_cli_file();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            use std::path::PathBuf;
            use tauri::Manager;

            use crate::markdown_file::is_markdown_file_path;

            // 从 argv 里找第一个 .md/.markdown 参数
            let md_path = argv.iter().skip(1).find_map(|a| {
                if is_markdown_file_path(a) {
                    Some(
                        PathBuf::from(a)
                            .canonicalize()
                            .unwrap_or_else(|_| PathBuf::from(a))
                            .to_string_lossy()
                            .into_owned(),
                    )
                } else {
                    None
                }
            });

            if let Some(path) = md_path {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = crate::commands::launch::emit_open_file(&app_handle, &path).await;
                });
            }

            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            ping,
            renderer_ready,
            read_file_by_path,
            is_read_only,
            save_file,
            move_file_to_directory,
            write_temp_image,
            cleanup_local_images,
            open_file,
            save_file_as,
            show_overwrite_confirm,
            show_close_confirm,
            show_open_dialog,
            get_file_path_in_clipboard,
            get_directory_files,
            workspace_exists,
            create_file,
            create_folder,
            delete_file,
            rename_file,
            watch_directory,
            unwatch_directory,
            watch_files,
            load_custom_themes,
            save_custom_theme,
            remove_custom_theme,
            get_current_theme,
            set_current_theme,
            open_theme_editor,
            theme_editor_window_control,
            open_link,
            open_external,
            reveal_file_in_folder,
            get_system_fonts,
            create_editor_window,
            get_window_bounds,
            get_window_init_state,
            change_save_status,
            update_window_open_files_cmd,
            close_discard,
            check_update,
            download_update,
            cancel_update,
            install_update,
            tab_get_init_data,
            file_focus_if_open,
            tab_tear_off_start,
            tab_tear_off_end,
            tab_tear_off_cancel,
            window_start_drag,
            window_stop_drag,
            window_drop_merge
        ])
        .setup(|app| {
            use tauri::Manager;
            tracing::info!("tauri app initialized");
            // 主窗口（"main"）由 tauri.conf.json 静态声明，不经过 create_editor_window 的
            // track_window 路径。必须在这里手动登记，否则 hit_test_target / find_window_with_file
            // 永远不会命中主窗口，Tab 合并 / 跨窗口文件去重对主窗口失效。
            window_manager::track_window(window_manager::MAIN_LABEL);
            if let Some(main_win) = app.get_webview_window(window_manager::MAIN_LABEL) {
                main_win.on_window_event(|event| {
                    if matches!(event, tauri::WindowEvent::Destroyed) {
                        window_manager::untrack_window(window_manager::MAIN_LABEL);
                    }
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .map_err(|e| anyhow::anyhow!("tauri build error: {e}"))?
        .run(|app_handle, event| {
            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                if let tauri::RunEvent::Opened { urls } = &event {
                    for url in urls {
                        if let Ok(path) = url.to_file_path() {
                            let path_str = path.to_string_lossy().into_owned();
                            crate::commands::launch::enqueue_launch_file(&path_str);
                            let app_clone = app_handle.clone();
                            tauri::async_runtime::spawn(async move {
                                if crate::commands::launch::is_renderer_ready() {
                                    let _ = crate::commands::launch::emit_open_file(
                                        &app_clone, &path_str,
                                    )
                                    .await;
                                }
                            });
                        }
                    }
                }
                if let tauri::RunEvent::Reopen {
                    has_visible_windows,
                    ..
                } = &event
                {
                    if !*has_visible_windows {
                        if let Some(win) =
                            app_handle.get_webview_window(crate::window_manager::MAIN_LABEL)
                        {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                }
            }
            let _ = (app_handle, event);
        });

    Ok(())
}
