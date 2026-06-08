//! 桌面应用二进制入口。仅负责调用库 crate 的 `run()`，
//! 真正的应用装配（窗口、command、插件等）集中在 `lib.rs` 中。

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
// 在 Windows 的 release 构建下隐藏多余的控制台窗口，调试构建保留以便查看日志输出。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// 进程入口：启动应用，若运行失败则打印致命错误并以非零状态码退出。
fn main() {
    if let Err(e) = puremark_lib::run() {
        eprintln!("fatal: {e:?}");
        std::process::exit(1);
    }
}
