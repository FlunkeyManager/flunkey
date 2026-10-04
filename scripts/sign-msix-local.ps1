param(
    [string]$PackageVersion = $env:FLUNKEY_MSIX_VERSION
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$tauriConfig = Get-Content -Raw (Join-Path $repoRoot "src-tauri\tauri.conf.json") | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($PackageVersion)) {
    $PackageVersion = "$($tauriConfig.version).0"
}

$outputDirectory = Join-Path $repoRoot "src-tauri\target\release\bundle\msix"
$unsignedPackage = Join-Path $outputDirectory "Flunkey_${PackageVersion}_x64.msix"
$signedPackage = Join-Path $outputDirectory "Flunkey_${PackageVersion}_x64-local-test.msix"
$certificatePath = Join-Path $outputDirectory "Flunkey_${PackageVersion}_local-test.cer"
$inspectionPath = Join-Path $env:TEMP ("flunkey-msix-sign-" + [guid]::NewGuid().ToString("N"))
$certificate = $null

if (-not (Test-Path $unsignedPackage)) {
    throw "Unsigned package not found at $unsignedPackage. Run npm run build:msix first."
}

$sdkBinRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
$makeAppx = Get-ChildItem $sdkBinRoot -Filter makeappx.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\makeappx\.exe$' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
$signTool = Get-ChildItem $sdkBinRoot -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
if (-not $makeAppx -or -not $signTool) {
    throw "The x64 Windows SDK MakeAppx and SignTool executables are required."
}

try {
    & $makeAppx.FullName unpack /p $unsignedPackage /d $inspectionPath
    if ($LASTEXITCODE -ne 0) {
        throw "MakeAppx could not read the unsigned package (exit code $LASTEXITCODE)."
    }

    [xml]$manifest = Get-Content -Raw (Join-Path $inspectionPath "AppxManifest.xml")
    $identityNode = $manifest.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Identity']")
    $publisher = $identityNode.GetAttribute("Publisher")
    if ([string]::IsNullOrWhiteSpace($publisher)) {
        throw "Package manifest has no Publisher identity."
    }

    $oldCertificate = $null
    if (Test-Path $certificatePath) {
        $oldCertificate = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($certificatePath)
    }
    Copy-Item $unsignedPackage $signedPackage -Force

    $certUtil = Get-Command certutil.exe -ErrorAction Stop
    $certificate = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $publisher `
        -FriendlyName "Flunkey local MSIX test signing" `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -NotAfter (Get-Date).AddYears(1)

    Export-Certificate -Cert $certificate -FilePath $certificatePath -Force | Out-Null
    if ($oldCertificate) {
        foreach ($store in @("TrustedPeople", "Root")) {
            & $certUtil.Source -user -f -delstore $store $oldCertificate.Thumbprint
            if ($LASTEXITCODE -ne 0) {
                throw "certutil could not remove the old certificate from CurrentUser\$store (exit code $LASTEXITCODE)."
            }
        }
    }
    foreach ($store in @("TrustedPeople", "Root")) {
        & $certUtil.Source -user -f -addstore $store $certificatePath
        if ($LASTEXITCODE -ne 0) {
            throw "certutil could not trust the test certificate in CurrentUser\$store (exit code $LASTEXITCODE)."
        }
    }

    & $signTool.FullName sign /fd SHA256 /s My /sha1 $certificate.Thumbprint $signedPackage
    if ($LASTEXITCODE -ne 0) {
        throw "SignTool could not sign the local test package (exit code $LASTEXITCODE)."
    }

    & $signTool.FullName verify /pa /v $signedPackage
    if ($LASTEXITCODE -ne 0) {
        throw "SignTool could not verify the local test package (exit code $LASTEXITCODE)."
    }

    Write-Host "Created locally signed test package: $signedPackage"
    Write-Host "Trusted the public test certificate for the current Windows user: $certificatePath"
    Write-Host "Do not upload the -local-test.msix package to Microsoft Store."
} finally {
    if ($certificate) {
        Remove-Item "Cert:\CurrentUser\My\$($certificate.Thumbprint)" -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path $inspectionPath) {
        Remove-Item -Recurse -Force $inspectionPath
    }
}