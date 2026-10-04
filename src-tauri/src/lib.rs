mod active_app;
mod appdata;
mod capture;
mod hotkeys;
mod ollama_launch;
mod screenshots;
mod secrets;
mod whisper;

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum OverlayEdge {
    Left,
    Right,
    Top,
    Bottom,
}

impl OverlayEdge {
    fn from_str(s: &str) -> Option<Self> {
        match s {
            "left" => Some(Self::Left),
            "right" => Some(Self::Right),
            "top" => Some(Self::Top),
            "bottom" => Some(Self::Bottom),
            _ => None,
        }
    }
}

static OVERLAY_EDGE: Mutex<OverlayEdge> = Mutex::new(OverlayEdge::Right);
static OVERLAY_FREE: Mutex<bool> = Mutex::new(false);
static OVERLAY_FREE_POS: Mutex<Option<(f64, f64)>> = Mutex::new(None);
static OVERLAY_FREE_SIZE: Mutex<Option<(f64, f64)>> = Mutex::new(None);

const OVERLAY_FREE_MIN_W: f64 = 300.0;
const OVERLAY_FREE_MIN_H: f64 = 260.0;
const OVERLAY_FREE_MAX_W: f64 = 1200.0;
const OVERLAY_FREE_MAX_H: f64 = 900.0;

/// Master switch for the pill window (Settings → hide pill). When set, no
/// code path may show or topmost-bump the pill; the flows run headless.
static PILL_DISABLED: AtomicBool = AtomicBool::new(false);

#[tauri::command]
async fn set_autostart_enabled(
    _app: tauri::AppHandle,
    enabled: bool,
) -> Result<bool, String> {
    #[cfg(feature = "msix-autostart")]
    {
        use windows::ApplicationModel::{StartupTask, StartupTaskState};
        use windows::core::HSTRING;

        let task = StartupTask::GetAsync(&HSTRING::from("FlunkeyStartup"))
            .map_err(|error| error.to_string())?
            .get()
            .map_err(|error| error.to_string())?;
        let state = task.State().map_err(|error| error.to_string())?;

        if enabled {
            if state.0 == StartupTaskState::Enabled.0
                || state.0 == StartupTaskState::EnabledByPolicy.0
            {
                return Ok(true);
            }
            if state.0 != StartupTaskState::Disabled.0 {
                return Ok(false);
            }

            let new_state = task
                .RequestEnableAsync()
                .map_err(|error| error.to_string())?
                .get()
                .map_err(|error| error.to_string())?;
            return Ok(new_state.0 == StartupTaskState::Enabled.0
                || new_state.0 == StartupTaskState::EnabledByPolicy.0);
        }

        if state.0 == StartupTaskState::Enabled.0 {
            task.Disable().map_err(|error| error.to_string())?;
        }
        let new_state = task.State().map_err(|error| error.to_string())?;
        Ok(new_state.0 != StartupTaskState::Enabled.0
            && new_state.0 != StartupTaskState::EnabledByPolicy.0)
    }

    #[cfg(not(feature = "msix-autostart"))]
    {
        let manager = _app.state::<tauri_plugin_autostart::AutoLaunchManager>();
        if enabled {
            manager.enable().map_err(|error| error.to_string())?;
        } else {
            manager.disable().map_err(|error| error.to_string())?;
        }
        manager.is_enabled().map_err(|error| error.to_string())
    }
}

fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Show the main window and navigate it to `page` (handled by the
/// frontend "navigate" listener — page ids match the sidebar).
fn show_main_and_navigate(app: &tauri::AppHandle, page: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        let _ = w.emit("navigate", page);
    }
}

#[cfg(target_os = "windows")]
mod win32_pill {
    use std::sync::atomic::{AtomicI32, Ordering};
    use std::sync::Mutex;
    use winapi::shared::minwindef::{BOOL, LPARAM, LRESULT, UINT, WPARAM};
    use winapi::shared::windef::{HWND, POINT, RECT};
    use winapi::um::winuser::{
        CallWindowProcW, EnumChildWindows, GetClientRect, GetWindowLongPtrW,
        ScreenToClient, SetWindowLongPtrW, SetWindowPos, GWLP_WNDPROC, HTTRANSPARENT,
        HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
        WM_NCHITTEST, WNDPROC,
    };

    // 0 = idle, 1 = recording, 2 = handsfree, 3 = processing
    pub static PILL_STATE_CODE: AtomicI32 = AtomicI32::new(0);
    static MAIN_PILL_HWND: Mutex<Option<isize>> = Mutex::new(None);
    static OLD_PROCS: Mutex<Vec<(isize, isize)>> = Mutex::new(Vec::new());
    static TIMER_COUNT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

    pub fn set_state_code(state: &str) {
        let code = match state {
            "recording" => 1,
            "handsfree" => 2,
            "processing" => 3,
            _ => 0, // idle
        };
        PILL_STATE_CODE.store(code, Ordering::SeqCst);
        if let Some(hwnd_val) = *MAIN_PILL_HWND.lock().unwrap() {
            unsafe {
                EnumChildWindows(hwnd_val as HWND, Some(enum_child_proc), 0);
            }
        }
    }

    unsafe extern "system" fn pill_wnd_proc(
        hwnd: HWND,
        msg: UINT,
        w_param: WPARAM,
        l_param: LPARAM,
    ) -> LRESULT {
        if msg == WM_NCHITTEST {
            let state = PILL_STATE_CODE.load(Ordering::SeqCst);
            // In idle (0), recording (1), or processing (3), all mouse cursor events
            // and clicks must pass straight through to background apps/windows!
            if state != 2 {
                return HTTRANSPARENT;
            }

            let main_hwnd = MAIN_PILL_HWND.lock().unwrap().unwrap_or(hwnd as isize) as HWND;
            let x = ((l_param as usize) & 0xFFFF) as i16 as i32;
            let y = (((l_param as usize) >> 16) & 0xFFFF) as i16 as i32;
            let mut pt = POINT { x, y };
            ScreenToClient(main_hwnd, &mut pt);

            let mut rect: RECT = std::mem::zeroed();
            GetClientRect(main_hwnd, &mut rect);
            let width = rect.right - rect.left;
            let height = rect.bottom - rect.top;

            if width > 0 && height > 0 {
                let center_x = width / 2;
                let scale = (height as f64) / 112.0;
                let pill_bottom = height - (14.0 * scale).round() as i32;
                let (pill_width, pill_height) = (154.0, 32.0); // handsfree bounds
                let hover_buffer = 2.0;
                let top_limit =
                    pill_bottom - ((pill_height + hover_buffer) * scale).round() as i32;
                let bottom_limit = pill_bottom + (hover_buffer * scale).round() as i32;

                let half_w = (((pill_width / 2.0) + hover_buffer) * scale).round() as i32;

                let left_limit = center_x - half_w;
                let right_limit = center_x + half_w;

                let is_inside = pt.y >= top_limit
                    && pt.y <= bottom_limit
                    && pt.x >= left_limit
                    && pt.x <= right_limit;

                if !is_inside {
                    return HTTRANSPARENT;
                } else {
                    return winapi::um::winuser::HTCLIENT;
                }
            }
        }

        // Call previous window proc
        let old_proc = {
            let guard = OLD_PROCS.lock().unwrap();
            guard
                .iter()
                .find(|(h, _)| *h == hwnd as isize)
                .map(|(_, p)| *p)
        };

        if let Some(prev) = old_proc {
            let prev_fn: WNDPROC = std::mem::transmute(prev);
            CallWindowProcW(prev_fn, hwnd, msg, w_param, l_param)
        } else {
            winapi::um::winuser::DefWindowProcW(hwnd, msg, w_param, l_param)
        }
    }

    unsafe extern "system" fn enum_child_proc(hwnd: HWND, _lparam: LPARAM) -> BOOL {
        subclass_hwnd(hwnd);
        1
    }

    unsafe extern "system" fn timer_proc(hwnd: HWND, _msg: UINT, id: usize, _time: u32) {
        EnumChildWindows(hwnd, Some(enum_child_proc), 0);
        let count = TIMER_COUNT.fetch_add(1, Ordering::SeqCst);
        if count > 15 {
            winapi::um::winuser::KillTimer(hwnd, id);
        }
    }

    unsafe fn subclass_hwnd(hwnd: HWND) {
        let hwnd_val = hwnd as isize;
        let mut guard = OLD_PROCS.lock().unwrap();
        if guard.iter().any(|(h, _)| *h == hwnd_val) {
            return;
        }
        let old = GetWindowLongPtrW(hwnd, GWLP_WNDPROC);
        let new_proc = pill_wnd_proc as *const () as usize as isize;
        if old != 0 && old != new_proc {
            guard.push((hwnd_val, old));
            SetWindowLongPtrW(hwnd, GWLP_WNDPROC, new_proc);
        }
    }

    pub fn setup_pill_hittest(window: &tauri::WebviewWindow) {
        if let Ok(hwnd) = window.hwnd() {
            let raw_hwnd = hwnd.0 as HWND;
            *MAIN_PILL_HWND.lock().unwrap() = Some(raw_hwnd as isize);
            unsafe {
                subclass_hwnd(raw_hwnd);
                EnumChildWindows(raw_hwnd, Some(enum_child_proc), 0);
                // Subclass child windows as WebView2 finishes launching
                winapi::um::winuser::SetTimer(raw_hwnd, 101, 150, Some(timer_proc));
            }
        }
    }

    pub fn force_pill_topmost_native(window: &tauri::WebviewWindow) {
        if let Ok(hwnd) = window.hwnd() {
            let raw_hwnd = hwnd.0 as HWND;
            unsafe {
                SetWindowPos(
                    raw_hwnd,
                    HWND_TOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
                );
                EnumChildWindows(raw_hwnd, Some(enum_child_proc), 0);
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod win32_pill {
    pub fn set_state_code(_state: &str) {}
    pub fn setup_pill_hittest(_window: &tauri::WebviewWindow) {}
    pub fn force_pill_topmost_native(_window: &tauri::WebviewWindow) {}
}

/// True for origins the app itself serves: the Tauri custom-protocol origin
/// in production (`https://tauri.localhost`) and the Vite dev server /
/// loopback in `tauri dev`. Only these origins may receive a silent
/// microphone grant — anything else falls through to WebView2 defaults.
#[cfg(windows)]
fn is_app_origin(uri: &str) -> bool {
    let rest = match uri
        .strip_prefix("https://")
        .or_else(|| uri.strip_prefix("http://"))
    {
        Some(rest) => rest,
        None => return false,
    };
    let host = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("");
    host == "tauri.localhost" || host == "localhost" || host == "127.0.0.1"
}

/// Silence WebView2's native permission popup ("tauri.localhost wants to
/// access your mic") by auto-allowing microphone requests from the app's
/// own origin. The frontend Onboarding Allow button remains the user-facing
/// consent; the Windows OS mic privacy toggle still applies on top.
#[cfg(windows)]
fn grant_webview_mic_permission(win: &tauri::WebviewWindow) {
    let label = win.label().to_string();
    let _ = win.with_webview(move |webview| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2, ICoreWebView2PermissionRequestedEventArgs,
            COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
            COREWEBVIEW2_PERMISSION_STATE_ALLOW,
        };
        use webview2_com::{take_pwstr, PermissionRequestedEventHandler};

        let core: ICoreWebView2 = match unsafe { webview.controller().CoreWebView2() } {
            Ok(core) => core,
            Err(e) => {
                eprintln!("WebView2: CoreWebView2 unavailable on '{label}': {e}");
                return;
            }
        };
        let handler = PermissionRequestedEventHandler::create(Box::new(
            move |_core: Option<ICoreWebView2>,
                  args: Option<ICoreWebView2PermissionRequestedEventArgs>|
                  -> windows_core::Result<()> {
                let args = match args {
                    Some(args) => args,
                    None => return Ok(()),
                };
                unsafe {
                    let mut kind =
                        webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PERMISSION_KIND::default();
                    args.PermissionKind(&mut kind)?;
                    if kind != COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                        return Ok(());
                    }
                    let mut uri = windows_core::PWSTR::null();
                    args.Uri(&mut uri)?;
                    if is_app_origin(&take_pwstr(uri)) {
                        args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                    }
                }
                Ok(())
            },
        ));
        let mut token = 0i64;
        if unsafe { core.add_PermissionRequested(&handler, &mut token) }.is_err() {
            eprintln!("WebView2: PermissionRequested handler failed on '{label}'");
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            // ── Clean up temp audio orphaned by a crash ───────────
            // A hard kill or power loss skips in-transcription cleanup, so
            // the only reliable recovery is the next launch.
            whisper::sweep_stale_temp_files();

            // Move any speech models out of the roaming profile. Done here
            // rather than lazily inside models_dir() because otherwise the
            // move waits until the user opens the Models page, leaving
            // machine-specific weights sitting in a roaming profile that may
            // be synced or block a domain logon in the meantime.
            if let Err(err) = whisper::migrate_models_to_local_data(&app.handle().clone()) {
                eprintln!("[whisper] Could not relocate speech models: {err}");
            }

            

            // ── Mic permission: silence WebView2's "tauri.localhost wants
            // to access your mic" popup. The Onboarding Allow button is the
            // user-facing consent; this auto-grants at the WebView layer for
            // the app origin only (all windows for future-proofing).
            #[cfg(windows)]
            for label in ["main", "overlay", "pill"] {
                if let Some(win) = app.get_webview_window(label) {
                    grant_webview_mic_permission(&win);
                }
            }

            // ── Position helper windows ──────────────────────────
            if let Some(pill) = app.get_webview_window("pill") {
                position_pill(&pill);
                win32_pill::setup_pill_hittest(&pill);
                win32_pill::set_state_code("idle");
                // Always-on thin line — show immediately as idle, not hidden
                let _ = pill.show();
                let _ = pill.set_always_on_top(true);
                let _ = pill.set_focusable(false);
                let _ = pill.set_ignore_cursor_events(true);
                win32_pill::force_pill_topmost_native(&pill);
                let _ = pill.emit("pill-state", serde_json::json!({ "state": "idle" }));
            }
            if let Some(overlay) = app.get_webview_window("overlay") {
                position_overlay(&overlay);
                let _ = overlay.hide();
            }

            // ── System tray ─────────────────────────────────────
            // Every page in the sidebar is reachable from here. Page items
            // show the main window AND navigate it (previously only
            // Open/Settings/Quit existed, and Settings emitted a "navigate"
            // event nothing listened to).
            let show_item = MenuItem::with_id(app, "show", "Open Flunkey", true, None::<&str>)?;
            let sep_pages = PredefinedMenuItem::separator(app)?;
            let dashboard_item = MenuItem::with_id(app, "nav-dashboard", "Dashboard", true, None::<&str>)?;
            let history_item = MenuItem::with_id(app, "nav-history", "Chat History", true, None::<&str>)?;
            let transcripts_item = MenuItem::with_id(app, "nav-transcripts", "Transcripts", true, None::<&str>)?;
            let transforms_item = MenuItem::with_id(app, "nav-transforms", "Transforms", true, None::<&str>)?;
            let dictionary_item = MenuItem::with_id(app, "nav-dictionary", "Dictionary", true, None::<&str>)?;
            let models_item = MenuItem::with_id(app, "nav-models", "Models & Providers", true, None::<&str>)?;
            let analytics_item = MenuItem::with_id(app, "nav-analytics", "Analytics", true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "nav-settings", "Settings", true, None::<&str>)?;
            let sep_quit = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &show_item,
                    &sep_pages,
                    &dashboard_item,
                    &history_item,
                    &transcripts_item,
                    &transforms_item,
                    &dictionary_item,
                    &models_item,
                    &analytics_item,
                    &settings_item,
                    &sep_quit,
                    &quit_item,
                ],
            )?;

            // Resolved against the app's own resource dir: a relative path
            // resolves against the process CWD, which is never the install
            // folder in a real launch.
            let tray_icon: Image = app
                        .path()
                        .resource_dir()
                        .ok()
                        .map(|dir| dir.join("icons").join("32x32.png"))
                        .and_then(|p| Image::from_path(p).ok())
                        .or_else(|| app.default_window_icon().cloned())
                        .unwrap();

            let _tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&menu)
                .tooltip("Flunkey — F8/F9 active")
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => {
                        focus_main_window(app);
                    }
                    "nav-dashboard" => {
                        show_main_and_navigate(app, "dashboard");
                    }
                    "nav-history" => {
                        show_main_and_navigate(app, "history");
                    }
                    "nav-transcripts" => {
                        show_main_and_navigate(app, "transcripts");
                    }
                    "nav-transforms" => {
                        show_main_and_navigate(app, "transforms");
                    }
                    "nav-dictionary" => {
                        show_main_and_navigate(app, "dictionary");
                    }
                    "nav-models" => {
                        show_main_and_navigate(app, "models");
                    }
                    "nav-analytics" => {
                        show_main_and_navigate(app, "analytics");
                    }
                    "nav-settings" => {
                        show_main_and_navigate(app, "settings");
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                        focus_main_window(&tray.app_handle());
                    }
                })
                .build(app)?;

            // ── Close-to-tray & Prevent Destruction on helper windows ──────
            if let Some(main_window) = app.get_webview_window("main") {
                let main_handle = main_window.clone();
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = main_handle.hide();
                    }
                });
            }

            if let Some(pill) = app.get_webview_window("pill") {
                pill.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                    }
                });
            }

            if let Some(overlay) = app.get_webview_window("overlay") {
                let overlay_handle = overlay.clone();
                overlay.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = overlay_handle.hide();
                    }
                });
            }

            // ── Start the low-level keyboard hook on a dedicated thread ──
            let app_handle = app.handle().clone();
            set_app_handle(app_handle.clone());
            std::thread::spawn(move || {
                start_keyboard_hook(app_handle);
            });

            // ── Pill visibility watchdog ───────────────────────
            // If another app with TOPMOST covers the pill (idle thin line),
            // poll and re-bump Z-order and DWM composition redraw so the pill remains rendered.
            let watchdog_handle = app.handle().clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    if PILL_DISABLED.load(Ordering::SeqCst) {
                        continue;
                    }
                    if let Some(pill) = watchdog_handle.get_webview_window("pill") {
                        let visible = pill.is_visible().unwrap_or(true);
                        if !visible {
                            let _ = pill.show();
                            let _ = pill.unminimize();
                        }
                        win32_pill::force_pill_topmost_native(&pill);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            show_recording_pill,
            hide_recording_pill,
            set_pill_state,
            set_pill_disabled,
            ensure_pill_visible,
            show_overlay,
            hide_overlay,
            set_overlay_layout,
            save_overlay_free_bounds,
            is_overlay_free,
            simulate_paste,
            simulate_copy,
            simulate_paste_plain,
            get_active_app,
            capture::capture_sources,
            capture::capture_screen,
            ollama_launch::start_ollama,
            ollama_launch::stop_ollama,
            whisper::whisper_engine_status,
            whisper::whisper_machine_info,
            whisper::whisper_model_status,
            whisper::whisper_download_model,
            whisper::whisper_cancel_download,
            whisper::whisper_delete_model,
            whisper::whisper_wipe_models,
            whisper::whisper_transcribe,
            appdata::appdata_read_json,
            appdata::appdata_clear_json,
            screenshots::screenshot_save,
            screenshots::screenshot_load,
            screenshots::screenshot_delete,
            screenshots::screenshot_delete_many,
            screenshots::screenshot_list,
            screenshots::screenshot_usage,
            screenshots::screenshot_wipe,
            secret_set,
            secret_get,
            secret_delete,
            overlay_sync_chat,
            overlay_append_token,
            overlay_stream_end,
            set_hotkeys,
            set_autostart_enabled,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ═══════════════════════════════════════════════════════════════
// Low-level keyboard hook for F8 / F9 / F10 hold-and-release.
// The Transform (F10) binding is swallowed (see transform_key_consumes)
// so the foreground app never sees F10 and keeps text focus.
// ═══════════════════════════════════════════════════════════════

#[cfg(target_os = "windows")]
fn start_keyboard_hook(_app: tauri::AppHandle) {
    use std::ptr;
    use winapi::shared::minwindef::{LPARAM, LRESULT, WPARAM};
    use winapi::um::libloaderapi::GetModuleHandleW;
    use winapi::um::winuser::{
        CallNextHookEx, GetMessageW, SetWindowsHookExW, KBDLLHOOKSTRUCT, MSG, VK_ESCAPE,
        WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    unsafe extern "system" fn hook_proc(n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
        if n_code >= 0 {
            let kb = &*(l_param as *const KBDLLHOOKSTRUCT);
            let vk = kb.vkCode as i32;
            let scan_code = kb.scanCode as i32;

            let is_down = w_param as u32 == WM_KEYDOWN || w_param as u32 == WM_SYSKEYDOWN;
            let is_up = w_param as u32 == WM_KEYUP || w_param as u32 == WM_SYSKEYUP;

            // Swallow the Transform hotkey so the foreground app never sees
            // F10 (which would open e.g. Notepad's menu and steal focus,
            // breaking the Ctrl+C capture). Computed before emitting so both
            // the down- and up-stroke are consumed symmetrically.
            let transform_consumed =
                (is_down || is_up) && hotkeys::transform_key_consumes(vk, scan_code);

            if vk == VK_ESCAPE && is_down {
                if let Some(handle) = get_app_handle() {
                    if overlay_is_visible(&handle) {
                        hide_overlay_window(&handle);
                        emit_main(&handle, "f9-overlay-escaped");
                    }
                }
            }

            if let Some(handle) = get_app_handle() {
                let handle_ref = handle.clone();
                hotkeys::handle_keyboard_event(vk, scan_code, is_down, is_up, &|event| {
                    // Keep pill visible immediately without driving its morph state.
                    // Morph (recording ↔ handsfree ↔ processing) is fully owned by
                    // the frontend App.tsx double-tap logic; emitting here would
                    // overwrite the handsfree transition (second F8 tap within 400ms)
                    // and break double-tap → handsfree.
                    if event == "f8-start"
                        || event == "f9-start"
                        || event == "transform-start"
                        || event == "f8-stop"
                        || event == "f9-stop"
                        || event == "transform-stop"
                    {
                        ensure_pill_visible_and_on_top(&handle_ref);
                    }
                    emit_main(&handle_ref, event);
                });
            }

            if transform_consumed {
                // Don't pass F10 on: the app must keep focus in its text
                // control so our Ctrl+C captures the selection.
                return 1;
            }
        }

        CallNextHookEx(ptr::null_mut(), n_code, w_param, l_param)
    }

    unsafe {
        let h_mod = GetModuleHandleW(ptr::null());
        let _hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), h_mod, 0);

        // Must pump messages on this thread to keep the hook alive
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, ptr::null_mut(), 0, 0) != 0 {
            // Just pumping — no dispatch needed
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn start_keyboard_hook(_app: tauri::AppHandle) {
    // No-op on non-Windows platforms
}

// ── Global app handle store (for the hook callback) ─────────────

use std::sync::OnceLock;

static GLOBAL_APP_HANDLE: OnceLock<Mutex<Option<tauri::AppHandle>>> = OnceLock::new();

fn set_app_handle(handle: tauri::AppHandle) {
    let store = GLOBAL_APP_HANDLE.get_or_init(|| Mutex::new(None));
    *store.lock().unwrap() = Some(handle);
}

fn get_app_handle() -> Option<tauri::AppHandle> {
    GLOBAL_APP_HANDLE
        .get()
        .and_then(|m| m.lock().ok())
        .and_then(|guard| guard.clone())
}

fn emit_main(app: &tauri::AppHandle, event: &str) {
    let _ = app.emit_to("main", event, ());
}

fn overlay_is_visible(app: &tauri::AppHandle) -> bool {
    app.get_webview_window("overlay")
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false)
}

fn hide_overlay_window(app: &tauri::AppHandle) {
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
    }

    // Return focus to main window
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_focus();
    }
}

// ── Pill visibility helpers ─────────────────────────────────────
fn force_pill_topmost(window: &tauri::WebviewWindow) {
    let _ = window.set_always_on_top(true);
    win32_pill::force_pill_topmost_native(window);
}

fn ensure_pill_visible_and_on_top(app: &tauri::AppHandle) {
    if PILL_DISABLED.load(Ordering::SeqCst) {
        return;
    }
    if let Some(pill) = app.get_webview_window("pill") {
        let _ = pill.unminimize();
        let _ = pill.show();
        force_pill_topmost(&pill);
    }
}

#[tauri::command]
fn set_pill_disabled(app: tauri::AppHandle, disabled: bool) -> Result<(), String> {
    PILL_DISABLED.store(disabled, Ordering::SeqCst);
    win32_pill::set_state_code("idle");
    if let Some(pill) = app.get_webview_window("pill") {
        if disabled {
            let _ = pill.hide();
        } else {
            ensure_pill_visible_and_on_top(&app);
            let _ = pill.emit("pill-state", serde_json::json!({ "state": "idle" }));
            let _ = pill.emit("pill-recording", serde_json::json!({ "recording": false }));
        }
    }
    Ok(())
}

// ═══════════════════════════════════════════════════════════════
// Tauri Commands
// ═══════════════════════════════════════════════════════════════

#[tauri::command]
fn set_hotkeys(hotkeys: hotkeys::AppHotkeys) -> Result<(), String> {
    hotkeys::set_hotkeys(hotkeys);
    Ok(())
}

#[tauri::command]
fn show_recording_pill(app: tauri::AppHandle) -> Result<(), String> {
    win32_pill::set_state_code("recording");
    let pill = app
        .get_webview_window("pill")
        .ok_or_else(|| "pill window not found".to_string())?;
    let _ = pill.set_ignore_cursor_events(true);
    let _ = pill.emit("pill-state", serde_json::json!({ "state": "recording" }));
    let _ = pill.emit("pill-recording", serde_json::json!({ "recording": true }));
    let _ = pill.emit("pill-visibility", true);
    Ok(())
}

#[tauri::command]
fn hide_recording_pill(app: tauri::AppHandle) -> Result<(), String> {
    win32_pill::set_state_code("processing");
    let pill = app
        .get_webview_window("pill")
        .ok_or_else(|| "pill window not found".to_string())?;
    let _ = pill.set_ignore_cursor_events(true);
    let _ = pill.emit("pill-state", serde_json::json!({ "state": "processing" }));
    let _ = pill.emit("pill-recording", serde_json::json!({ "recording": false }));
    let _ = pill.emit("pill-visibility", serde_json::json!({ "state": "processing" }));
    Ok(())
}

#[tauri::command]
fn set_pill_state(app: tauri::AppHandle, state: String) -> Result<(), String> {
    win32_pill::set_state_code(&state);
    let pill = app.get_webview_window("pill").ok_or_else(|| "pill window not found".to_string())?;
    let s = state.as_str();
    let _ = pill.set_ignore_cursor_events(s != "handsfree");
    let _ = pill.emit("pill-state", serde_json::json!({ "state": s }));
    Ok(())
}

#[tauri::command]
fn ensure_pill_visible(app: tauri::AppHandle) -> Result<(), String> {
    ensure_pill_visible_and_on_top(&app);
    Ok(())
}

#[tauri::command]
fn show_overlay(app: tauri::AppHandle) -> Result<(), String> {
    let overlay = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window not found".to_string())?;
    position_overlay(&overlay);
    emit_overlay_drag_enabled(&overlay)?;
    overlay.show().map_err(|e| e.to_string())?;
    // Make overlay focusable so text selection + Ctrl+C works like ChatGPT side panel
    let _ = overlay.set_focusable(true);
    let _ = overlay.set_focus();
    Ok(())
}

#[tauri::command]
fn set_overlay_layout(
    app: tauri::AppHandle,
    position: String,
    free: bool,
    x: Option<f64>,
    y: Option<f64>,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<(), String> {
    let edge = OverlayEdge::from_str(position.trim())
        .ok_or_else(|| format!("invalid overlay position: {position}"))?;
    *OVERLAY_EDGE.lock().map_err(|e| e.to_string())? = edge;
    *OVERLAY_FREE.lock().map_err(|e| e.to_string())? = free;
    *OVERLAY_FREE_POS.lock().map_err(|e| e.to_string())? = match (x, y) {
        (Some(x), Some(y)) => Some((x, y)),
        _ => None,
    };
    *OVERLAY_FREE_SIZE.lock().map_err(|e| e.to_string())? = match (width, height) {
        (Some(w), Some(h)) => Some((w, h)),
        _ => None,
    };
    if let Some(overlay) = app.get_webview_window("overlay") {
        position_overlay(&overlay);
        emit_overlay_drag_enabled(&overlay)?;
    }
    Ok(())
}

#[tauri::command]
fn is_overlay_free() -> Result<bool, String> {
    Ok(OVERLAY_FREE.lock().map(|g| *g).unwrap_or(false))
}

#[tauri::command]
fn save_overlay_free_bounds(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if !*OVERLAY_FREE.lock().map_err(|e| e.to_string())? {
        return Ok(());
    }

    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let x = pos.x as f64 / scale;
    let y = pos.y as f64 / scale;
    let width = (size.width as f64 / scale).clamp(OVERLAY_FREE_MIN_W, OVERLAY_FREE_MAX_W);
    let height = (size.height as f64 / scale).clamp(OVERLAY_FREE_MIN_H, OVERLAY_FREE_MAX_H);

    *OVERLAY_FREE_POS.lock().map_err(|e| e.to_string())? = Some((x, y));
    *OVERLAY_FREE_SIZE.lock().map_err(|e| e.to_string())? = Some((width, height));
    let _ = app.emit(
        "overlay-free-bounds-changed",
        serde_json::json!({ "x": x, "y": y, "width": width, "height": height }),
    );
    Ok(())
}

fn emit_overlay_drag_enabled(window: &tauri::WebviewWindow) -> Result<(), String> {
    let free = *OVERLAY_FREE.lock().map_err(|e| e.to_string())?;
    window
        .emit("overlay-drag-enabled", free)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn hide_overlay(app: tauri::AppHandle) -> Result<(), String> {
    let overlay = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window not found".to_string())?;
    overlay.hide().map_err(|e| e.to_string())?;

    // Return focus to main window
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_focus();
    }

    Ok(())
}

#[tauri::command]
fn simulate_paste() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::mem;
        use winapi::um::winuser::{
            SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL,
        };

        unsafe {
            let mut inputs: [INPUT; 4] = mem::zeroed();

            // Press Ctrl
            inputs[0].type_ = INPUT_KEYBOARD;
            *inputs[0].u.ki_mut() = KEYBDINPUT {
                wVk: VK_CONTROL as u16,
                wScan: 0,
                dwFlags: 0,
                time: 0,
                dwExtraInfo: 0,
            };

            // Press V
            inputs[1].type_ = INPUT_KEYBOARD;
            *inputs[1].u.ki_mut() = KEYBDINPUT {
                wVk: 0x56,
                wScan: 0,
                dwFlags: 0,
                time: 0,
                dwExtraInfo: 0,
            };

            // Release V
            inputs[2].type_ = INPUT_KEYBOARD;
            *inputs[2].u.ki_mut() = KEYBDINPUT {
                wVk: 0x56,
                wScan: 0,
                dwFlags: KEYEVENTF_KEYUP,
                time: 0,
                dwExtraInfo: 0,
            };

            // Release Ctrl
            inputs[3].type_ = INPUT_KEYBOARD;
            *inputs[3].u.ki_mut() = KEYBDINPUT {
                wVk: VK_CONTROL as u16,
                wScan: 0,
                dwFlags: KEYEVENTF_KEYUP,
                time: 0,
                dwExtraInfo: 0,
            };

            let sent = SendInput(4, inputs.as_mut_ptr(), mem::size_of::<INPUT>() as i32);
            if sent != 4 {
                return Err("SendInput failed".to_string());
            }
        }
    }
    Ok(())
}

// Simulate Ctrl+Shift+V — the paste chord for apps/consoles where plain
// Ctrl+V is bound to something else. Same burst shape as simulate_paste.
#[tauri::command]
fn simulate_paste_plain() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::mem;
        use winapi::um::winuser::{
            SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL, VK_SHIFT,
        };

        unsafe {
            let mut inputs: [INPUT; 6] = mem::zeroed();

            // Press Ctrl
            inputs[0].type_ = INPUT_KEYBOARD;
            *inputs[0].u.ki_mut() = KEYBDINPUT {
                wVk: VK_CONTROL as u16,
                wScan: 0,
                dwFlags: 0,
                time: 0,
                dwExtraInfo: 0,
            };

            // Press Shift
            inputs[1].type_ = INPUT_KEYBOARD;
            *inputs[1].u.ki_mut() = KEYBDINPUT {
                wVk: VK_SHIFT as u16,
                wScan: 0,
                dwFlags: 0,
                time: 0,
                dwExtraInfo: 0,
            };

            // Press V
            inputs[2].type_ = INPUT_KEYBOARD;
            *inputs[2].u.ki_mut() = KEYBDINPUT {
                wVk: 0x56,
                wScan: 0,
                dwFlags: 0,
                time: 0,
                dwExtraInfo: 0,
            };

            // Release V
            inputs[3].type_ = INPUT_KEYBOARD;
            *inputs[3].u.ki_mut() = KEYBDINPUT {
                wVk: 0x56,
                wScan: 0,
                dwFlags: KEYEVENTF_KEYUP,
                time: 0,
                dwExtraInfo: 0,
            };

            // Release Shift
            inputs[4].type_ = INPUT_KEYBOARD;
            *inputs[4].u.ki_mut() = KEYBDINPUT {
                wVk: VK_SHIFT as u16,
                wScan: 0,
                dwFlags: KEYEVENTF_KEYUP,
                time: 0,
                dwExtraInfo: 0,
            };

            // Release Ctrl
            inputs[5].type_ = INPUT_KEYBOARD;
            *inputs[5].u.ki_mut() = KEYBDINPUT {
                wVk: VK_CONTROL as u16,
                wScan: 0,
                dwFlags: KEYEVENTF_KEYUP,
                time: 0,
                dwExtraInfo: 0,
            };

            let sent = SendInput(6, inputs.as_mut_ptr(), mem::size_of::<INPUT>() as i32);
            if sent != 6 {
                return Err("SendInput failed".to_string());
            }
        }
    }
    Ok(())
}

// Foreground app identity for per-app transcription profiles.
// Local-only, best-effort: never fails, degrades to { exe: "unknown" }.
#[tauri::command]
fn get_active_app() -> active_app::ActiveApp {
    active_app::get_foreground_app()
}

// OS keyring (Windows Credential Manager) for API keys. Thin wrappers —
// crypto lives in secrets.rs.
#[tauri::command]
fn secret_set(account: String, secret: String) -> Result<(), String> {
    secrets::store(&account, &secret)
}

#[tauri::command]
fn secret_get(account: String) -> Result<Option<String>, String> {
    secrets::retrieve(&account)
}

#[tauri::command]
fn secret_delete(account: String) -> Result<(), String> {
    secrets::remove(&account)
}

// Simulate Ctrl+C to copy current selection into the clipboard.
// Down-strokes and up-strokes are sent as two bursts with a short pause:
// a single zero-delay burst is occasionally processed incompletely by the
// foreground app, which previously surfaced as F10 "Copy failed".
#[tauri::command]
fn simulate_copy() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::mem;
        use winapi::um::winuser::{
            SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL,
        };

        unsafe {
            let mut downs: [INPUT; 2] = mem::zeroed();

            // Press Ctrl
            downs[0].type_ = INPUT_KEYBOARD;
            *downs[0].u.ki_mut() = KEYBDINPUT {
                wVk: VK_CONTROL as u16,
                wScan: 0,
                dwFlags: 0,
                time: 0,
                dwExtraInfo: 0,
            };

            // Press C
            downs[1].type_ = INPUT_KEYBOARD;
            *downs[1].u.ki_mut() = KEYBDINPUT {
                wVk: 0x43,
                wScan: 0,
                dwFlags: 0,
                time: 0,
                dwExtraInfo: 0,
            };

            let sent = SendInput(2, downs.as_mut_ptr(), mem::size_of::<INPUT>() as i32);
            if sent != 2 {
                return Err("SendInput failed".to_string());
            }

            // Let the foreground app register the chord before release.
            std::thread::sleep(std::time::Duration::from_millis(20));

            let mut ups: [INPUT; 2] = mem::zeroed();

            // Release C
            ups[0].type_ = INPUT_KEYBOARD;
            *ups[0].u.ki_mut() = KEYBDINPUT {
                wVk: 0x43,
                wScan: 0,
                dwFlags: KEYEVENTF_KEYUP,
                time: 0,
                dwExtraInfo: 0,
            };

            // Release Ctrl
            ups[1].type_ = INPUT_KEYBOARD;
            *ups[1].u.ki_mut() = KEYBDINPUT {
                wVk: VK_CONTROL as u16,
                wScan: 0,
                dwFlags: KEYEVENTF_KEYUP,
                time: 0,
                dwExtraInfo: 0,
            };

            let sent = SendInput(2, ups.as_mut_ptr(), mem::size_of::<INPUT>() as i32);
            if sent != 2 {
                return Err("SendInput failed".to_string());
            }
        }
    }
    Ok(())
}

#[derive(serde::Serialize, Clone)]
struct OverlayChatPayload {
    continuous: bool,
    messages: Vec<OverlayChatMessage>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OverlayChatMessage {
    role: String,
    content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    image_data_url: Option<String>,
}

#[tauri::command]
fn overlay_sync_chat(
    app: tauri::AppHandle,
    continuous: bool,
    messages: Vec<OverlayChatMessage>,
) -> Result<(), String> {
    let overlay = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window not found".to_string())?;
    overlay
        .emit(
            "sync-chat",
            OverlayChatPayload {
                continuous,
                messages,
            },
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn overlay_stream_end(app: tauri::AppHandle) -> Result<(), String> {
    let overlay = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window not found".to_string())?;
    overlay.emit("stream-end", ()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn overlay_append_token(app: tauri::AppHandle, token: String) -> Result<(), String> {
    let overlay = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window not found".to_string())?;
    overlay
        .emit("append-token", token)
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════
// Window positioning helpers
// ═══════════════════════════════════════════════════════════════

fn position_pill(window: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        // Dynamic size — window is kept small (idle 110×48) and expands only when pill/toast needs it; click-through for transparent area is handled by win32 WM_NCHITTEST
        let (win_w, win_h) = window
            .outer_size()
            .ok()
            .map(|s| (s.width as f64 / scale, s.height as f64 / scale))
            .unwrap_or((110.0, 48.0));
        let margin_bottom = 44.0;
        let x = (size.width as f64 / scale - win_w) / 2.0;
        let y = (size.height as f64 / scale) - win_h - margin_bottom;
        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
    }
}

fn overlay_dimensions(edge: OverlayEdge) -> (f64, f64) {
    match edge {
        OverlayEdge::Left | OverlayEdge::Right => (420.0, 720.0),
        OverlayEdge::Top | OverlayEdge::Bottom => (720.0, 420.0),
    }
}

fn fixed_overlay_position(
    edge: OverlayEdge,
    screen_w: f64,
    screen_h: f64,
    w: f64,
    h: f64,
) -> (f64, f64) {
    let margin = 18.0;
    match edge {
        OverlayEdge::Right => (screen_w - w - margin, (screen_h - h) / 2.0),
        OverlayEdge::Left => (margin, (screen_h - h) / 2.0),
        OverlayEdge::Top => ((screen_w - w) / 2.0, margin),
        OverlayEdge::Bottom => ((screen_w - w) / 2.0, screen_h - h - margin),
    }
}

fn clamp_overlay_size(w: f64, h: f64) -> (f64, f64) {
    (
        w.clamp(OVERLAY_FREE_MIN_W, OVERLAY_FREE_MAX_W),
        h.clamp(OVERLAY_FREE_MIN_H, OVERLAY_FREE_MAX_H),
    )
}

fn position_overlay(window: &tauri::WebviewWindow) {
    let edge = OVERLAY_EDGE
        .lock()
        .map(|g| *g)
        .unwrap_or(OverlayEdge::Right);
    let free = OVERLAY_FREE.lock().map(|g| *g).unwrap_or(false);

    let (mut w, mut h) = overlay_dimensions(edge);
    if free {
        if let Ok(Some((fw, fh))) = OVERLAY_FREE_SIZE.lock().map(|g| *g) {
            (w, h) = clamp_overlay_size(fw, fh);
        }
    }

    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
        width: w,
        height: h,
    }));

    if let Ok(Some(monitor)) = window.primary_monitor() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let screen_w = size.width as f64 / scale;
        let screen_h = size.height as f64 / scale;

        let (x, y) = if free {
            if let Ok(Some((fx, fy))) = OVERLAY_FREE_POS.lock().map(|g| *g) {
                (
                    fx.clamp(0.0, (screen_w - w).max(0.0)),
                    fy.clamp(0.0, (screen_h - h).max(0.0)),
                )
            } else {
                fixed_overlay_position(edge, screen_w, screen_h, w, h)
            }
        } else {
            fixed_overlay_position(edge, screen_w, screen_h, w, h)
        };

        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
    }
}
