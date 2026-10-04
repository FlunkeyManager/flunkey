//! active_app — foreground-window identity for per-app transcription profiles.
//!
//! Local-only: returns the foreground window's process exe basename (lowercased)
//! plus its title. No network, no storage. All failures degrade to "unknown"
//! so callers never have to handle errors.

use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct ActiveApp {
    pub exe: String,
    pub title: String,
}

fn unknown() -> ActiveApp {
    ActiveApp {
        exe: "unknown".to_string(),
        title: String::new(),
    }
}

#[cfg(target_os = "windows")]
pub fn get_foreground_app() -> ActiveApp {
    use winapi::shared::minwindef::{DWORD, MAX_PATH};
    use winapi::shared::ntdef::WCHAR;
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::processthreadsapi::OpenProcess;
    use winapi::um::winbase::QueryFullProcessImageNameW;
    use winapi::um::winnt::PROCESS_QUERY_LIMITED_INFORMATION;
    use winapi::um::winuser::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId};

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return unknown();
        }

        let mut pid: DWORD = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return unknown();
        }

        // Window title (best-effort).
        let mut title_buf: [WCHAR; 256] = [0; 256];
        let title_len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), 256);
        let title = if title_len > 0 {
            String::from_utf16_lossy(&title_buf[..title_len as usize])
        } else {
            String::new()
        };

        // Process image path → lowercase basename ("code.exe").
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return ActiveApp {
                exe: "unknown".to_string(),
                title,
            };
        }
        let exe = {
            let mut path_buf: [WCHAR; MAX_PATH] = [0; MAX_PATH];
            let mut size: DWORD = MAX_PATH as DWORD;
            let ok = QueryFullProcessImageNameW(handle, 0, path_buf.as_mut_ptr(), &mut size);
            CloseHandle(handle);
            if ok == 0 {
                "unknown".to_string()
            } else {
                let path = String::from_utf16_lossy(&path_buf[..size as usize]);
                path
                    .rsplit(['\\', '/'])
                    .next()
                    .unwrap_or("unknown")
                    .to_lowercase()
            }
        };

        ActiveApp { exe, title }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn get_foreground_app() -> ActiveApp {
    unknown()
}
