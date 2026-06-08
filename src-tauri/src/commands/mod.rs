//! Tauri command 模块汇总。
//!
//! 按系统能力域拆分子模块：剪贴板、对话框、文件、字体、启动参数、
//! shell/外链、标签页跨窗路由、主题、自动更新、窗口、工作区。
//! 各子模块导出的 `#[tauri::command]` 会在 `lib.rs` 中统一注册。

pub mod clipboard;
pub mod dialog;
pub mod file;
pub mod font;
pub mod launch;
pub mod shell;
pub mod tab;
pub mod theme;
pub mod update;
pub mod window;
pub mod workspace;
