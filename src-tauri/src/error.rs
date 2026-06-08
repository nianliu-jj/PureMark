//! 应用统一错误类型定义。
//!
//! 各类底层错误（IO、JSON、Tauri、anyhow）通过 `#[from]` 自动转换为 `AppError`，
//! 并在 Tauri command 返回时序列化为纯字符串，便于前端直接展示错误信息。

use serde::Serialize;

/// 应用级错误类型，在 Tauri command 边界序列化为字符串返回给前端。
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Tauri error: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("{0}")]
    Other(#[from] anyhow::Error),
}

impl Serialize for AppError {
    /// 将错误序列化为其 `Display` 文本，使前端拿到的是可读的错误描述字符串而非结构化对象。
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// command 返回值的统一别名，失败时携带 `AppError`。
pub type AppResult<T> = Result<T, AppError>;
