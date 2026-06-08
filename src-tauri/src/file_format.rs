//! 文件格式检测与还原。对应原 src/main/fileFormat.ts。
//!
//! 读取流程：`detect_file_traits` → `normalize` → `cleanup_protocol_urls`。
//! 保存流程：`restore_file_traits`。
//! 这里只含纯函数，不依赖 tauri 运行时，可单元测试。

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

/// 文件换行符风格：Windows 的 CRLF（`\r\n`）或 Unix 的 LF（`\n`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    Crlf,
    Lf,
}

/// 文件原始格式特征，用于保存时无损还原（BOM、换行风格、末尾换行）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTraits {
    pub has_bom: bool,
    pub line_ending: LineEnding,
    pub has_trailing_newline: bool,
}

/// 从原始文件内容（字节解码后的 UTF-8 字符串）检测 BOM/换行/末尾换行。
pub fn detect_file_traits(raw: &str) -> FileTraits {
    FileTraits {
        has_bom: raw.starts_with('\u{FEFF}'),
        line_ending: if raw.contains("\r\n") {
            LineEnding::Crlf
        } else {
            LineEnding::Lf
        },
        has_trailing_newline: raw.ends_with('\n'),
    }
}

/// 编辑器内部统一使用 LF 且无 BOM，读取后调用。
pub fn normalize_markdown(text: &str) -> String {
    let without_bom = text.strip_prefix('\u{FEFF}').unwrap_or(text);
    without_bom.replace("\r\n", "\n")
}

/// 将内容统一规整为 LF 后，再按目标换行风格转换（CRLF 时把每个 `\n` 换回 `\r\n`）。
fn apply_line_ending(content: &str, line_ending: LineEnding) -> String {
    let normalized = content.replace("\r\n", "\n");
    if matches!(line_ending, LineEnding::Crlf) {
        normalized.replace('\n', "\r\n")
    } else {
        normalized
    }
}

/// 保存前按原始 FileTraits 还原内容。
pub fn restore_file_traits(
    content: &str,
    traits: Option<&FileTraits>,
    default_line_ending: Option<LineEnding>,
) -> String {
    let Some(traits) = traits else {
        return default_line_ending
            .map(|line_ending| apply_line_ending(content, line_ending))
            .unwrap_or_else(|| content.to_string());
    };

    let mut result = apply_line_ending(content, traits.line_ending);

    if traits.has_trailing_newline {
        let eol = if matches!(traits.line_ending, LineEnding::Crlf) {
            "\r\n"
        } else {
            "\n"
        };
        if !result.ends_with(eol) {
            result.push_str(eol);
        }
    } else {
        while result.ends_with("\r\n") {
            result.truncate(result.len() - 2);
        }
        while result.ends_with('\n') {
            result.truncate(result.len() - 1);
        }
    }

    if traits.has_bom {
        let mut with_bom = String::with_capacity(result.len() + 3);
        with_bom.push('\u{FEFF}');
        with_bom.push_str(&result);
        return with_bom;
    }

    result
}

// ── 历史图片协议兼容清理（仅用于读取旧版本留下的 URL）─────

static IMG_MARKDOWN_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"!\[([^\]]*)\]\((?:puremark|milkup)://[/]?([^)]+)\)").unwrap());

// Rust regex crate 不支持 backreference，把原来靠 \2 对称引号的表达式拆成两个：
static IMG_HTML_DQ_RE: Lazy<Regex> =
    Lazy::new(|| {
        Regex::new(r#"<img(\s[^>]*?)src="(?:puremark|milkup)://[/]?([^"]+)"([^>]*)>"#).unwrap()
    });
static IMG_HTML_SQ_RE: Lazy<Regex> =
    Lazy::new(|| {
        Regex::new(r"<img(\s[^>]*?)src='(?:puremark|milkup)://[/]?([^']+)'([^>]*)>").unwrap()
    });

static BASE64_PADDING_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[A-Za-z0-9+/]+=+/(.+)$").unwrap());

static FILE_EXT_TAIL_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\.\w+$").unwrap());

/// 从历史协议 URL 的内容片段中尽力提取出真实相对路径。
///
/// 兼容三种旧格式：base64 填充后跟路径、含 `/./` 的路径、以及末尾带文件扩展名的片段。
/// 无法识别时返回 `None`，调用方会保留原始 URL 不动。
fn extract_relative_path(url_content: &str) -> Option<String> {
    if let Some(caps) = BASE64_PADDING_RE.captures(url_content) {
        return Some(caps[1].to_string());
    }
    if let Some(idx) = url_content.find("/./") {
        return Some(url_content[idx + 1..].to_string());
    }
    if let Some(idx) = url_content.rfind('/') {
        if idx > 0 {
            let possible = &url_content[idx + 1..];
            if FILE_EXT_TAIL_RE.is_match(possible) {
                return Some(possible.to_string());
            }
        }
    }
    None
}

/// 把 `![alt](milkup://...)` / `![alt](puremark://...)` 等历史 URL 还原为相对路径。
pub fn cleanup_protocol_urls(content: &str) -> String {
    let md_cleaned = IMG_MARKDOWN_RE.replace_all(content, |caps: &regex::Captures| {
        let alt = &caps[1];
        let url_content = &caps[2];
        match extract_relative_path(url_content) {
            Some(rel) => format!("![{alt}]({rel})"),
            None => caps[0].to_string(),
        }
    });

    let html_dq = IMG_HTML_DQ_RE.replace_all(&md_cleaned, |caps: &regex::Captures| {
        let before = &caps[1];
        let url_content = &caps[2];
        let after = &caps[3];
        match extract_relative_path(url_content) {
            Some(rel) => format!(r#"<img{before}src="{rel}"{after}>"#),
            None => caps[0].to_string(),
        }
    });

    IMG_HTML_SQ_RE
        .replace_all(&html_dq, |caps: &regex::Captures| {
            let before = &caps[1];
            let url_content = &caps[2];
            let after = &caps[3];
            match extract_relative_path(url_content) {
                Some(rel) => format!("<img{before}src='{rel}'{after}>"),
                None => caps[0].to_string(),
            }
        })
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_bom_and_crlf() {
        let raw = "\u{FEFF}hello\r\nworld\r\n";
        let t = detect_file_traits(raw);
        assert!(t.has_bom);
        assert!(matches!(t.line_ending, LineEnding::Crlf));
        assert!(t.has_trailing_newline);
    }

    #[test]
    fn detects_lf_no_bom_no_trailing() {
        let raw = "hello\nworld";
        let t = detect_file_traits(raw);
        assert!(!t.has_bom);
        assert!(matches!(t.line_ending, LineEnding::Lf));
        assert!(!t.has_trailing_newline);
    }

    #[test]
    fn normalizes_strips_bom_and_crlf() {
        let raw = "\u{FEFF}a\r\nb\r\nc";
        assert_eq!(normalize_markdown(raw), "a\nb\nc");
    }

    #[test]
    fn restores_with_bom_crlf_trailing() {
        let traits = FileTraits {
            has_bom: true,
            line_ending: LineEnding::Crlf,
            has_trailing_newline: true,
        };
        let out = restore_file_traits("a\nb", Some(&traits), None);
        assert_eq!(out, "\u{FEFF}a\r\nb\r\n");
    }

    #[test]
    fn restores_strips_trailing_newline_when_original_had_none() {
        let traits = FileTraits {
            has_bom: false,
            line_ending: LineEnding::Lf,
            has_trailing_newline: false,
        };
        let out = restore_file_traits("a\nb\n\n", Some(&traits), None);
        assert_eq!(out, "a\nb");
    }

    #[test]
    fn restores_new_file_with_default_crlf() {
        let out = restore_file_traits("a\nb\n", None, Some(LineEnding::Crlf));
        assert_eq!(out, "a\r\nb\r\n");
    }

    #[test]
    fn cleanup_protocol_urls_restores_markdown_img() {
        let content = "text ![cover](puremark:///YmFzZTY0/./img/cover.png) tail";
        let cleaned = cleanup_protocol_urls(content);
        assert_eq!(cleaned, "text ![cover](./img/cover.png) tail");
    }

    #[test]
    fn cleanup_protocol_urls_restores_html_img() {
        let content = r#"<img src="puremark://YmFzZTY0=/sub/a.jpg" alt="a" />"#;
        let cleaned = cleanup_protocol_urls(content);
        assert_eq!(cleaned, r#"<img src="sub/a.jpg" alt="a" />"#);
    }

    #[test]
    fn cleanup_protocol_urls_restores_legacy_milkup_img() {
        let content = "![cover](milkup:///YmFzZTY0/./img/cover.png)";
        let cleaned = cleanup_protocol_urls(content);
        assert_eq!(cleaned, "![cover](./img/cover.png)");
    }

    #[test]
    fn cleanup_protocol_urls_keeps_non_puremark_urls() {
        let content = "![a](https://example.com/x.png) and ![b](./img/b.png)";
        assert_eq!(cleanup_protocol_urls(content), content);
    }
}
