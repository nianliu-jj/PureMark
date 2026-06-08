//! 从剪贴板读取文件路径列表。对应 IPC `clipboard:getFilePath`。
//! 行为与现有桌面端约定保持一致：
//!   - Windows：CF_HDROP 返回文件列表
//!   - macOS：public.file-url 返回 [path]
//!   - Linux：返回空数组

use crate::error::AppResult;

/// 读取系统剪贴板中的文件路径列表（用于「粘贴图片/文件」场景）。
///
/// 平台差异由下方各 `read_clipboard_files` 实现处理；读取阻塞操作放入 `spawn_blocking`。
/// 返回：剪贴板中的文件绝对路径列表，无文件时返回空数组。
#[tauri::command]
pub async fn get_file_path_in_clipboard() -> AppResult<Vec<String>> {
    tokio::task::spawn_blocking(read_clipboard_files)
        .await
        .map_err(|e| anyhow::anyhow!(e))?
}

/// Windows 实现：从 CF_HDROP 剪贴板格式读取文件列表。
#[cfg(target_os = "windows")]
fn read_clipboard_files() -> AppResult<Vec<String>> {
    use clipboard_win::{Clipboard, Getter, formats};
    // ERROR_NOT_FOUND：当前剪贴板里没有 CF_HDROP 格式（只有文本/图片/为空等），
    // 与现有桌面端行为保持一致，视为"无文件"而非错误。
    const ERROR_NOT_FOUND: u32 = 1168;

    let _clip =
        Clipboard::new_attempts(10).map_err(|e| anyhow::anyhow!("open clipboard: {e}"))?;
    let mut raw: Vec<String> = Vec::new();
    if let Err(e) = formats::FileList.read_clipboard(&mut raw) {
        if e.raw_code() as u32 == ERROR_NOT_FOUND {
            return Ok(Vec::new());
        }
        return Err(anyhow::anyhow!("read CF_HDROP: {e}").into());
    }
    let list: Vec<String> = raw.into_iter().filter(|s| !s.trim().is_empty()).collect();
    Ok(list)
}

/// macOS 实现：通过 NSPasteboard 读取 `NSURL` 类型对象的文件路径。
#[cfg(target_os = "macos")]
fn read_clipboard_files() -> AppResult<Vec<String>> {
    use cocoa::appkit::NSPasteboard;
    use cocoa::base::{id, nil};
    use cocoa::foundation::{NSArray, NSString, NSURL};
    use objc::class;

    unsafe {
        let pb: id = NSPasteboard::generalPasteboard(nil);
        let nsurl_class: id = class!(NSURL) as *const objc::runtime::Class as id;
        let class_array: id = NSArray::arrayWithObject(nil, nsurl_class);
        let items: id = pb.readObjectsForClasses_options(class_array, nil);

        if items == nil {
            return Ok(Vec::new());
        }

        let count = NSArray::count(items);
        let mut out = Vec::with_capacity(count as usize);
        for i in 0..count {
            let url: id = NSArray::objectAtIndex(items, i);
            let path: id = NSURL::path(url);
            if path != nil {
                let c_str = NSString::UTF8String(path);
                if !c_str.is_null() {
                    let s = std::ffi::CStr::from_ptr(c_str).to_string_lossy().into_owned();
                    if !s.is_empty() {
                        out.push(s);
                    }
                }
            }
        }
        Ok(out)
    }
}

/// 其他平台（如 Linux）实现：暂不支持，返回空列表。
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn read_clipboard_files() -> AppResult<Vec<String>> {
    Ok(Vec::new())
}
