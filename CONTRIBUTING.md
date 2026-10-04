# Contributing to Flunkey

Thanks for helping with Flunkey — https://github.com/FlunkeyManager/flunkey.

## Prerequisites

- Windows 10/11 64-bit
- Node 22 LTS (see `.nvmrc`), Rust stable with MSVC + VS Build Tools C++ workload
- WebView2 (preinstalled on Windows 10/11)
- Windows SDK `makeappx.exe` + `signtool.exe` only for MSIX builds

## Setup

```powershell
npm install
powershell -File scripts\fetch-whisper.ps1   # on-device speech engine, once (~12 MB into src-tauri/whisper-bin/)
npm run tauri dev
```

No `.env` needed. API keys are entered in-app and stored in Windows Credential Manager.

## Checks before a PR

```powershell
npm test
npx tsc --noEmit
npm run build
```

Rust check:

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
```

NSIS installer:

```powershell
npm run tauri build
```

MSIX (Store submission, unsigned):

```powershell
$env:FLUNKEY_MSIX_IDENTITY_NAME = "<Partner Center identity name>"
npm run build:msix
```

Forks must use their own Partner Center identity. Never commit `FLUNKEY_MSIX_*` values, certificates (`.pfx`, `.cer`, `.key`, `.pem`), or `*-local-test.msix` files — they are git-ignored.

## PR guidance

- Keep changes focused; do not bump versions in `package.json`, `src-tauri/tauri.conf.json`, or `src-tauri/Cargo.toml`.
- Update `README.md` / `docs/` if behavior, privacy, or setup changes.
- Never include secrets, keyring dumps, AppData JSON, screenshots with personal data, or binaries from `src-tauri/target/`, `dist/`, or `src-tauri/whisper-bin/`.
- For AI-output reporting changes, keep the user-reviewed email-draft flow (nothing auto-sent).
