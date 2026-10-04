// Screenshots attached to F9 chat turns.
//
// Stored as real JPEG files under local AppData rather than base64 inside
// flunkey-data.json. A 1.3 MB data URL per turn turned the settings file into
// the largest thing this app writes and made every save rewrite hundreds of
// megabytes. On disk they are individually listable, individually deletable,
// and cheap to purge when a session goes away.
//
// Local AppData, not roaming: screenshots can contain whatever was on screen
// when the user hit the hotkey, so they must not follow a profile to another
// machine.

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use base64::Engine;
use tauri::{AppHandle, Manager};

/// Guard against a runaway caller writing something that is not a JPEG.
const MAX_JPEG_BYTES: usize = 8 * 1024 * 1024;

/// Extensions we will ever delete. Anything else in the folder is not ours
/// and must be left alone.
const JPEG_EXTS: &[&str] = &["jpg", "jpeg"];

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("No local app data directory: {e}"))?
        .join("screenshots");
    fs::create_dir_all(&path).map_err(|e| format!("Could not create {}: {e}", path.display()))?;
    Ok(path)
}

/** Reject anything that could escape the folder or isn't a JPEG name. */
fn sanitized(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    let ok = !trimmed.is_empty()
        && trimmed.len() <= 64
        && trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    let ext_ok = trimmed
        .rsplit_once('.')
        .map(|(_, ext)| {
            JPEG_EXTS
                .iter()
                .any(|e| e.eq_ignore_ascii_case(ext))
        })
        .unwrap_or(false);
    if ok && ext_ok {
        Ok(trimmed.to_ascii_lowercase())
    } else {
        Err("Invalid screenshot name".into())
    }
}

/**
 * Decode a `data:image/jpeg;base64,...` URL into a uniquely named file.
 *
 * Returns the filename to store in the session; callers never see a path.
 */
#[tauri::command]
pub fn screenshot_save(app: AppHandle, data_url: String, hint: String) -> Result<String, String> {
    let comma = data_url
        .find(',')
        .ok_or("That does not look like an image data URL.")?;
    let header = &data_url[..comma];
    if !header.contains("image/jpeg") {
        return Err("Only JPEG screenshots can be stored.".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_url[comma + 1..].trim())
        .map_err(|e| format!("Could not decode the screenshot: {e}"))?;
    if bytes.is_empty() || bytes.len() > MAX_JPEG_BYTES {
        return Err("That screenshot is empty or too large to store.".into());
    }
    // JPEG magic bytes: a cheap check that also keeps a mislabelled payload
    // from being written into a folder the UI will later try to display.
    if bytes.len() < 3 || bytes[0] != 0xFF || bytes[1] != 0xD8 || bytes[2] != 0xFF {
        return Err("That file is not a JPEG image.".into());
    }

    let dir = dir(&app)?;
    // The hint makes the filename readable when browsing the folder by hand;
    // uniqueness comes from the suffix.
    let stem: String = hint
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(24)
        .collect();
    let stem = if stem.is_empty() {
        "shot".to_string()
    } else {
        stem
    };
    let name = format!("{stem}-{}.jpg", unique_suffix());
    let path = dir.join(&name);
    let mut file = fs::File::create(&path)
        .map_err(|e| format!("Could not save the screenshot: {e}"))?;
    file.write_all(&bytes)
        .map_err(|e| format!("Could not save the screenshot: {e}"))?;
    file.flush().ok();
    Ok(name)
}

/** Read one stored screenshot back as a data URL. */
#[tauri::command]
pub fn screenshot_load(app: AppHandle, name: String) -> Result<String, String> {
    let name = sanitized(&name)?;
    let path = dir(&app)?.join(&name);
    let bytes = fs::read(&path).map_err(|_| "That screenshot is no longer available.".to_string())?;
    Ok(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[tauri::command]
pub fn screenshot_delete(app: AppHandle, name: String) -> Result<(), String> {
    let name = sanitized(&name)?;
    let _ = fs::remove_file(dir(&app)?.join(&name));
    Ok(())
}

/// Delete the listed screenshots, ignoring names that are missing or invalid.
#[tauri::command]
pub fn screenshot_delete_many(app: AppHandle, names: Vec<String>) -> Result<u32, String> {
    let dir = dir(&app)?;
    let mut removed = 0;
    for name in names {
        if let Ok(name) = sanitized(&name) {
            if fs::remove_file(dir.join(&name)).is_ok() {
                removed += 1;
            }
        }
    }
    Ok(removed)
}

/// Every stored screenshot filename. Used to reconcile the folder with the
/// sessions after a crash, and to report real disk usage to the user.
#[tauri::command]
pub fn screenshot_list(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = dir(&app)?;
    let mut names: Vec<String> = fs::read_dir(&dir)
        .map_err(|e| format!("Could not read {}: {e}", dir.display()))?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let is_jpeg = name
                .rsplit_once('.')
                .map(|(_, ext)| JPEG_EXTS.iter().any(|e| e.eq_ignore_ascii_case(ext)))
                .unwrap_or(false);
            is_jpeg.then_some(name)
        })
        .collect();
    names.sort();
    Ok(names)
}

/// Total bytes held by stored screenshots, so Settings can show real usage
/// instead of guessing from the JSON size.
#[tauri::command]
pub fn screenshot_usage(app: AppHandle) -> Result<u64, String> {
    let dir = dir(&app)?;
    let mut total = 0;
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if let Ok(md) = entry.metadata() {
                if md.is_file() {
                    total += md.len();
                }
            }
        }
    }
    Ok(total)
}

/** Remove every stored screenshot. Part of "Wipe all data". */
#[tauri::command]
pub fn screenshot_wipe(app: AppHandle) -> Result<(), String> {
    let dir = dir(&app)?;
    if dir.exists() {
        fs::remove_dir_all(&dir)
            .map_err(|e| format!("Could not delete {}: {e}", dir.display()))?;
    }
    Ok(())
}

/// Nanosecond timestamp plus a little entropy; enough to avoid collisions
/// within a session without a uuid dependency.
fn unique_suffix() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let addr = &nanos as *const u128 as usize;
    format!("{:x}{:x}", nanos, addr)
}