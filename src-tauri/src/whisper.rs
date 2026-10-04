// On-device speech-to-text via whisper.cpp (MIT) with the Whisper weights in
// GGML form. The engine binary ships inside the installer; the model file is
// downloaded on demand by the user, verified against the SHA-1 digest upstream
// publishes, and stored in AppData. Nothing about a clip ever leaves the PC.

use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

pub struct WhisperModel {
    pub id: &'static str,
    pub label: &'static str,
    pub size_mib: u32,
    pub ram_mb: u32,
    pub sha1: &'static str,
    pub note: &'static str,
}

/// Sizes and RAM figures come from the whisper.cpp model table; digests are
/// the ones published in its models/README.md.
pub const MODELS: &[WhisperModel] = &[
    WhisperModel {
        id: "tiny",
        label: "Tiny",
        size_mib: 75,
        ram_mb: 273,
        sha1: "bd577a113a864445d4c299885e0cb97d4ba92b5f",
        note: "Fastest, roughest. Fine for short commands.",
    },
    WhisperModel {
        id: "base",
        label: "Base",
        size_mib: 142,
        ram_mb: 388,
        sha1: "465707469ff3a37a2b9b8d8f89f2f99de7299dac",
        note: "Recommended. Best speed and accuracy balance for dictation.",
    },
    WhisperModel {
        id: "small",
        label: "Small",
        size_mib: 466,
        ram_mb: 852,
        sha1: "55356645c2b361a969dfd0ef2c5a50d530afd8d5",
        note: "Most accurate of the three, noticeably slower.",
    },
];

/// ISO-639-1 codes whisper accepts for `-l`. Anything outside this list would
/// make the engine print an error and `exit(0)`, so we fall back to auto-detect
/// rather than handing it a value it rejects. Mirrors STT_LANGUAGES in
/// src/types.ts.
const WHISPER_LANGS: &[&str] = &[
    "en", "af", "ar", "hy", "az", "be", "bs", "bg", "ca", "zh", "hr", "cs", "da", "nl", "et", "fi",
    "fr", "gl", "de", "el", "he", "hi", "hu", "is", "id", "it", "ja", "kn", "kk", "ko", "lv", "lt",
    "mk", "ms", "mr", "mi", "ne", "no", "fa", "pl", "pt", "pa", "ro", "ru", "sr", "sk", "sl", "es",
    "sw", "sv", "tl", "ta", "th", "tr", "uk", "ur", "vi", "cy",
];

fn model_url(id: &str) -> String {
    format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{id}.bin")
}

fn find_model(id: &str) -> Option<&'static WhisperModel> {
    MODELS.iter().find(|m| m.id == id)
}

/** Directory holding only the model's own temp file. Never leaves it behind. */
struct PartFile(PathBuf);

impl PartFile {
    fn new(dir: &std::path::Path, id: &str) -> Self {
        Self(dir.join(format!("ggml-{id}.part")))
    }
}

impl Drop for PartFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

/**
 * Where models live.
 *
 * Local AppData, not roaming: the weights are hundreds of megabytes of
 * machine-specific binary and must never follow a profile to another PC or
 * stall a domain logon. Releases before this shipped them in roaming AppData,
 * so an existing install has its files moved here on first use.
 */
pub fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("No local app data directory: {e}"))?
        .join("models");
    migrate_roaming_models(app, &path);
    Ok(path)
}

/**
 * Move previously-downloaded weights out of roaming AppData.
 *
 * Called from setup so the move happens on every launch rather than only when
 * the user happens to open the Models page — otherwise machine-specific
 * weights sit in a roaming profile, which can be synced off-box or stall a
 * domain logon.
 *
 * Best effort by design: a missing folder, a read-only profile, or a file in
 * use must degrade to "the user re-downloads" rather than blocking startup. A
 * file already present at the destination is treated as newer and the roaming
 * copy is left alone.
 */
pub fn migrate_models_to_local_data(app: &AppHandle) -> Result<(), String> {
    let dest = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("No local app data directory: {e}"))?
        .join("models");
    fs::create_dir_all(&dest).map_err(|e| format!("Could not create {}: {e}", dest.display()))?;
    migrate_roaming_models(app, &dest);
    Ok(())
}

fn migrate_roaming_models(app: &AppHandle, dest: &PathBuf) {
    let Ok(base) = app.path().app_data_dir() else {
        return;
    };
    let legacy = base.join("models");
    let Ok(entries) = fs::read_dir(&legacy) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let from = legacy.join(&name);
        let to = dest.join(&name);
        if !to.exists() && fs::rename(&from, &to).is_err() {
            // Crossing a volume boundary is the likely reason; fall back to a
            // copy and only drop the original once it is safely in place.
            if let Ok(bytes) = fs::read(&from) {
                if fs::write(&to, &bytes).is_ok() {
                    let _ = fs::remove_file(&from);
                }
            }
        }
    }
}

/// Create `models/` on demand. Status reads must not create it: opening the
/// Models page should not litter the profile with an empty folder.
fn ensure_models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = models_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn model_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(models_dir(app)?.join(format!("ggml-{id}.bin")))
}

/**
 * Where the engine lives.
 *
 * Installed builds: `<exe dir>\whisper\` (bundled, so it carries the package
 * signature). Dev builds: `src-tauri\target\release\whisper\` via the Tauri
 * bundle config, after scripts/fetch-whisper.ps1 populates whisper-bin.
 */
pub fn engine_path(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    // Anchored to our own executable only. Resolving the engine relative to
    // the current working directory would happily execute a `whisper-cli.exe`
    // that happened to sit next to a folder the user opened.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("whisper").join("whisper-cli.exe"));
        }
    }
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join("whisper").join("whisper-cli.exe"));
    }
    candidates.into_iter().find(|p| p.exists())
}

/* ── Status / machine info ──────────────────────────────────────── */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub available: bool,
    pub path: Option<String>,
}

#[tauri::command]
pub fn whisper_engine_status(app: AppHandle) -> EngineStatus {
    match engine_path(&app) {
        Some(p) => EngineStatus {
            available: true,
            path: Some(p.display().to_string()),
        },
        None => EngineStatus {
            available: false,
            path: None,
        },
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineInfo {
    pub ram_total_gb: f64,
    pub ram_free_gb: f64,
    pub logical_cores: usize,
    pub disk_free_gb: f64,
}

#[cfg(target_os = "windows")]
fn memory_gb() -> (f64, f64) {
    use winapi::um::sysinfoapi::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    unsafe {
        let mut stat = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            ..std::mem::zeroed()
        };
        if GlobalMemoryStatusEx(&mut stat) == 0 {
            return (0.0, 0.0);
        }
        let gb = 1024.0 * 1024.0 * 1024.0;
        (stat.ullTotalPhys as f64 / gb, stat.ullAvailPhys as f64 / gb)
    }
}

#[cfg(not(target_os = "windows"))]
fn memory_gb() -> (f64, f64) {
    (0.0, 0.0)
}

#[cfg(target_os = "windows")]
fn disk_free_gb(path: &std::path::Path) -> f64 {
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::fileapi::GetDiskFreeSpaceExW;
    // GetDiskFreeSpaceExW takes three ULARGE_INTEGER out-params, which are
    // plain 64-bit values on the ABI. winapi models them as an accessor-only
    // union, so use an equivalent repr(C) layout and cast.
    #[repr(C)]
    struct U64Out(u64);
    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        let mut free_to_caller = U64Out(0);
        let mut total = U64Out(0);
        let mut total_free = U64Out(0);
        let ok = GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free_to_caller as *mut U64Out as *mut _,
            &mut total as *mut U64Out as *mut _,
            &mut total_free as *mut U64Out as *mut _,
        );
        if ok == 0 {
            return 0.0;
        }
        free_to_caller.0 as f64 / (1024.0 * 1024.0 * 1024.0)
    }
}

#[cfg(not(target_os = "windows"))]
fn disk_free_gb(_path: &std::path::Path) -> f64 {
    0.0
}

#[tauri::command]
pub fn whisper_machine_info(app: AppHandle) -> MachineInfo {
    let (ram_total_gb, ram_free_gb) = memory_gb();
    let logical_cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let disk = models_dir(&app)
        .map(|p| disk_free_gb(&p))
        .unwrap_or(0.0);
    MachineInfo {
        ram_total_gb,
        ram_free_gb,
        logical_cores,
        disk_free_gb: disk,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub id: String,
    pub label: String,
    pub size_mib: u32,
    pub ram_mb: u32,
    pub note: String,
    pub installed: bool,
    pub installed_bytes: u64,
    /// Bytes in an orphaned `.part` file, so a download abandoned by a crash
    /// is visible to the user instead of silently occupying disk.
    pub partial_bytes: u64,
    pub path: Option<String>,
}

#[tauri::command]
pub fn whisper_model_status(app: AppHandle) -> Vec<ModelStatus> {
    MODELS
        .iter()
        .map(|m| {
            let path = model_path(&app, m.id).ok();
            let installed_bytes = path
                .as_ref()
                .and_then(|p| fs::metadata(p).ok())
                .map(|md| md.len())
                .unwrap_or(0);
            let partial_bytes = path
                .as_ref()
                .and_then(|p| fs::metadata(p.with_extension("part")).ok())
                .map(|md| md.len())
                .unwrap_or(0);
            ModelStatus {
                id: m.id.to_string(),
                label: m.label.to_string(),
                size_mib: m.size_mib,
                ram_mb: m.ram_mb,
                note: m.note.to_string(),
                // A file smaller than the published size is a truncated
                // download, not a usable model.
                installed: installed_bytes >= (m.size_mib as u64 / 2) * 1024 * 1024,
                installed_bytes,
                partial_bytes,
                path: path.map(|p| p.display().to_string()),
            }
        })
        .collect()
}

/* ── Download ───────────────────────────────────────────────────── */

static CANCEL: AtomicBool = AtomicBool::new(false);
/// Only one download at a time; whisper-cli is loaded per call, so parallel
/// model fetches would just fight over the same file.
static DOWNLOAD_LOCK: Mutex<()> = Mutex::new(());

#[tauri::command]
pub fn whisper_cancel_download() {
    CANCEL.store(true, Ordering::SeqCst);
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    id: String,
    received: u64,
    total: u64,
    bytes_per_sec: u64,
    stage: &'static str, // "downloading" | "verifying" | "done" | "error"
    error: Option<String>,
}

#[tauri::command]
pub fn whisper_download_model(app: AppHandle, id: String) -> Result<(), String> {
    let model = find_model(&id).ok_or("Unknown model")?;
    // Held only until the worker starts, which is what makes this a
    // concurrency check rather than the serialisation itself. Recover a
    // poisoned lock instead of failing forever: a panic in an earlier call
    // must not disable downloads for the rest of the session.
    let _probe = match DOWNLOAD_LOCK.try_lock() {
        Ok(g) => g,
        Err(_) => return Err("A model download is already running.".into()),
    };
    CANCEL.store(false, Ordering::SeqCst);

    let app2 = app.clone();
    let id2 = id.clone();
    let url = model_url(&id);
    let expected = model.sha1.to_string();
    let size_hint = model.size_mib;
    std::thread::spawn(move || {
        // Actually serialise the work: the command above has already returned
        // by now, so anything that only locked in the command would have let
        // two workers run at once.
        let _serialised = DOWNLOAD_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        if let Err(e) = run_download(&app2, &id2, &url, &expected, size_hint) {
            let _ = app2.emit(
                "whisper-download-progress",
                DownloadProgress {
                    id: id2.clone(),
                    received: 0,
                    total: 0,
                    bytes_per_sec: 0,
                    stage: "error",
                    error: Some(e),
                },
            );
        }
    });
    Ok(())
}

fn run_download(
    app: &AppHandle,
    id: &str,
    url: &str,
    expected_sha1: &str,
    size_hint_mib: u32,
) -> Result<(), String> {
    use sha1::{Digest, Sha1};

    let dir = ensure_models_dir(app)?;
    let final_path = dir.join(format!("ggml-{id}.bin"));
    let part_path = dir.join(format!("ggml-{id}.part"));
    // Removes the partial download on *every* exit from this function,
    // including a panic, a cancelled run, or a network error mid-write.
    // Renaming below consumes it, at which point there is nothing to clean.
    let _part = PartFile::new(&dir, id);

    let resp = ureq::get(url)
        .set("User-Agent", "Flunkey")
        .call()
        .map_err(|e| format!("Download failed: {e}"))?;

    let total: u64 = resp
        .header("Content-Length")
        .and_then(|v| v.parse().ok())
        // Hugging Face answers some requests with chunked encoding; the
        // published size keeps the progress bar honest either way.
        .unwrap_or((size_hint_mib as u64) * 1024 * 1024);

    let mut reader = resp.into_reader();
    let mut file = fs::File::create(&part_path)
        .map_err(|e| format!("Could not write {}: {e}", part_path.display()))?;
    let mut hasher = Sha1::new();
    let mut buf = vec![0u8; 256 * 1024];
    let mut received: u64 = 0;
    let started = Instant::now();

    loop {
        if CANCEL.load(Ordering::SeqCst) {
            drop(file);
            let _ = app.emit(
                "whisper-download-progress",
                DownloadProgress {
                    id: id.to_string(),
                    received,
                    total,
                    bytes_per_sec: 0,
                    stage: "error",
                    error: Some("Download cancelled".into()),
                },
            );
            return Ok(());
        }
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("Download interrupted: {e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| format!("Write failed: {e}"))?;
        hasher.update(&buf[..n]);
        received += n as u64;
        let elapsed = started.elapsed().as_secs_f64().max(0.001);
        let _ = app.emit(
            "whisper-download-progress",
            DownloadProgress {
                id: id.to_string(),
                received,
                total,
                bytes_per_sec: (received as f64 / elapsed) as u64,
                stage: "downloading",
                error: None,
            },
        );
    }
    file.flush().ok();
    drop(file);

    let _ = app.emit(
        "whisper-download-progress",
        DownloadProgress {
            id: id.to_string(),
            received,
            total,
            bytes_per_sec: 0,
            stage: "verifying",
            error: None,
        },
    );

    let digest = hasher.finalize();
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    if hex != expected_sha1.to_ascii_lowercase() {
        return Err(format!(
            "Model file did not match the published checksum. Expected {expected_sha1}, got {hex}."
        ));
    }

    // Replace any previous model of the same id, then finalize.
    let _ = fs::remove_file(&final_path);
    fs::rename(&part_path, &final_path)
        .map_err(|e| format!("Could not finalize the model file: {e}"))?;

    let _ = app.emit(
        "whisper-download-progress",
        DownloadProgress {
            id: id.to_string(),
            received,
            total,
            bytes_per_sec: 0,
            stage: "done",
            error: None,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn whisper_delete_model(app: AppHandle, id: String) -> Result<(), String> {
    find_model(&id).ok_or("Unknown model")?;
    let path = model_path(&app, &id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Could not delete the model: {e}"))?;
    }
    let _ = fs::remove_file(path.with_extension("part"));
    // Also clear the pre-migration copy in roaming AppData so deleting a model
    // cannot leave hundreds of megabytes behind in the old location.
    if let Ok(legacy) = app.path().app_data_dir() {
        let _ = fs::remove_file(legacy.join("models").join(format!("ggml-{id}.bin")));
        let _ = fs::remove_file(legacy.join("models").join(format!("ggml-{id}.part")));
    }
    Ok(())
}

/// Delete every downloaded model, in both the current and legacy locations.
///
/// Separate from `whisper_delete_model` so "Wipe all data" can clear hundreds
/// of megabytes of weights the user would otherwise have to delete one card
/// at a time, without leaving a dir behind that reads as empty-but-valid.
#[tauri::command]
pub fn whisper_wipe_models(app: AppHandle) -> Result<(), String> {
    let _guard = DOWNLOAD_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let mut dirs = vec![models_dir(&app)?];
    if let Ok(legacy) = app.path().app_data_dir() {
        let old = legacy.join("models");
        if old != dirs[0] {
            dirs.push(old);
        }
    }
    for dir in dirs {
        if !dir.exists() {
            continue;
        }
        if let Err(e) = fs::remove_dir_all(&dir) {
            return Err(format!("Could not delete {}: {e}", dir.display()));
        }
    }
    Ok(())
}

/* ── Transcription ──────────────────────────────────────────────── */

/// One transcription at a time: whisper-cli loads the whole model per call.
static TRANSCRIBE_LOCK: Mutex<()> = Mutex::new(());

/**
 * Threads for whisper-cli.
 *
 * Half the logical cores, not all-but-one: another local inference engine
 * (Ollama) may be resident at the same time, and oversubscribing turns a
 * sub-second clip into a multi-second one.
 */
fn default_threads() -> usize {
    std::thread::available_parallelism()
        .map(|n| (n.get() / 2).max(2))
        .unwrap_or(2)
}

#[tauri::command]
pub fn whisper_transcribe(
    app: AppHandle,
    wav_base64: String,
    model: String,
    language: Option<String>,
    prompt: Option<String>,
    threads: Option<u32>,
) -> Result<String, String> {
    use base64::Engine;

    let engine = engine_path(&app).ok_or(
        "The on-device speech engine is missing from this install. Reinstall Flunkey or use a cloud voice model.",
    )?;
    let model_file = model_path(&app, &model)?;
    if !model_file.exists() {
        return Err(format!(
            "The {model} speech model isn't installed. Download it in Models & providers."
        ));
    }
    // IPC is JSON, so the clip travels as base64 rather than a byte array
    // (a 30 s clip is ~1 MB of PCM but ~1.3 MB of JSON numbers).
    let wav = base64::engine::general_purpose::STANDARD
        .decode(wav_base64.trim())
        .map_err(|e| format!("Could not decode the audio: {e}"))?;
    if wav.is_empty() {
        return Err("No audio was captured".into());
    }

    let _guard = TRANSCRIBE_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());

    // Every path is absolute and rooted in the temp dir. whisper treats `-of`
    // as a bare filename prefix and writes it relative to its own working
    // directory, so a relative value landed the transcript in the app's CWD
    // (and could not be written at all inside a read-only MSIX install).
    let work_dir = std::env::temp_dir();
    let stem = format!("flunkey-stt-{}", uuid_like());
    let wav_path = work_dir.join(format!("{stem}.wav"));
    // whisper appends ".txt" only when the given name lacks it.
    let out_prefix = work_dir.join(&stem);
    let out_path = work_dir.join(format!("{stem}.txt"));
    // Deletes the staged audio and every file the engine may have written,
    // on all of this function's return paths including a panic or a spawn
    // failure. Verbatim speech is the most sensitive thing this app handles,
    // so it must not depend on any single cleanup branch running.
    let _clip = SttClip::new(&work_dir, &stem);
    fs::write(&wav_path, &wav).map_err(|e| format!("Could not stage the audio: {e}"))?;

    // An unrecognised `-l` makes whisper print an error and exit(0) — a
    // "successful" run with no output — so only pass a code it recognises.
    let lang = match language.unwrap_or_default().trim().to_ascii_lowercase().as_str() {
        "" => "auto".to_string(),
        code if WHISPER_LANGS.contains(&code) => code.to_string(),
        _ => "auto".to_string(),
    };

    let mut args: Vec<String> = vec![
        "-m".into(),
        model_file.display().to_string(),
        "-f".into(),
        wav_path.display().to_string(),
        "-of".into(),
        out_prefix.display().to_string(),
        "-otxt".into(),
        "-np".into(),
        "-nt".into(),
        "-t".into(),
        threads.unwrap_or(default_threads() as u32).to_string(),
        "-l".into(),
        lang.clone(),
    ];
    if let Some(p) = prompt {
        if !p.trim().is_empty() {
            args.push("--prompt".into());
            args.push(p.trim().to_string());
        }
    }

    let mut child = Command::new(&engine)
        .args(&args)
        .current_dir(&work_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags_hidden()
        .spawn()
        .map_err(|e| format!("Could not start the speech engine: {e}"))?;

    // Drain both pipes concurrently. An engine that fills the ~64 KB buffer
    // would otherwise block forever and we would only notice at the timeout.
    // The stderr tail is what makes a failure diagnosable.
    let stdout_thread = child.stdout.take().map(spawn_reader);
    let stderr_thread = child.stderr.take().map(spawn_reader);

    // Hard ceiling: a stuck model must never hold a hotkey hostage.
    let deadline = Instant::now() + Duration::from_secs(60);
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Some(s),
Ok(None) => {
                    if Instant::now() > deadline {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err("The on-device transcription took too long and was stopped.".into());
                    }
                    std::thread::sleep(Duration::from_millis(40));
                }
                Err(e) => return Err(format!("Speech engine error: {e}")),
        }
    };
    let stderr_tail = stderr_thread
        .and_then(|h| h.join().ok())
        .map(|text| stderr_summary(&text))
        .unwrap_or_default();
    let _ = stdout_thread.and_then(|h| h.join().ok());

    // Exit code is not proof of success, and neither is its absence: whisper
    // exits 0 both for a rejected `-l` value and for "no speech found" (it
    // never opens the output file in that case). The output file is the only
    // positive signal.
    let text = match &status {
        Some(s) if s.success() => {
            if out_path.exists() {
                fs::read_to_string(&out_path).unwrap_or_default()
            } else {
                // Success + no file: whisper had nothing to write, which for a
                // hold-to-talk clip means silence, not a broken engine.
                return Err("No speech was detected in that clip.".into());
            }
        }
        Some(s) => {
            return Err(format!(
                "The speech engine failed (exit {}).{stderr_tail}",
                s.code().map(|c| c.to_string()).unwrap_or_else(|| "0".into()),
            ));
        }
        None => String::new(),
    };

    // Silence markers are not speech.
    let cleaned = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('['))
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();
    if cleaned.is_empty() {
        return Err("No speech was detected in that clip.".into());
    }
    Ok(cleaned)
}

/// Pick the most useful line out of the engine's stderr, if any.
fn stderr_summary(stderr: &str) -> String {
    let line = stderr
        .lines()
        .map(str::trim)
        .rev()
        .find(|l| !l.is_empty() && !l.contains("load_backend") && !l.contains("ggml_"))
        .unwrap_or("");
    if line.is_empty() {
        String::new()
    } else {
        format!(" {line}")
    }
}

/// Spawn a thread that drains a pipe so the child never blocks on it.
fn spawn_reader<R: std::io::Read + Send + 'static>(
    reader: R,
) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = Vec::new();
        let _ = reader.read_to_end(&mut buf);
        String::from_utf8_lossy(&buf).to_string()
    })
}

/// Cheap unique-enough temp name without pulling in a uuid dependency.
fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let addr = &nanos as *const u128 as usize;
    format!("{nanos:x}{addr:x}")
}

/**
 * The staged clip and everything whisper writes beside it.
 *
 * Owns deletion for the whole call: an early return, a timeout, or a panic
 * unwinding through here all drop it, so raw speech never outlives the
 * transcription that produced it.
 */
struct SttClip {
    files: Vec<PathBuf>,
}

impl SttClip {
    fn new(work_dir: &std::path::Path, stem: &str) -> Self {
        let mut files = vec![work_dir.join(format!("{stem}.wav"))];
        // -otxt is what we ask for; the others cost nothing to attempt and
        // guard against a future flag change leaving files behind.
        for ext in ["txt", "vtt", "srt", "json"] {
            files.push(work_dir.join(format!("{stem}.{ext}")));
        }
        Self { files }
    }
}

impl Drop for SttClip {
    fn drop(&mut self) {
        for f in &self.files {
            let _ = fs::remove_file(f);
        }
    }
}

/// The prefix every temp artefact of ours starts with.
const STT_PREFIX: &str = "flunkey-stt-";

/// Age above which a leftover temp artefact is treated as abandoned.
const STALE_TEMP_AGE_SECS: u64 = 60 * 60;

/// Remove temp audio and transcripts orphaned by a crash or a force-quit.
///
/// Runs on launch because a crash is exactly the case where the RAII cleanup
/// could not execute. The age check keeps a concurrent transcription in another
/// window safe: only clearly abandoned files are touched.
pub fn sweep_stale_temp_files() {
    let dir = std::env::temp_dir();
    let Ok(entries) = fs::read_dir(&dir) else {
        return;
    };
    let now = std::time::SystemTime::now();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with(STT_PREFIX) {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = meta.modified() else {
            continue;
        };
        if now.duration_since(modified).map(|d| d.as_secs()).unwrap_or(0) < STALE_TEMP_AGE_SECS {
            continue;
        }
        if meta.is_file() {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Windows-only: keep the engine's console window from flashing.
trait HiddenCreation {
    fn creation_flags_hidden(&mut self) -> &mut Self;
}

#[cfg(target_os = "windows")]
impl HiddenCreation for Command {
    fn creation_flags_hidden(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        self.creation_flags(CREATE_NO_WINDOW);
        self
    }
}

#[cfg(not(target_os = "windows"))]
impl HiddenCreation for Command {
    fn creation_flags_hidden(&mut self) -> &mut Self {
        self
    }
}
