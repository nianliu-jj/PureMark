//! Tab 拖拽分离的数据契约，与 `src/shared/types/tearoff.ts::TearOffTabData` 对齐。
//! 通过 serde camelCase 与前端 JSON 自动互通。

use serde::{Deserialize, Serialize};

use crate::file_format::FileTraits;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TearOffTabData {
    pub id: String,
    pub name: String,
    pub file_path: Option<String>,
    #[serde(default)]
    pub source_label: Option<String>,
    pub content: String,
    pub original_content: String,
    pub is_modified: bool,
    #[serde(default)]
    pub scroll_ratio: Option<f64>,
    pub read_only: bool,
    #[serde(default)]
    pub file_traits: Option<FileTraits>,
}
