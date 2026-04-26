//! 系统字体枚举。对应原 ipcBridge.ts 的 get-system-fonts。

use std::collections::BTreeSet;

use font_kit::source::SystemSource;

use crate::error::{AppError, AppResult};

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
