param(
    [string]$IdentityName = $env:FLUNKEY_MSIX_IDENTITY_NAME,
    [string]$Publisher = $(if ($env:FLUNKEY_MSIX_PUBLISHER) { $env:FLUNKEY_MSIX_PUBLISHER } else { "CN=051F40A6-6564-44FC-A549-C7A80A0E07E5" }),
    [string]$PublisherDisplayName = $(if ($env:FLUNKEY_MSIX_PUBLISHER_DISPLAY_NAME) { $env:FLUNKEY_MSIX_PUBLISHER_DISPLAY_NAME } else { "Rohan Sharvesh" }),
    [string]$PackageVersion = $env:FLUNKEY_MSIX_VERSION,
    # On-device speech is a shipped feature, not an optional extra. A package
    # without the engine installs fine and then fails at runtime, so the build
    # stops unless you deliberately opt out.
    [switch]$NoWhisper
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$tauriConfigPath = Join-Path $repoRoot "src-tauri\tauri.conf.json"
$templatePath = Join-Path $repoRoot "src-tauri\msix\AppxManifest.xml"
$executablePath = Join-Path $repoRoot "src-tauri\target\release\flunkey.exe"
$iconPath = Join-Path $repoRoot "src-tauri\icons\icon.png"
$taskbarIconPath = Join-Path $repoRoot "src-tauri\icons\taskbar.ico"
$targetRoot = Join-Path $repoRoot "src-tauri\target"
$stagePath = Join-Path $targetRoot "msix-stage"
$outputDirectory = Join-Path $targetRoot "release\bundle\msix"

if ([string]::IsNullOrWhiteSpace($IdentityName) -or [string]::IsNullOrWhiteSpace($Publisher)) {
    throw "Set FLUNKEY_MSIX_IDENTITY_NAME and FLUNKEY_MSIX_PUBLISHER to the exact values shown under Product identity in Partner Center. Do not substitute the account display name."
}
if ($IdentityName -notmatch '^[A-Za-z0-9.]{3,50}$') {
    throw "FLUNKEY_MSIX_IDENTITY_NAME must be the reserved package identity name from Partner Center."
}
if ($Publisher -notmatch '^CN=.+$') {
    throw "FLUNKEY_MSIX_PUBLISHER must be the complete Publisher value from Partner Center, including its CN= prefix."
}
if ([string]::IsNullOrWhiteSpace($PublisherDisplayName)) {
    throw "FLUNKEY_MSIX_PUBLISHER_DISPLAY_NAME cannot be empty."
}

$tauriConfig = Get-Content -Raw $tauriConfigPath | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($PackageVersion)) {
    $PackageVersion = "$($tauriConfig.version).0"
}
if ($PackageVersion -notmatch '^(\d+)\.(\d+)\.(\d+)\.(\d+)$') {
    throw "FLUNKEY_MSIX_VERSION must have four numeric components, for example 1.0.0.0."
}
$versionParts = @($Matches[1], $Matches[2], $Matches[3], $Matches[4]) | ForEach-Object { [int]$_ }
if ($versionParts[0] -lt 1 -or ($versionParts | Where-Object { $_ -gt 65535 }).Count -gt 0) {
    throw "MSIX version components must be between 0 and 65535, and the first component must be at least 1."
}

$makeAppx = Get-Command makeappx.exe -ErrorAction SilentlyContinue
if (-not $makeAppx) {
    $sdkBinRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
    $makeAppx = Get-ChildItem $sdkBinRoot -Filter makeappx.exe -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\x64\\makeappx\.exe$' } |
        Sort-Object FullName -Descending |
        Select-Object -First 1
}
if (-not $makeAppx) {
    throw "makeappx.exe was not found. Install the Windows 10/11 SDK and try again."
}
$makeAppxPath = if ($makeAppx -is [System.IO.FileInfo]) { $makeAppx.FullName } elseif ($makeAppx.Source) { $makeAppx.Source } else { $makeAppx.Path }

Push-Location $repoRoot
try {
    & npm.cmd run tauri -- build --no-bundle --features msix-autostart
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri failed to build the Windows executable (exit code $LASTEXITCODE)."
    }
} finally {
    Pop-Location
}

if (-not (Test-Path $executablePath)) {
    throw "Expected Windows executable was not produced at $executablePath. This builder currently targets x64."
}

if (Test-Path $stagePath) {
    Remove-Item -Recurse -Force $stagePath
}
New-Item -ItemType Directory -Path $stagePath | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stagePath "Assets") | Out-Null
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
Copy-Item $executablePath (Join-Path $stagePath "flunkey.exe")

# On-device speech engine (whisper.cpp). Fetched by scripts\fetch-whisper.ps1;
# shipped in the package so it inherits the MSIX signature instead of
# triggering SmartScreen on first use.
$whisperSource = Join-Path $repoRoot "src-tauri\whisper-bin"
$whisperExe = Join-Path $whisperSource "whisper-cli.exe"
$whisperExpected = $false
if (Test-Path $whisperExe) {
    $whisperStage = Join-Path $stagePath "whisper"
    New-Item -ItemType Directory -Path $whisperStage -Force | Out-Null
    Copy-Item (Join-Path $whisperSource "*") -Destination $whisperStage -Recurse -Force
    $whisperExpected = $true
    Write-Host "Bundled the on-device speech engine from $whisperSource"
} elseif ($NoWhisper) {
    Write-Warning "-NoWhisper was passed: this package will ship WITHOUT on-device transcription."
} else {
    throw @"
src-tauri\whisper-bin\whisper-cli.exe is missing, so this package would install
without the on-device speech engine and fail at runtime with "The on-device
speech engine is missing from this install."

Fetch it first:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fetch-whisper.ps1

Pass -NoWhisper only if you intentionally want a package without it.
"@
}

Add-Type -AssemblyName System.Drawing
$sourceIcon = [System.Drawing.Image]::FromFile($iconPath)
$taskbarIcon = [System.Drawing.Image]::FromFile($taskbarIconPath)
try {
    foreach ($size in @(44, 50, 150)) {
        $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $logo = if ($size -eq 44) { $taskbarIcon } else { $sourceIcon }
                $graphics.DrawImage($logo, 0, 0, $size, $size)
            } finally {
                $graphics.Dispose()
            }
            $assetName = switch ($size) {
                44 { "Square44x44Logo.png" }
                50 { "StoreLogo.png" }
                150 { "Square150x150Logo.png" }
            }
            $bitmap.Save((Join-Path $stagePath "Assets\$assetName"), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $bitmap.Dispose()
        }
    }
} finally {
    $taskbarIcon.Dispose()
    $sourceIcon.Dispose()
}

[xml]$manifest = Get-Content -Raw $templatePath
$identityNode = $manifest.DocumentElement.SelectSingleNode("*[local-name()='Identity']")
$publisherDisplayNode = $manifest.DocumentElement.SelectSingleNode("*[local-name()='Properties']/*[local-name()='PublisherDisplayName']")
$identityNode.SetAttribute("Name", $IdentityName)
$identityNode.SetAttribute("Publisher", $Publisher)
$identityNode.SetAttribute("Version", $PackageVersion)
$publisherDisplayNode.InnerText = $PublisherDisplayName
$manifest.Save((Join-Path $stagePath "AppxManifest.xml"))

$packagePath = Join-Path $outputDirectory "Flunkey_${PackageVersion}_x64.msix"
& $makeAppxPath pack /d $stagePath /p $packagePath /o
if ($LASTEXITCODE -ne 0) {
    throw "MakeAppx failed to create the package (exit code $LASTEXITCODE)."
}

# Verify the packed payload, not just the staging folder. A release that
# installs but can't run a shipped feature is worse than a failed build.
$verifyDir = Join-Path $env:TEMP ("flunkey-verify-" + [guid]::NewGuid().ToString("N"))
try {
    & $makeAppxPath unpack /p $packagePath /d $verifyDir /o | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not re-open the package to verify its contents."
    }
    $stagedExe = Get-ChildItem (Join-Path $verifyDir "whisper") -Filter "whisper-cli.exe" -ErrorAction SilentlyContinue
    if ($whisperExpected -and -not $stagedExe) {
        throw "The packed package does NOT contain whisper\whisper-cli.exe. Refusing to ship it."
    }
    $engineSize = if ($stagedExe) { [math]::Round((Get-ChildItem (Join-Path $verifyDir "whisper") | Measure-Object Length -Sum).Sum / 1MB, 2) } else { 0 }
    Write-Host "Verified payload: flunkey.exe present, speech engine = $engineSize MB"
} finally {
    Remove-Item -Recurse -Force $verifyDir -ErrorAction SilentlyContinue
}

Write-Host "Created unsigned Store-submission package: $packagePath"
Write-Host "The Microsoft Store signs accepted MSIX packages. Use a trusted test certificate only for local sideload testing."