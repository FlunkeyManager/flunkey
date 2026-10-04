<#
.SYNOPSIS
    Downloads the whisper.cpp Windows x64 release into src-tauri\whisper-bin\.

.DESCRIPTION
    Flunkey ships the on-device speech engine inside the installer so the
    binary inherits the package signature (no SmartScreen prompt, no
    download at first use). Only the *model* file is fetched later, by the
    user, from inside the app.

    The upstream release is a zip of the CLI plus the ggml runtime DLLs, which
    together are a few MB. Pin WHISPER_VERSION to a specific tag for
    reproducible builds, e.g.:

        $env:WHISPER_VERSION = "v1.7.4"
        powershell -File scripts\fetch-whisper.ps1
#>
param(
    [string]$Version = $env:WHISPER_VERSION,
    [string]$Asset = "whisper-bin-x64.zip",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$targetDir = Join-Path $repoRoot "src-tauri\whisper-bin"
$exeName = "whisper-cli.exe"

# Not every release publishes Windows binaries (some are source-only), so walk
# the release list newest-first and take the first one that actually has the
# asset. Falls back to a known-good tag when the API is unreachable.
function Resolve-AssetUrl {
    param([string]$Wanted)
    try {
        $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=20" -Headers @{ "User-Agent" = "Flunkey-build" }
        foreach ($rel in $releases) {
            $asset = $rel.assets | Where-Object { $_.name -eq $Wanted } | Select-Object -First 1
            if ($asset) {
                return [pscustomobject]@{ Tag = $rel.tag_name; Url = $asset.browser_download_url }
            }
        }
    } catch {
        Write-Host "Could not query the GitHub API: $($_.Exception.Message)"
    }
    return $null
}

$resolved = $null
if ($Version) {
    $resolved = [pscustomobject]@{
        Tag = $Version
        Url = "https://github.com/ggml-org/whisper.cpp/releases/download/$Version/$Asset"
    }
} else {
    $resolved = Resolve-AssetUrl -Wanted $Asset
    if (-not $resolved) {
        $resolved = [pscustomobject]@{
            Tag = "v1.9.2"
            Url = "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/$Asset"
        }
    }
}
$Version = $resolved.Tag

if ((Test-Path $targetDir) -and $Force) {
    Remove-Item -Recurse -Force $targetDir
}
if (Test-Path (Join-Path $targetDir $exeName)) {
    Write-Host "whisper.cpp already present at $targetDir (use -Force to re-download)."
    exit 0
}

New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
$zipPath = Join-Path $env:TEMP "whisper-$Version-x64.zip"

Write-Host "Downloading whisper.cpp $Version ($Asset)..."
$downloaded = $false
foreach ($url in @($resolved.Url, "https://github.com/ggerganov/whisper.cpp/releases/download/$Version/$Asset")) {
    try {
        Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
        $downloaded = $true
        break
    } catch {
        Write-Host "  not at $url"
    }
}
if (-not $downloaded) {
    throw "Could not download whisper-bin-x64.zip for $Version. Download it manually from https://github.com/ggml-org/whisper.cpp/releases and extract it to $targetDir"
}

$extractDir = Join-Path $env:TEMP ("whisper-extract-" + [guid]::NewGuid().ToString("N"))
try {
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
    # Releases contain a Release\ subfolder; take every DLL alongside the exe
    # so the engine has no external runtime dependency.
    $exe = Get-ChildItem $extractDir -Recurse -Filter $exeName | Select-Object -First 1
    if (-not $exe) {
        throw "$exeName was not found inside the release archive."
    }
    $binDir = $exe.Directory
    Copy-Item (Join-Path $binDir.FullName "*") -Destination $targetDir -Recurse -Force

    # The archive also ships benches, test harnesses and server tools we never
    # run. Keep the CLI plus the runtime it actually loads: whisper.dll, the
    # ggml libraries (every CPU variant, so any machine finds a match) and
    # llama.dll which whisper.dll links against.
    $keepDlls = @("whisper.dll", "ggml.dll", "ggml-base.dll", "llama.dll")
    Get-ChildItem $targetDir -File | Where-Object {
        $_.Extension -eq ".exe" -and $_.Name -ne $exeName
    } | Remove-Item -Force
    Get-ChildItem $targetDir -Filter "*.dll" | Where-Object {
        $keepDlls -notcontains $_.Name -and $_.Name -notlike "ggml-cpu-*.dll"
    } | Remove-Item -Force

    Write-Host "Installed whisper.cpp $Version to $targetDir"
    Get-ChildItem $targetDir | Select-Object Name, @{ n = "MB"; e = { [math]::Round($_.Length / 1MB, 2) } } |
        Format-Table -AutoSize | Out-String | Write-Host
} finally {
    Remove-Item -Recurse -Force $extractDir -ErrorAction SilentlyContinue
    Remove-Item -Force $zipPath -ErrorAction SilentlyContinue
}
