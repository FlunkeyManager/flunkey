// Small AppData helpers that the frontend has no plugin equivalent for.

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};



/// Whether a file exists in roaming AppData, and its contents if it does.
///
/// Used to read the pre-split store file. The Tauri store plugin resolves its
/// own base directory independently and, in this app, `load()` on that file
/// returned an empty store even when the file held valid JSON — so anything
/// that must see the real bytes (not a cached `{}`) has to read the file
/// itself. Rejecting any name that is not a bare filename keeps this from
/// being a general-purpose read.
#[tauri::command]
pub fn appdata_read_json(app: AppHandle, name: String) -> Option<String> {
    if name.is_empty()
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
    {
        return None;
    }
    let Ok(base) = app.path().app_data_dir() else {
        return None;
    };
    let path: PathBuf = base.join(name);
    fs::read_to_string(path).ok()
}

/// Empty one AppData file by name, after confirming it exists.
///
/// Used to retire the pre-split store file once its contents are safely in the
/// per-collection files. Refusing when the file is missing keeps a typo from
/// creating an empty file that would then be read as "already migrated".
#[tauri::command]
pub fn appdata_clear_json(app: AppHandle, name: String) -> Result<(), String> {
    if name.is_empty()
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
    {
        return Err("Invalid file name".into());
    }
    let Ok(base) = app.path().app_data_dir() else {
        return Err("No app data directory".into());
    };
    let path: PathBuf = base.join(name);
    if !path.is_file() {
        return Err("No such file".into());
    }
    fs::write(&path, "{}").map_err(|e| format!("Could not rewrite {}: {e}", path.display()))?;
    Ok(())
}