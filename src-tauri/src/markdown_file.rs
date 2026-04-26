//! Markdown 文件路径规范化与读取。对应原 src/main/markdownFile.ts。

use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::file_format::{
    FileTraits, cleanup_protocol_urls, detect_file_traits, normalize_markdown,
};

/// 去除首尾匹配的单/双引号。
fn strip_wrapping_quotes(input: &str) -> &str {
    let bytes = input.as_bytes();
    if bytes.len() >= 2 {
        let (first, last) = (bytes[0], bytes[bytes.len() - 1]);
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return &input[1..input.len() - 1];
        }
    }
    input
}

/// 去除末尾连续的路径分隔符（保留根目录的 `/` 或 `C:\` 等）。
fn trim_trailing_separators(input: &str) -> String {
    let mut s = input.to_string();
    while s.len() > 1 {
        let ends_with_sep = s.ends_with('/') || s.ends_with('\\');
        if !ends_with_sep {
            break;
        }
        if Path::new(&s)
            .parent()
            .map(|p| p.as_os_str() == s.as_str())
            .unwrap_or(false)
        {
            break;
        }
        s.pop();
    }
    s
}

pub fn normalize_markdown_file_path(input: &str) -> String {
    let trimmed = input.trim();
    let without_quotes = strip_wrapping_quotes(trimmed);
    trim_trailing_separators(without_quotes)
}

pub fn is_markdown_file_path(input: &str) -> bool {
    let normalized = normalize_markdown_file_path(input);
    let lower = normalized.to_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

#[derive(Debug)]
pub struct ReadMarkdownOutput {
    pub file_path: PathBuf,
    pub content: String,
    pub file_traits: FileTraits,
}

/// 读取 md 文件并归一化。失败时返回 `None` 以与原 TS 行为保持一致（调用方决定是否报错）。
pub fn read_markdown_file(input_path: &str) -> AppResult<Option<ReadMarkdownOutput>> {
    let normalized = normalize_markdown_file_path(input_path);
    if normalized.is_empty() || !is_markdown_file_path(&normalized) {
        return Ok(None);
    }

    let path = PathBuf::from(&normalized);
    if !path.exists() {
        return Ok(None);
    }

    let metadata = match std::fs::metadata(&path) {
        Ok(m) => m,
        Err(_) => return Ok(None),
    };
    if !metadata.is_file() {
        return Ok(None);
    }

    let bytes = std::fs::read(&path).map_err(AppError::Io)?;
    // 保留 BOM 让 detect_file_traits 能识别；normalize_markdown 随后会剥离它。
    let (cow, _had_errors) = encoding_rs::UTF_8.decode_without_bom_handling(&bytes);
    let raw = cow.into_owned();

    let file_traits = detect_file_traits(&raw);
    let content = cleanup_protocol_urls(&normalize_markdown(&raw));

    Ok(Some(ReadMarkdownOutput {
        file_path: path,
        content,
        file_traits,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn normalizes_trims_quotes_and_trailing_seps() {
        assert_eq!(normalize_markdown_file_path(" \"a/b.md\" "), "a/b.md");
        assert_eq!(normalize_markdown_file_path("folder///"), "folder");
    }

    #[test]
    fn is_markdown_checks_extension_case_insensitive() {
        assert!(is_markdown_file_path("readme.MD"));
        assert!(is_markdown_file_path("doc.Markdown"));
        assert!(!is_markdown_file_path("note.txt"));
    }

    #[test]
    fn read_markdown_returns_none_for_nonexistent() {
        let r = read_markdown_file("definitely/does/not/exist.md").unwrap();
        assert!(r.is_none());
    }

    #[test]
    fn read_markdown_round_trips_bom_crlf() {
        let tmp = tempdir();
        let path = tmp.path().join("sample.md");
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all("\u{FEFF}hello\r\nworld\r\n".as_bytes()).unwrap();
        drop(f);

        let out = read_markdown_file(path.to_str().unwrap()).unwrap().unwrap();
        assert_eq!(out.content, "hello\nworld\n");
        assert!(out.file_traits.has_bom);
        assert_eq!(out.file_path, path);
    }

    // 极小的 tempdir helper，避免引入 tempfile crate。
    fn tempdir() -> TempDir {
        let dir = std::env::temp_dir().join(format!("puremark-test-{}", uuid_like()));
        std::fs::create_dir_all(&dir).unwrap();
        TempDir(dir)
    }

    fn uuid_like() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        format!("{nanos:x}")
    }

    struct TempDir(std::path::PathBuf);
    impl TempDir {
        fn path(&self) -> &std::path::Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}
