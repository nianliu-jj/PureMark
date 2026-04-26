//! 目录递归扫描 + 过滤 + 排序。对应原 ipcBridge.ts 的 workspace:getDirectoryFiles。
//! 纯逻辑，无 Tauri 依赖，可单元测试。

use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;

/// 每层目录最多扫描的条目数（保护大仓库）。
pub const MAX_FILES_PER_DIR: usize = 100;
/// 递归深度上限。
pub const MAX_DEPTH: usize = 10;

/// 应忽略的目录名（正则 anchor 到完整 basename）。
static IGNORE_PATTERNS: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"^(?:\.git|\.vscode|\.idea|node_modules|\.next|\.nuxt|dist|build|coverage|\.DS_Store|Thumbs\.db)$",
    )
    .unwrap()
});

static MD_EXT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\.(?:md|markdown)$").unwrap());

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceNode {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub mtime: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<WorkspaceNode>>,
}

fn should_ignore_directory(name: &str) -> bool {
    IGNORE_PATTERNS.is_match(name)
}

fn is_markdown(name: &str) -> bool {
    MD_EXT_RE.is_match(name)
}

fn mtime_millis(path: &Path) -> i64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn char_priority(ch: Option<char>) -> u8 {
    match ch {
        Some(c) if c.is_ascii_lowercase() => 0,
        Some(c) if c.is_ascii_uppercase() => 1,
        Some(c) if c.is_ascii_digit() => 2,
        Some(_) => 3,
        None => 4,
    }
}

fn split_natural_tokens(name: &str) -> Vec<&str> {
    let mut tokens = Vec::new();
    let mut start = 0usize;
    let mut prev_is_digit: Option<bool> = None;

    for (idx, ch) in name.char_indices() {
        let is_digit = ch.is_ascii_digit();
        if let Some(prev) = prev_is_digit {
            if prev != is_digit {
                tokens.push(&name[start..idx]);
                start = idx;
            }
        } else {
            start = idx;
        }
        prev_is_digit = Some(is_digit);
    }

    if prev_is_digit.is_some() {
        tokens.push(&name[start..]);
    } else {
        tokens.push(name);
    }

    tokens
}

fn compare_text_token(a: &str, b: &str) -> Ordering {
    let mut a_chars = a.chars();
    let mut b_chars = b.chars();

    loop {
        match (a_chars.next(), b_chars.next()) {
            (Some(a_ch), Some(b_ch)) => {
                let priority = char_priority(Some(a_ch)).cmp(&char_priority(Some(b_ch)));
                if priority != Ordering::Equal {
                    return priority;
                }

                let lower = a_ch
                    .to_ascii_lowercase()
                    .cmp(&b_ch.to_ascii_lowercase());
                if lower != Ordering::Equal {
                    return lower;
                }

                let raw = a_ch.cmp(&b_ch);
                if raw != Ordering::Equal {
                    return raw;
                }
            }
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (None, None) => return Ordering::Equal,
        }
    }
}

fn compare_number_token(a: &str, b: &str) -> Ordering {
    let a_trim = a.trim_start_matches('0');
    let b_trim = b.trim_start_matches('0');
    let a_norm = if a_trim.is_empty() { "0" } else { a_trim };
    let b_norm = if b_trim.is_empty() { "0" } else { b_trim };

    a_norm
        .len()
        .cmp(&b_norm.len())
        .then_with(|| a_norm.cmp(b_norm))
        .then_with(|| a.len().cmp(&b.len()))
}

fn compare_name(a: &str, b: &str) -> Ordering {
    let leading = char_priority(a.chars().next()).cmp(&char_priority(b.chars().next()));
    if leading != Ordering::Equal {
        return leading;
    }

    let a_tokens = split_natural_tokens(a);
    let b_tokens = split_natural_tokens(b);
    let shared = a_tokens.len().min(b_tokens.len());

    for idx in 0..shared {
        let a_token = a_tokens[idx];
        let b_token = b_tokens[idx];
        let ordering = if a_token.chars().all(|ch| ch.is_ascii_digit())
            && b_token.chars().all(|ch| ch.is_ascii_digit())
        {
            compare_number_token(a_token, b_token)
        } else {
            compare_text_token(a_token, b_token)
        };

        if ordering != Ordering::Equal {
            return ordering;
        }
    }

    a_tokens
        .len()
        .cmp(&b_tokens.len())
        .then_with(|| compare_text_token(a, b))
}

/// 递归扫描目录，返回按原 TS 规则排序的节点列表：
///   1. 文件夹在前、文件在后
///   2. 每组内按名称自然排序
///   3. 首字符优先级：小写字母 > 大写字母 > 数字 > 其他
pub fn scan_directory(root: &Path) -> Vec<WorkspaceNode> {
    fn scan_inner(current: &Path, depth: usize) -> Vec<WorkspaceNode> {
        if depth > MAX_DEPTH {
            return Vec::new();
        }
        let read = match std::fs::read_dir(current) {
            Ok(r) => r,
            Err(err) => {
                tracing::warn!(path = %current.display(), error = %err, "scan_directory: read_dir failed");
                return Vec::new();
            }
        };

        let mut items: Vec<PathBuf> = read.flatten().map(|e| e.path()).collect();
        if items.len() > MAX_FILES_PER_DIR {
            tracing::warn!(
                path = %current.display(),
                count = items.len(),
                "scan_directory: too many entries, truncating"
            );
            items.truncate(MAX_FILES_PER_DIR);
        }

        let mut dirs: Vec<WorkspaceNode> = Vec::new();
        let mut files: Vec<WorkspaceNode> = Vec::new();

        for path in items {
            let name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            let is_dir = path.is_dir();
            if is_dir {
                if should_ignore_directory(&name) {
                    continue;
                }
                let children = scan_inner(&path, depth + 1);
                dirs.push(WorkspaceNode {
                    name,
                    path: path.to_string_lossy().into_owned(),
                    is_directory: true,
                    mtime: mtime_millis(&path),
                    children: Some(children),
                });
            } else if path.is_file() && is_markdown(&name) {
                files.push(WorkspaceNode {
                    name,
                    path: path.to_string_lossy().into_owned(),
                    is_directory: false,
                    mtime: mtime_millis(&path),
                    children: None,
                });
            }
        }

        dirs.sort_by(|a, b| compare_name(&a.name, &b.name));
        files.sort_by(|a, b| compare_name(&a.name, &b.name));

        dirs.into_iter().chain(files).collect()
    }

    scan_inner(root, 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn mk_temp() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "puremark-ws-test-{}",
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn ignores_hidden_and_common_build_dirs() {
        assert!(should_ignore_directory(".git"));
        assert!(should_ignore_directory("node_modules"));
        assert!(should_ignore_directory(".vscode"));
        assert!(!should_ignore_directory("src"));
        assert!(!should_ignore_directory("docs"));
    }

    #[test]
    fn markdown_match_case_insensitive() {
        assert!(is_markdown("readme.md"));
        assert!(is_markdown("DOC.MARKDOWN"));
        assert!(!is_markdown("note.txt"));
        assert!(!is_markdown("image.png"));
    }

    #[test]
    fn scan_empty_dir_returns_empty() {
        let dir = mk_temp();
        assert!(scan_directory(&dir).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_directories_before_files_sorted_by_name() {
        let dir = mk_temp();
        fs::create_dir_all(dir.join("zdir")).unwrap();
        fs::create_dir_all(dir.join("adir")).unwrap();
        fs::write(dir.join("b.md"), "").unwrap();
        fs::write(dir.join("a.md"), "").unwrap();

        let out = scan_directory(&dir);
        assert_eq!(out.len(), 4);
        assert!(out[0].is_directory);
        assert_eq!(out[0].name, "adir");
        assert_eq!(out[1].name, "zdir");
        assert!(!out[2].is_directory);
        assert_eq!(out[2].name, "a.md");
        assert_eq!(out[3].name, "b.md");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn compare_name_prefers_lower_upper_digit_other_and_natural_order() {
        let mut names = vec![
            "_misc.md".to_string(),
            "20-start.md".to_string(),
            "A2.md".to_string(),
            "A10.md".to_string(),
            "a10.md".to_string(),
            "a2.md".to_string(),
        ];

        names.sort_by(|a, b| compare_name(a, b));

        assert_eq!(
            names,
            vec![
                "a2.md".to_string(),
                "a10.md".to_string(),
                "A2.md".to_string(),
                "A10.md".to_string(),
                "20-start.md".to_string(),
                "_misc.md".to_string(),
            ]
        );
    }

    #[test]
    fn scan_filters_non_markdown_files() {
        let dir = mk_temp();
        fs::write(dir.join("note.txt"), "").unwrap();
        fs::write(dir.join("readme.md"), "").unwrap();
        fs::write(dir.join("pic.png"), "").unwrap();

        let out = scan_directory(&dir);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "readme.md");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_ignores_node_modules_and_dotfolders() {
        let dir = mk_temp();
        fs::create_dir_all(dir.join("node_modules")).unwrap();
        fs::write(dir.join("node_modules/m.md"), "").unwrap();
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::write(dir.join(".git/g.md"), "").unwrap();
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join("src/a.md"), "").unwrap();

        let out = scan_directory(&dir);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "src");
        assert!(out[0].children.as_ref().unwrap().iter().any(|c| c.name == "a.md"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_respects_max_depth() {
        let dir = mk_temp();
        // 构造深度 12 的目录链，每层一个 x.md
        let mut cur = dir.clone();
        for i in 0..12 {
            cur = cur.join(format!("d{i}"));
            fs::create_dir_all(&cur).unwrap();
            fs::write(cur.join("x.md"), "").unwrap();
        }

        let out = scan_directory(&dir);
        // 从第 10 层开始 children 应为空
        fn count_depth(node: &WorkspaceNode, depth: usize) -> usize {
            if let Some(children) = &node.children {
                children
                    .iter()
                    .filter(|c| c.is_directory)
                    .map(|c| count_depth(c, depth + 1))
                    .max()
                    .unwrap_or(depth)
            } else {
                depth
            }
        }
        let max_observed = count_depth(&out[0], 0);
        assert!(max_observed <= MAX_DEPTH, "max_observed={max_observed}");

        let _ = fs::remove_dir_all(&dir);
    }
}
