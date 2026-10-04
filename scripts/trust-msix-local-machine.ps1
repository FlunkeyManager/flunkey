param(
    [string]$CertificatePath
)

$ErrorActionPreference = "Stop"
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from an elevated PowerShell window. It imports only the local test certificate into Local Machine\TrustedPeople."
}
$certificateDirectory = Join-Path $PSScriptRoot "..\src-tauri\target\release\bundle\msix"
if ([string]::IsNullOrWhiteSpace($CertificatePath)) {
    $CertificatePath = Get-ChildItem $certificateDirectory -Filter "Flunkey_*_local-test.cer" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $CertificatePath -or -not (Test-Path $CertificatePath)) {
    throw "Local test certificate not found in $certificateDirectory. Run npm run build:msix:test first."
}

$certificate = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2((Resolve-Path $CertificatePath))
$expectedPublisher = "CN=051F40A6-6564-44FC-A549-C7A80A0E07E5"
if ($certificate.Subject -ne $expectedPublisher) {
    throw "Certificate subject '$($certificate.Subject)' does not match the app Publisher '$expectedPublisher'."
}

$trusted = Get-ChildItem "Cert:\LocalMachine\TrustedPeople" |
    Where-Object { $_.Thumbprint -eq $certificate.Thumbprint }
if (-not $trusted) {
    Import-Certificate -FilePath (Resolve-Path $CertificatePath) -CertStoreLocation "Cert:\LocalMachine\TrustedPeople" | Out-Null
}

Get-ChildItem $certificateDirectory -Filter "Flunkey_*_local-test.cer" |
    Where-Object { $_.FullName -ne (Resolve-Path $CertificatePath).Path } |
    ForEach-Object {
        $staleCertificate = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($_.FullName)
        Get-ChildItem "Cert:\LocalMachine\TrustedPeople" |
            Where-Object { $_.Thumbprint -eq $staleCertificate.Thumbprint } |
            Remove-Item -Force
    }

Write-Host "Local test certificate is trusted in Local Machine\TrustedPeople. You can now install the -local-test.msix package as your normal user."