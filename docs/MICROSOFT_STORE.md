# Microsoft Store Packaging

Flunkey is a Tauri full-trust desktop application. Tauri currently creates
Windows MSI and NSIS installers, not MSIX packages. `npm run build:msix` builds
the Windows executable and packages it with the Windows SDK's `makeappx.exe`.
It creates an unsigned x64 `.msix` at
`src-tauri/target/release/bundle/msix/` for Microsoft Store submission.

## One-time setup

1. Reserve **Flunkey** in Partner Center and open **Product management → Product
   identity**.
2. Copy the exact **Package/Identity/Name** value. The builder is prefilled
  with the provided Publisher value
  `CN=051F40A6-6564-44FC-A549-C7A80A0E07E5` and publisher display name
  `Rohan Sharvesh`; confirm both still match the identity page before building.
3. Install the Windows 10/11 SDK with the MakeAppx tool.

Set the package identity in PowerShell and build:

```powershell
$env:FLUNKEY_MSIX_IDENTITY_NAME = "<Partner Center identity name>"
npm run build:msix
```

If Partner Center shows a different Publisher value, set
`FLUNKEY_MSIX_PUBLISHER` to that exact value before building. To override the
publisher display name, set `FLUNKEY_MSIX_PUBLISHER_DISPLAY_NAME`.

The package version defaults to the four-part version derived from
`src-tauri/tauri.conf.json`. For later Store updates, set
`FLUNKEY_MSIX_VERSION` to a higher four-part numeric version such as
`1.0.1.0`. This builder currently produces x64 only.

## Local testing

Run `npm run build:msix:test` to build both the unsigned Store package and a
separate self-signed `-local-test.msix` package. The signing script trusts its
public certificate in the current user's Root and TrustedPeople stores and
removes the temporary private signing certificate when finished. Windows
package deployment additionally requires the certificate in **Local Machine →
Trusted People**. Open PowerShell as Administrator and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/trust-msix-local-machine.ps1
```

Then install the local test package as your normal user:

```powershell
Add-AppxPackage .\src-tauri\target\release\bundle\msix\Flunkey_1.0.0.0_x64-local-test.msix
```

The normal `.msix` remains unsigned for Store submission. Never upload the
`-local-test.msix` file.

After testing, remove the installed app and the local trust entry with:

```powershell
Get-AppxPackage -Name RohanSharvesh.flunkey | Remove-AppxPackage
$testCert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
  ".\src-tauri\target\release\bundle\msix\Flunkey_1.0.0.0_local-test.cer"
)
foreach ($store in @("Cert:\CurrentUser\Root", "Cert:\CurrentUser\TrustedPeople")) {
  Get-ChildItem $store |
    Where-Object { $_.Thumbprint -eq $testCert.Thumbprint } |
    Remove-Item -Force
}
Get-ChildItem "Cert:\LocalMachine\TrustedPeople" |
  Where-Object { $_.Thumbprint -eq $testCert.Thumbprint } |
  Remove-Item -Force
```

## Certification notes

- **Confirm account type before submission.** Microsoft Store policy 10.8.3
  explicitly includes API secret keys in its definition of financial
  information and requires a Company developer account when an app requires
  that information for primary functionality. Flunkey's BYOK provider keys
  are central to its cloud features, so an Individual account is a material
  eligibility risk that must be resolved in Partner Center. Flunkey mitigates
  this by offering a fully keyless path: on-device transcription (whisper.cpp)
  and local models (Ollama) both work with no provider account at all, so keys
  are an optional power-up rather than a requirement. State that explicitly in
  the listing.
- The package declares `runFullTrust` because global hotkeys, native input
  simulation, the tray, and the overlay require a full-trust desktop process.
  Microsoft classifies this as a restricted capability; include a clear
  functional justification in Partner Center and expect certification review.
- The manifest declares microphone and internet access. Verify recording,
  clipboard paste, startup settings, Credential Manager, global hotkeys, tray,
  and all three windows from an installed package before submission.
- Store ingestion can accept an unsigned MSIX; Microsoft signs it after
  certification. For local sideload testing, sign with a test certificate and
  trust that certificate on the test machine. Do not upload that test-signed
  package.
- Microsoft Store policy 11.16 requires AI disclosure in the listing and
  Partner Center, plus a way for users to report inappropriate generated
  content. **Report AI response** actions in Chat History and Transforms open a
  user-controlled email draft; nothing is sent unless the user reviews and
  sends it.
- Before submission, run the Windows App Certification Kit against an installed
  package and verify the public privacy policy at `https://www.flunkey.space/privacy`
  matches `docs/PRIVACY.md`.

The Store identity cannot be finalized until the exact Partner Center Name and
Publisher values are entered. Never publish with placeholder identity values.

Forks must reserve their own app name and use their own Partner Center
identity values — do not reuse the Flunkey package identity or Publisher.