use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyBinding {
    pub vk: i32,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub win: bool,
    #[serde(default)]
    pub scan_code: Option<i32>,
}

impl Default for HotkeyBinding {
    fn default() -> Self {
        Self {
            vk: 0,
            ctrl: false,
            alt: false,
            shift: false,
            win: false,
            scan_code: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppHotkeys {
    pub transcribe: HotkeyBinding,
    pub ask_ai: HotkeyBinding,
    pub transform: HotkeyBinding,
    #[serde(default = "default_panel_hotkey")]
    pub panel: HotkeyBinding,
}

fn default_panel_hotkey() -> HotkeyBinding {
    HotkeyBinding {
        vk: 0x78,
        ctrl: true,
        alt: false,
        shift: false,
        win: false,
        scan_code: None,
    }
}

impl Default for AppHotkeys {
    fn default() -> Self {
        Self {
            transcribe: HotkeyBinding {
                vk: 0x77,
                ctrl: false,
                alt: false,
                shift: false,
                win: false,
                scan_code: None,
            },
            ask_ai: HotkeyBinding {
                vk: 0x78,
                ctrl: false,
                alt: false,
                shift: false,
                win: false,
                scan_code: None,
            },
            transform: HotkeyBinding {
                vk: 0x79,
                ctrl: false,
                alt: false,
                shift: false,
                win: false,
                scan_code: None,
            },
            panel: default_panel_hotkey(),
        }
    }
}

static HOTKEYS: Mutex<AppHotkeys> = Mutex::new(AppHotkeys {
    transcribe: HotkeyBinding {
        vk: 0x77,
        ctrl: false,
        alt: false,
        shift: false,
        win: false,
        scan_code: None,
    },
    ask_ai: HotkeyBinding {
        vk: 0x78,
        ctrl: false,
        alt: false,
        shift: false,
        win: false,
        scan_code: None,
    },
    transform: HotkeyBinding {
        vk: 0x79,
        ctrl: false,
        alt: false,
        shift: false,
        win: false,
        scan_code: None,
    },
    panel: HotkeyBinding {
        vk: 0x78,
        ctrl: true,
        alt: false,
        shift: false,
        win: false,
        scan_code: None,
    },
});

static F8_HELD: AtomicBool = AtomicBool::new(false);
static F9_HELD: AtomicBool = AtomicBool::new(false);
static F10_HELD: AtomicBool = AtomicBool::new(false);
static PANEL_HELD: AtomicBool = AtomicBool::new(false);

pub fn set_hotkeys(hotkeys: AppHotkeys) {
    if let Ok(mut guard) = HOTKEYS.lock() {
        *guard = hotkeys;
    }
    F8_HELD.store(false, Ordering::SeqCst);
    F9_HELD.store(false, Ordering::SeqCst);
    F10_HELD.store(false, Ordering::SeqCst);
    PANEL_HELD.store(false, Ordering::SeqCst);
}

#[cfg(target_os = "windows")]
fn modifiers_pressed() -> (bool, bool, bool, bool) {
    use winapi::um::winuser::{GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT};

    unsafe {
        let pressed = |vk: i32| (GetAsyncKeyState(vk) as u16) & 0x8000 != 0;
        let ctrl = pressed(VK_CONTROL);
        let alt = pressed(VK_MENU);
        let shift = pressed(VK_SHIFT);
        let win = pressed(VK_LWIN) || pressed(VK_RWIN);
        (ctrl, alt, shift, win)
    }
}

#[cfg(not(target_os = "windows"))]
fn modifiers_pressed() -> (bool, bool, bool, bool) {
    (false, false, false, false)
}

fn vk_matches(binding: &HotkeyBinding, vk: i32, scan_code: i32) -> bool {
    if vk == binding.vk {
        return true;
    }
    binding.scan_code.is_some_and(|sc| sc == scan_code)
}

fn binding_matches(binding: &HotkeyBinding, vk: i32, scan_code: i32) -> bool {
    if !vk_matches(binding, vk, scan_code) {
        return false;
    }
    let (ctrl, alt, shift, win) = modifiers_pressed();
    ctrl == binding.ctrl && alt == binding.alt && shift == binding.shift && win == binding.win
}

fn process_binding(
    binding: &HotkeyBinding,
    held: &AtomicBool,
    vk: i32,
    scan_code: i32,
    is_down: bool,
    is_up: bool,
    start_event: &str,
    stop_event: &str,
    emit: &dyn Fn(&str),
) {
    if !binding_matches(binding, vk, scan_code) {
        return;
    }

    if is_down && !held.load(Ordering::SeqCst) {
        held.store(true, Ordering::SeqCst);
        emit(start_event);
    } else if is_up && held.load(Ordering::SeqCst) {
        held.store(false, Ordering::SeqCst);
        emit(stop_event);
    }
}

/// True when this key event is the Transform hotkey being pressed/released
/// AND swallowing it is safe.
///
/// Background: on Windows, F10 activates the foreground app's menu bar
/// (Notepad included). If F10 reaches the app, the menu steals focus from
/// the text control and the Ctrl+C sent on transform-start lands nowhere,
/// so short selections fail with "Copy failed". Swallowing fixes it.
///
/// Safety: only function keys (F1–F24) are ever swallowed, so a user
/// remapping the binding to a normal typing key can never lose keystrokes.
pub fn transform_key_consumes(vk: i32, scan_code: i32) -> bool {
    if !(0x70..=0x87).contains(&vk) {
        return false;
    }
    let hotkeys = HOTKEYS.lock().map(|g| g.clone()).unwrap_or_default();
    binding_matches(&hotkeys.transform, vk, scan_code)
}

pub fn handle_keyboard_event(
    vk: i32,
    scan_code: i32,
    is_down: bool,
    is_up: bool,
    emit: &dyn Fn(&str),
) {
    let hotkeys = HOTKEYS.lock().map(|g| g.clone()).unwrap_or_default();

    process_binding(
        &hotkeys.transcribe,
        &F8_HELD,
        vk,
        scan_code,
        is_down,
        is_up,
        "f8-start",
        "f8-stop",
        emit,
    );
    process_binding(
        &hotkeys.ask_ai,
        &F9_HELD,
        vk,
        scan_code,
        is_down,
        is_up,
        "f9-start",
        "f9-stop",
        emit,
    );

    process_binding(
        &hotkeys.transform,
        &F10_HELD,
        vk,
        scan_code,
        is_down,
        is_up,
        "transform-start",
        "transform-stop",
        emit,
    );

    // Panel binding is edge-triggered on press only — a momentary Ctrl+F9
    // opens the side panel; there is no stop action to handle.
    if binding_matches(&hotkeys.panel, vk, scan_code) {
        if is_down && !PANEL_HELD.load(Ordering::SeqCst) {
            PANEL_HELD.store(true, Ordering::SeqCst);
            emit("panel-start");
        } else if is_up && PANEL_HELD.load(Ordering::SeqCst) {
            PANEL_HELD.store(false, Ordering::SeqCst);
        }
    }
}
