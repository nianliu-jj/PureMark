//! 系统字体枚举。对应原 ipcBridge.ts 的 get-system-fonts。

use std::collections::BTreeSet;

use font_kit::source::SystemSource;

use crate::error::{AppError, AppResult};

/// 枚举系统已安装的字体族名称（去重并按字典序排序后返回）。
///
/// 通过 `font-kit` 的 `SystemSource` 访问操作系统字体目录，
/// 因枚举可能阻塞，放在 `spawn_blocking` 线程池中执行避免阻塞异步运行时。
///
/// 返回：唯一且非空的字体族名称列表。
#[tauri::command]
pub async fn get_system_fonts() -> AppResult<Vec<String>> {
    tokio::task::spawn_blocking(|| -> AppResult<Vec<String>> {
        let source = SystemSource::new();
        let families = source
            .all_families()
            .map_err(|e| AppError::Other(anyhow::anyhow!("enumerate system fonts: {e}")))?;
        let unique: BTreeSet<String> = families
            .into_iter()
            .filter(|s| !s.trim().is_empty())
            .collect();
        Ok(unique.into_iter().collect())
    })
    .await
    .map_err(|e| anyhow::anyhow!(e))?
}
