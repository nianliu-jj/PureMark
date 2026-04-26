//! 全局文件系统监听状态。对应原 ipcBridge.ts 的 chokidar 实例。
//!
//! 设计：
//!   - 目录监听：全局唯一，对应 `directoryWatcher`。发生变化时 emit `workspace:directory-changed`。
//!   - 文件监听：多路径共享一个 watcher，对应 `watcher + watchedFiles`。变化时 emit `file:changed`。
//!
//! notify-debouncer-full 提供了开箱即用的防抖与事件合并（例如 rename 会成对出现）。
//! 我们把 notify 事件翻译成前端友好的字符串并广播给所有窗口。

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use notify::{EventKind, RecursiveMode, Watcher};
use notify_debouncer_full::{DebounceEventResult, Debouncer, FileIdMap, new_debouncer};
use once_cell::sync::Lazy;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::error::{AppError, AppResult};

type DirDebouncer = Debouncer<notify::RecommendedWatcher, FileIdMap>;

/// 全局目录监听状态。
pub struct DirectoryWatcherState {
    debouncer: Option<DirDebouncer>,
    path: Option<PathBuf>,
}

impl DirectoryWatcherState {
    fn new() -> Self {
        Self {
            debouncer: None,
            path: None,
        }
    }
}

/// 全局文件监听状态。
pub struct FileWatcherState {
    debouncer: Option<DirDebouncer>,
    watched: HashSet<PathBuf>,
}

impl FileWatcherState {
    fn new() -> Self {
        Self {
            debouncer: None,
            watched: HashSet::new(),
        }
    }
}

static DIR_WATCHER: Lazy<Arc<Mutex<DirectoryWatcherState>>> =
    Lazy::new(|| Arc::new(Mutex::new(DirectoryWatcherState::new())));
static FILE_WATCHER: Lazy<Arc<Mutex<FileWatcherState>>> =
    Lazy::new(|| Arc::new(Mutex::new(FileWatcherState::new())));

/// 开始监听目录：先关掉旧的，再开新的。
pub async fn start_directory_watch(app: AppHandle, dir: PathBuf) -> AppResult<()> {
    let mut state = DIR_WATCHER.lock().await;
    state.debouncer = None;
    state.path = None;

    if !dir.exists() {
        tracing::warn!(path = %dir.display(), "start_directory_watch: path does not exist");
        return Ok(());
    }

    let app_clone = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(300),
        None,
        move |result: DebounceEventResult| match result {
            Ok(events) => {
                if events.iter().any(|ev| is_actionable_event(&ev.kind)) {
                    if let Err(err) = app_clone.emit("workspace:directory-changed", ()) {
                        tracing::warn!(error = %err, "emit workspace:directory-changed failed");
                    }
                }
            }
            Err(errors) => {
                for err in errors {
                    tracing::warn!(error = %err, "directory watcher error");
                }
            }
        },
    )
    .map_err(|e| AppError::Other(anyhow::anyhow!("new_debouncer failed: {e}")))?;

    debouncer
        .watcher()
        .watch(&dir, RecursiveMode::Recursive)
        .map_err(|e| AppError::Other(anyhow::anyhow!("watch dir {}: {e}", dir.display())))?;

    state.debouncer = Some(debouncer);
    state.path = Some(dir);
    Ok(())
}

pub async fn stop_directory_watch() {
    let mut state = DIR_WATCHER.lock().await;
    state.debouncer = None;
    state.path = None;
}

fn is_actionable_event(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(_)
    )
}

/// 同步当前监听的文件集合：新增/移除按差异处理。
pub async fn sync_file_watches(app: AppHandle, paths: Vec<PathBuf>) -> AppResult<()> {
    let mut state = FILE_WATCHER.lock().await;
    let desired: HashSet<PathBuf> = paths.into_iter().collect();

    // 如果 watcher 未启动且有 desired，创建它
    if state.debouncer.is_none() && !desired.is_empty() {
        let app_clone = app.clone();
        let debouncer = new_debouncer(
            Duration::from_millis(200),
            None,
            move |result: DebounceEventResult| match result {
                Ok(events) => {
                    for ev in events {
                        if !matches!(ev.kind, EventKind::Modify(_)) {
                            continue;
                        }
                        for p in &ev.paths {
                            let s = p.to_string_lossy().into_owned();
                            if let Err(err) = app_clone.emit("file:changed", &s) {
                                tracing::warn!(error = %err, "emit file:changed failed");
                            }
                        }
                    }
                }
                Err(errors) => {
                    for err in errors {
                        tracing::warn!(error = %err, "file watcher error");
                    }
                }
            },
        )
        .map_err(|e| AppError::Other(anyhow::anyhow!("new_debouncer(file) failed: {e}")))?;
        state.debouncer = Some(debouncer);
    }

    let to_add: Vec<PathBuf> = desired.difference(&state.watched).cloned().collect();
    let to_remove: Vec<PathBuf> = state.watched.difference(&desired).cloned().collect();

    if let Some(deb) = state.debouncer.as_mut() {
        for p in &to_add {
            if let Err(e) = deb.watcher().watch(p, RecursiveMode::NonRecursive) {
                tracing::warn!(path = %p.display(), error = %e, "watch file failed");
            }
        }
        for p in &to_remove {
            if let Err(e) = deb.watcher().unwatch(p) {
                tracing::warn!(path = %p.display(), error = %e, "unwatch file failed");
            }
        }
    }

    state.watched = desired;

    // 若变空则关闭 watcher，释放资源
    if state.watched.is_empty() {
        state.debouncer = None;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn actionable_event_check() {
        use notify::event::{CreateKind, ModifyKind, RemoveKind};
        assert!(is_actionable_event(&EventKind::Create(CreateKind::File)));
        assert!(is_actionable_event(&EventKind::Remove(RemoveKind::File)));
        assert!(is_actionable_event(&EventKind::Modify(ModifyKind::Any)));
        assert!(!is_actionable_event(&EventKind::Access(
            notify::event::AccessKind::Read
        )));
    }
}
