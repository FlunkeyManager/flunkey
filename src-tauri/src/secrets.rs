//! API keys in the OS keyring (Windows Credential Manager).
//!
//! The Tauri stores (flunkey-*.json) are plaintext by design, so the four BYOK
//! keys live here instead: per-user ACL, DPAPI-backed on Windows, no master
//! password. History/transcripts stay in the stores. All failures are returned
//! as strings so the frontend can fall back gracefully.
//!
//! Persistence is CRED_PERSIST_LOCAL_MACHINE, not the CRED_PERSIST_ENTERPRISE
//! that the `keyring` crate hardcodes. Enterprise persistence makes the
//! credential follow a domain profile to the next machine, which would put
//! someone's API keys on a PC they no longer own. Local-machine persistence
//! keeps the credential on this computer only.
//!
//! (The name is confusing legacy: LOCAL_MACHINE is the value that keeps a
//! credential from being roamed by the roaming profile.)

use winapi::shared::minwindef::DWORD;
use winapi::um::wincred::{
    CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
    CRED_TYPE_GENERIC,
};

/// Credential service namespace shown in Credential Manager.
const SERVICE: &str = "Flunkey";

/// The target name Credential Manager stores and matches against.
///
/// Format is `<account>.<service>`, which is exactly what the `keyring` crate
/// wrote on Windows (it concatenates user and service because Windows keys
/// credentials solely by target name). Keeping it identical means an existing
/// install still finds its saved API keys after this change instead of looking
/// like every key was lost.
fn target(account: &str) -> String {
    format!("{account}.{SERVICE}")
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn last_error() -> String {
    let code = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
    format!("Windows Credential Manager error {code}")
}

pub fn store(account: &str, secret: &str) -> Result<(), String> {
    // The blob is UTF-16 and CredWriteW wants the byte length, excluding the
    // terminating null.
    let blob: Vec<u16> = secret.encode_utf16().collect();
    let blob_bytes = (blob.len() * std::mem::size_of::<u16>()) as DWORD;

    let mut name = wide(&target(account));
    let mut cred = CREDENTIALW {
        Flags: 0,
        Type: CRED_TYPE_GENERIC,
        TargetName: name.as_mut_ptr(),
        Comment: std::ptr::null_mut(),
        LastWritten: unsafe { std::mem::zeroed() },
        CredentialBlobSize: blob_bytes,
        CredentialBlob: blob.as_ptr() as *mut u8,
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        AttributeCount: 0,
        Attributes: std::ptr::null_mut(),
        TargetAlias: std::ptr::null_mut(),
        UserName: std::ptr::null_mut(),
    };

    unsafe {
        if CredWriteW(&mut cred, 0) == 0 {
            return Err(last_error());
        }
    }
    Ok(())
}

pub fn retrieve(account: &str) -> Result<Option<String>, String> {
    let name = wide(&target(account));
    let mut raw: *mut CREDENTIALW = std::ptr::null_mut();
    unsafe {
        if CredReadW(name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut raw) == 0 {
            // 1168 (ERROR_NOT_FOUND) is the ordinary "no key stored yet" case
            // on a fresh install, not a failure.
            let code = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
            return if code == 1168 { Ok(None) } else { Err(last_error()) };
        }
        let cred = &*raw;
        let bytes = cred.CredentialBlobSize as usize;
        let text = if bytes == 0 || cred.CredentialBlob.is_null() {
            String::new()
        } else {
            let slice =
                std::slice::from_raw_parts(cred.CredentialBlob as *const u16, bytes / 2);
            String::from_utf16_lossy(slice)
        };
        CredFree(raw as *mut winapi::ctypes::c_void);
        Ok(Some(text))
    }
}

pub fn remove(account: &str) -> Result<(), String> {
    let name = wide(&target(account));
    unsafe {
        if CredDeleteW(name.as_ptr(), CRED_TYPE_GENERIC, 0) == 0 {
            let code = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
            // Already absent is success for our purposes.
            return if code == 1168 { Ok(()) } else { Err(last_error()) };
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Round-trip against the real OS vault. Requires an unlocked user
    /// keyring (true on any interactive Windows session).
    #[test]
    fn keyring_round_trip() {
        let account = "flunkey_selftest_do_not_ship";
        remove(account).expect("cleanup");
        store(account, "test-secret-123").expect("set_password");
        assert_eq!(
            retrieve(account).expect("get_password"),
            Some("test-secret-123".to_string())
        );
        remove(account).expect("delete");
        assert_eq!(retrieve(account).expect("get after delete"), None);
    }

    /// The whole point of the switch away from the keyring crate: the
    /// credential must not be marked for roaming.
    #[test]
    fn credential_is_not_enterprise_persistent() {
        let account = "flunkey_selftest_persist_do_not_ship";
        remove(account).expect("cleanup");
        store(account, "x").expect("set_password");

        let name = wide(&target(account));
        let mut raw: *mut CREDENTIALW = std::ptr::null_mut();
        unsafe {
            assert_ne!(
                CredReadW(name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut raw),
                0,
                "credential should be readable"
            );
            let cred = &*raw;
            assert_eq!(cred.Persist, CRED_PERSIST_LOCAL_MACHINE);
            CredFree(raw as *mut winapi::ctypes::c_void);
        }
        remove(account).expect("cleanup");
    }

    /// Non-ASCII keys must round-trip: providers do not limit themselves to
    /// base64, and the blob is UTF-16 rather than UTF-8.
    #[test]
    fn keyring_round_trip_unicode() {
        let account = "flunkey_selftest_unicode_do_not_ship";
        remove(account).expect("cleanup");
        let secret = "clé-privée-🔑";
        store(account, secret).expect("set_password");
        assert_eq!(retrieve(account).expect("get"), Some(secret.to_string()));
        remove(account).expect("cleanup");
    }
}