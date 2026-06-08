//! Tab 拖拽分离的数据契约，与 `src/shared/types/tearoff.ts::TearOffTabData` 对齐。
//! 通过 serde camelCase 与前端 JSON 自动互通。

use serde::{Deserialize, Serialize};

use crate::file_format::FileTraits;

/// 单个标签页拖拽分离/合并时跨窗传输的完整快照。
///
/// 字段含义：
/// - `id`/`name`：标签唯一标识与显示名
/// - `file_path`：关联磁盘文件路径（未保存的新建标签为 `None`）
/// - `source_label`：来源窗口/工作区标签，用于合并时回溯
/// - `content`/`original_content`：当前内容与上次保存内容，用于判断脏状态
/// - `is_modified`：是否有未保存改动
/// - `scroll_ratio`：滚动位置比例，迁移后恢复阅读进度
/// - `read_only`：是否只读
/// - `file_traits`：文件格式特征（换行符、编码等），保证另存时保真
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
