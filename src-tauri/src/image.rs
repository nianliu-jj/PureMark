//! 图片路径解析与临时图片管理。对应原 ipcBridge.ts 的 resolve/prepare/cleanup 逻辑。

use std::path::{Path, PathBuf};

use once_cell::sync::Lazy;
use regex::Regex;

use crate::error::AppResult;

// ── 路径判定 ────────────────────────────────────────────────────

static WIN_DRIVE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[a-zA-Z]:[\\/]").unwrap());
static WIN_UNC_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\\\\[^\\]").unwrap());
static LEADING_SLASH_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[\\/]+").unwrap());
static DOT_LEADING_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\.[\\/]+").unwrap());
static UNSAFE_FILENAME_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"[<>:"/\\|?*\x00-\x1F]"#).unwrap());
static MD_IMG_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"!\[([^\]]*)\]\(([^)]+)\)").unwrap());

/// 判断 `input` 是否是绝对路径（Windows 盘符 / UNC / POSIX 绝对）。
/// 与原 TS 实现一致：Windows 仅认 drive-letter 与 UNC；其他平台用 POSIX 绝对路径。
pub fn is_absolute_image_directory(input: &str) -> bool {
    if input.is_empty() {
        return false;
    }
    if cfg!(target_os = "windows") {
        WIN_DRIVE_RE.is_match(input) || WIN_UNC_RE.is_match(input)
    } else {
        input.starts_with('/')
    }
}

/// 去除前导 `/` 或 `./`，得到"干净相对路径"。
pub fn normalize_relative_image_directory(input: &str) -> String {
    let trimmed = input.trim();
    let s1 = LEADING_SLASH_RE.replace(trimmed, "");
    let s2 = DOT_LEADING_RE.replace(&s1, "");
    s2.trim().to_string()
}

// ── 图片保存目录解析 ─────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct ImageSaveDirectory {
    pub absolute_dir: PathBuf,
    pub is_relative: bool,
}

/// 解析用户配置的图片目录（可能是相对或绝对），返回绝对路径 + 是否相对型。
/// 相对型：相对于 `current_file_path` 的目录；若 current_file_path 为空，退回 `user_data_dir`。
pub fn resolve_image_save_directory(
    configured_path: &str,
    current_file_path: Option<&Path>,
    user_data_dir: &Path,
) -> ImageSaveDirectory {
    let normalized = configured_path.trim();
    let normalized = if normalized.is_empty() {
        "/assets"
    } else {
        normalized
    };

    if is_absolute_image_directory(normalized) {
        return ImageSaveDirectory {
            absolute_dir: PathBuf::from(normalized),
            is_relative: false,
        };
    }

    let rel = normalize_relative_image_directory(normalized);
    let rel = if rel.is_empty() {
        "assets".to_string()
    } else {
        rel
    };

    let base_dir = current_file_path
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| user_data_dir.to_path_buf());

    ImageSaveDirectory {
        absolute_dir: base_dir.join(rel),
        is_relative: true,
    }
}

/// 把绝对图片路径转为保存在 md 里的相对路径（保留 POSIX 分隔符）。
pub fn resolve_image_markdown_path(
    absolute_file_path: &Path,
    is_relative: bool,
    current_file_path: Option<&Path>,
) -> String {
    let to_posix = |p: &Path| p.to_string_lossy().replace('\\', "/");
    if !is_relative || current_file_path.is_none() {
        return to_posix(absolute_file_path);
    }
    let parent = current_file_path
        .and_then(Path::parent)
        .unwrap_or_else(|| Path::new(""));
    match pathdiff(absolute_file_path, parent) {
        Some(rel) => rel.to_string_lossy().replace('\\', "/"),
        None => to_posix(absolute_file_path),
    }
}

/// 纯 std 实现的 `pathdiff::diff_paths` 子集（避免引入额外 crate）。
fn pathdiff(target: &Path, base: &Path) -> Option<PathBuf> {
    use std::path::Component;
    let mut ta = target.components().peekable();
    let mut ba = base.components().peekable();
    while let (Some(&t), Some(&b)) = (ta.peek(), ba.peek()) {
        if t == b {
            ta.next();
            ba.next();
        } else {
            break;
        }
    }
    let mut buf = PathBuf::new();
    for _ in ba {
        buf.push("..");
    }
    for comp in ta {
        match comp {
            Component::Normal(s) => buf.push(s),
            Component::CurDir => {}
            other => buf.push(other.as_os_str()),
        }
    }
    if buf.as_os_str().is_empty() {
        None
    } else {
        Some(buf)
    }
}

pub fn is_app_temp_image_path(image_path: &Path, user_data_dir: &Path) -> bool {
    let img = image_path
        .canonicalize()
        .unwrap_or_else(|_| image_path.to_path_buf());
    let udd = user_data_dir
        .canonicalize()
        .unwrap_or_else(|_| user_data_dir.to_path_buf());
    img.starts_with(&udd)
}

// ── 文件名生成 ────────────────────────────────────────────────

fn image_output_extension(file_name: Option<&str>, mime_type: Option<&str>) -> &'static str {
    if let Some(name) = file_name {
        let ext = Path::new(name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        match ext.to_lowercase().as_str() {
            "jpg" | "jpeg" => return ".jpg",
            "gif" => return ".gif",
            "webp" => return ".webp",
            "svg" => return ".svg",
            "bmp" => return ".bmp",
            "png" => return ".png",
            _ => {}
        }
    }
    match mime_type.unwrap_or("") {
        "image/jpeg" => ".jpg",
        "image/gif" => ".gif",
        "image/webp" => ".webp",
        "image/svg+xml" => ".svg",
        "image/bmp" => ".bmp",
        _ => ".png",
    }
}

/// 生成无冲突的图片文件名：<safe-base>-<timestamp>.<ext>
pub fn create_image_file_name(file_name: Option<&str>, mime_type: Option<&str>) -> String {
    let ext = image_output_extension(file_name, mime_type);
    let raw_base = file_name
        .and_then(|n| Path::new(n).file_stem().and_then(|s| s.to_str()))
        .unwrap_or("image");
    let safe_base = UNSAFE_FILENAME_RE
        .replace_all(raw_base, "-")
        .trim()
        .to_string();
    let base = if safe_base.is_empty() {
        "image".to_string()
    } else {
        safe_base
    };
    let ts = chrono::Utc::now().timestamp_millis();
    format!("{base}-{ts}{ext}")
}

// ── Markdown 图片源码替换 ─────────────────────────────────────

/// 按给定的替换函数替换 markdown 图片 src。replacer 返回 None 保留原文，Some(new) 替换。
pub fn replace_markdown_image_sources<F>(content: &str, mut replacer: F) -> String
where
    F: FnMut(&str) -> Option<String>,
{
    MD_IMG_RE
        .replace_all(content, |caps: &regex::Captures| {
            let alt = &caps[1];
            let src = &caps[2];
            match replacer(src) {
                Some(next) if next != src => format!("![{alt}]({next})"),
                _ => caps[0].to_string(),
            }
        })
        .to_string()
}

// ── 保存前：临时图片迁移到目标目录并相对化 ──────────────────────

/// 遍历 md 中的图片 src，把位于 `user_data_dir`（应用临时目录）下的绝对路径：
/// 1. cp 到 `imageLocalPath` 解析得到的目标目录；
/// 2. 删除原临时文件；
/// 3. 在返回的内容里把这些 src 改写为相对 `target_file_path` 的路径。
pub fn prepare_image_content_for_save(
    content: &str,
    target_file_path: &Path,
    image_local_path: &str,
    user_data_dir: &Path,
) -> AppResult<String> {
    let dir = resolve_image_save_directory(image_local_path, Some(target_file_path), user_data_dir);
    if !dir.is_relative {
        return Ok(content.to_string());
    }
    if !dir.absolute_dir.exists() {
        std::fs::create_dir_all(&dir.absolute_dir)?;
    }

    let udd = user_data_dir.to_path_buf();
    let abs_dir = dir.absolute_dir.clone();
    let target_file = target_file_path.to_path_buf();

    let replaced = replace_markdown_image_sources(content, |src| {
        if !is_absolute_image_directory(src) {
            return None;
        }
        let src_path = PathBuf::from(src);
        if !is_app_temp_image_path(&src_path, &udd) {
            return None;
        }
        let file_name = src_path.file_name()?.to_string_lossy().into_owned();
        let target_path = abs_dir.join(&file_name);
        let normalized_src = src_path
            .canonicalize()
            .unwrap_or_else(|_| src_path.clone());
        let normalized_target = target_path
            .canonicalize()
            .unwrap_or_else(|_| target_path.clone());

        if normalized_src != normalized_target && src_path.exists() {
            let _ = std::fs::copy(&src_path, &target_path);
            let _ = std::fs::remove_file(&src_path);
        }
        if !target_path.exists() && !src_path.exists() {
            return None;
        }
        Some(resolve_image_markdown_path(
            &target_path,
            true,
            Some(&target_file),
        ))
    });

    Ok(replaced)
}

/// 收集当前 md 中还位于 userData 临时目录的图片并删除。
pub fn cleanup_temporary_images(content: &str, user_data_dir: &Path) -> AppResult<()> {
    let mut to_delete = Vec::new();
    let _ = replace_markdown_image_sources(content, |src| {
        if is_absolute_image_directory(src) {
            let p = PathBuf::from(src);
            if is_app_temp_image_path(&p, user_data_dir) && p.exists() {
                to_delete.push(p);
            }
        }
        None
    });
    for p in to_delete {
        let _ = std::fs::remove_file(&p);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absolute_detection_cross_platform() {
        if cfg!(target_os = "windows") {
            assert!(is_absolute_image_directory(r"C:\a\b"));
            assert!(is_absolute_image_directory(r"\\server\share\x"));
            // 与原 TS 行为一致：Windows 下 `/` 开头的路径视为相对（留给工作目录解析）
            assert!(!is_absolute_image_directory("/usr/local/x"));
        } else {
            assert!(is_absolute_image_directory("/usr/local/x"));
        }
        assert!(!is_absolute_image_directory("./img/x.png"));
        assert!(!is_absolute_image_directory("img/x.png"));
    }

    #[test]
    fn resolve_save_dir_relative_anchors_to_md_folder() {
        let md = if cfg!(target_os = "windows") {
            Path::new(r"C:\tmp\docs\readme.md")
        } else {
            Path::new("/tmp/docs/readme.md")
        };
        let ud = if cfg!(target_os = "windows") {
            Path::new(r"C:\tmp\userdata")
        } else {
            Path::new("/tmp/userdata")
        };
        let expected_parent = if cfg!(target_os = "windows") {
            PathBuf::from(r"C:\tmp\docs").join("assets")
        } else {
            PathBuf::from("/tmp/docs/assets")
        };

        let r = resolve_image_save_directory("/assets", Some(md), ud);
        assert!(r.is_relative);
        assert_eq!(r.absolute_dir, expected_parent);
    }

    #[test]
    fn resolve_save_dir_absolute_bypasses_anchoring() {
        // 选择平台对应的绝对路径
        let abs = if cfg!(target_os = "windows") {
            r"D:\images"
        } else {
            "/var/images"
        };
        let md = if cfg!(target_os = "windows") {
            Path::new(r"C:\any\doc.md")
        } else {
            Path::new("/any/doc.md")
        };

        let r = resolve_image_save_directory(abs, Some(md), Path::new("/tmp/ud"));
        assert!(!r.is_relative);
        assert_eq!(r.absolute_dir, PathBuf::from(abs));
    }

    #[test]
    fn markdown_path_relative_to_md_dir() {
        let (md, abs, expected) = if cfg!(target_os = "windows") {
            (
                Path::new(r"C:\tmp\docs\readme.md"),
                Path::new(r"C:\tmp\docs\assets\a.png"),
                "assets/a.png",
            )
        } else {
            (
                Path::new("/tmp/docs/readme.md"),
                Path::new("/tmp/docs/assets/a.png"),
                "assets/a.png",
            )
        };
        let s = resolve_image_markdown_path(abs, true, Some(md));
        assert_eq!(s, expected);
    }

    #[test]
    fn normalize_strips_leading_slashes_and_dot() {
        assert_eq!(normalize_relative_image_directory("/assets/"), "assets/");
        assert_eq!(normalize_relative_image_directory("./assets"), "assets");
        assert_eq!(normalize_relative_image_directory("assets"), "assets");
    }

    #[test]
    fn create_image_file_name_sanitizes_base() {
        // file_stem 按路径分隔符截取后剩 "x"（与原 TS `path.basename` 行为一致）。
        let name = create_image_file_name(Some(r#"my<bad>:"name"/x.jpg"#), None);
        assert!(name.starts_with("x-"));
        assert!(name.ends_with(".jpg"));
    }

    #[test]
    fn create_image_file_name_sanitizes_unsafe_chars_in_stem() {
        // 纯文件名（无路径分隔）中的非法字符被替换为 `-`
        let name = create_image_file_name(Some("bad<>:\"|?*.png"), None);
        assert!(name.starts_with("bad"));
        assert!(name.contains('-'));
        assert!(name.ends_with(".png"));
    }

    #[test]
    fn replace_image_sources_keeps_non_matching() {
        let input = "![a](./x.png) text ![b](./y.png)";
        let out = replace_markdown_image_sources(input, |src| {
            if src == "./x.png" {
                Some("./IMG/x.png".into())
            } else {
                None
            }
        });
        assert_eq!(out, "![a](./IMG/x.png) text ![b](./y.png)");
    }
}
