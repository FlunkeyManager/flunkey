// Launch the local Ollama server on the user's behalf.
//
// Ollama on Windows ships as a tray app under %LOCALAPPDATA%\Programs\Ollama,
// or as a bare `ollama` binary on PATH. Starting the tray app is preferred
// (it owns the server lifecycle and the autostart entry); `ollama serve` is the
// fallback for CLI-only installs. The process is detached so the server keeps
// running after Flunkey exits.

use std::path::PathBuf;
use std::process::Command;

/// Detach so the server outlives Flunkey and never steals focus.
#[cfg(target_os = "windows")]
fn spawn_detached(cmd: &mut Command) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    cmd.spawn().map(|_| ())
}

#[cfg(not(target_os = "windows"))]
fn spawn_detached(cmd: &mut Command) -> std::io::Result<()> {
    cmd.spawn().map(|_| ())
}

fn candidate_binaries() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        out.push(
            PathBuf::from(&local)
                .join("Programs")
                .join("Ollama")
                .join("ollama.exe"),
        );
        out.push(
            PathBuf::from(&local)
                .join("Programs")
                .join("Ollama")
                .join("app")
                .join("Ollama.exe"),
        );
    }
    if let Ok(program_files) = std::env::var("ProgramFiles") {
        out.push(
            PathBuf::from(program_files)
                .join("Ollama")
                .join("ollama.exe"),
        );
    }
    out
}

/// Start Ollama. Returns the path/command that was launched.
#[tauri::command]
pub fn start_ollama() -> Result<String, String> {
    for bin in candidate_binaries() {
        if !bin.exists() {
            continue;
        }
        // The tray app lives at `app\Ollama.exe`; the CLI lives one level up.
        let is_app = bin
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase().contains("ollama.exe"))
            .unwrap_or(false)
            && bin.parent().map(|p| p.ends_with("app")).unwrap_or(false);
        let mut cmd = Command::new(&bin);
        if is_app {
            cmd.arg("app");
        } else {
            cmd.arg("serve");
        }
        spawn_detached(&mut cmd)
            .map_err(|e| format!("Could not start Ollama from {}: {e}", bin.display()))?;
        return Ok(bin.display().to_string());
    }

    // CLI-only install: rely on PATH resolution.
    let mut cmd = Command::new("ollama");
    cmd.arg("serve");
    spawn_detached(&mut cmd)
        .map(|_| "ollama (PATH)".to_string())
        .map_err(|_| {
            "Ollama isn't installed. Install it from https://ollama.com/download, then press Start again."
                .to_string()
        })
}

/// Find the PID listening on `port` (Windows). Used to stop the server
/// without touching unrelated ollama processes.
#[cfg(target_os = "windows")]
fn pid_listening_on(port: u16) -> Option<u32> {
    let out = Command::new("netstat")
        .args(["-ano", "-p", "TCP"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let needle = format!(":{port}");
    for line in text.lines() {
        if !line.to_uppercase().contains("LISTENING") {
            continue;
        }
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 5 {
            continue;
        }
        if !cols[1].ends_with(&needle) {
            continue;
        }
        if let Ok(pid) = cols[cols.len() - 1].parse::<u32>() {
            return Some(pid);
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn pid_listening_on(_port: u16) -> Option<u32> {
    None
}

fn kill_pid(pid: u32) -> bool {
    Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Stop the local Ollama server.
///
/// Targets only the process listening on the configured port so a tray app or
/// an unrelated ollama task is left alone; falls back to `ollama.exe` when the
/// port owner can't be identified. Returns Ok when nothing was running too —
/// stopping an already-stopped server is a success, not an error.
#[tauri::command]
pub fn stop_ollama(port: Option<u16>) -> Result<String, String> {
    let port = port.unwrap_or(11434);
    if let Some(pid) = pid_listening_on(port) {
        if kill_pid(pid) {
            return Ok(format!("Stopped Ollama (pid {pid})."));
        }
    }
    // Nothing found on the port — try the image by name before giving up.
    let killed = Command::new("taskkill")
        .args(["/IM", "ollama.exe", "/T", "/F"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if killed {
        return Ok("Stopped Ollama.".to_string());
    }
    Ok("Ollama wasn't running.".to_string())
}
