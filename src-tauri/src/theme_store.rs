//! 自定义主题持久化。对应原 renderer/utils/themeManager.ts 的 localStorage 读写。
//!
//! 存储位置：`app.path().app_data_dir()/themes.json`
//! 结构：  { "themes": [ ... ], "current": "theme-xxx" }

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ThemeFile {
    #[serde(default)]
    pub themes: Vec<serde_json::Value>,
    #[serde(default)]
    pub current: Option<String>,
}

pub fn themes_json_path(user_data_dir: &Path) -> PathBuf {
    user_data_dir.join("themes.json")
}

/// 读取 themes.json；不存在时返回空 default。
pub fn load(user_data_dir: &Path) -> AppResult<ThemeFile> {
    let path = themes_json_path(user_data_dir);
    if !path.exists() {
        return Ok(ThemeFile::default());
    }
    let content = std::fs::read_to_string(&path)?;
    if content.trim().is_empty() {
        return Ok(ThemeFile::default());
    }
    let parsed: ThemeFile = serde_json::from_str(&content).map_err(AppError::Json)?;
    Ok(parsed)
}

/// 原子写入（先写临时文件再 rename）。
pub fn save(user_data_dir: &Path, file: &ThemeFile) -> AppResult<()> {
    if !user_data_dir.exists() {
        std::fs::create_dir_all(user_data_dir)?;
    }
    let target = themes_json_path(user_data_dir);
    let tmp = target.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(file).map_err(AppError::Json)?;
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, &target)?;
    Ok(())
}

/// 按 `name` 追加/替换一条自定义主题。
pub fn upsert_theme(file: &mut ThemeFile, theme: serde_json::Value) -> AppResult<()> {
    let Some(name) = theme.get("name").and_then(|v| v.as_str()).map(String::from) else {
        return Err(AppError::Other(anyhow::anyhow!(
            "upsert_theme: theme missing `name` field"
        )));
    };
    for existing in file.themes.iter_mut() {
        if existing.get("name").and_then(|v| v.as_str()) == Some(&name) {
            *existing = theme;
            return Ok(());
        }
    }
    file.themes.push(theme);
    Ok(())
}

/// 按 name 删除。返回是否真的删了。
pub fn remove_theme(file: &mut ThemeFile, name: &str) -> bool {
    let before = file.themes.len();
    file.themes
        .retain(|t| t.get("name").and_then(|v| v.as_str()) != Some(name));
    file.themes.len() != before
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn mk_temp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "puremark-theme-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn load_returns_default_when_missing() {
        let dir = mk_temp();
        let f = load(&dir).unwrap();
        assert!(f.themes.is_empty());
        assert!(f.current.is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn round_trip_save_load() {
        let dir = mk_temp();
        let mut f = ThemeFile::default();
        f.current = Some("foo".into());
        f.themes
            .push(serde_json::json!({ "name": "foo", "label": "Foo" }));
        save(&dir, &f).unwrap();

        let back = load(&dir).unwrap();
        assert_eq!(back, f);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn upsert_replaces_same_name() {
        let mut f = ThemeFile::default();
        upsert_theme(&mut f, serde_json::json!({ "name": "a", "v": 1 })).unwrap();
        upsert_theme(&mut f, serde_json::json!({ "name": "a", "v": 2 })).unwrap();
        upsert_theme(&mut f, serde_json::json!({ "name": "b", "v": 1 })).unwrap();
        assert_eq!(f.themes.len(), 2);
        assert_eq!(f.themes[0].get("v").and_then(|v| v.as_i64()), Some(2));
    }

    #[test]
    fn remove_returns_false_for_missing() {
        let mut f = ThemeFile::default();
        upsert_theme(&mut f, serde_json::json!({ "name": "a" })).unwrap();
        assert!(remove_theme(&mut f, "a"));
        assert!(!remove_theme(&mut f, "a"));
    }
}
