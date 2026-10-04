param(
    [Parameter(Mandatory = $true)]
    [string]$SourceIconPath
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $repoRoot "src-tauri\icons"
$sourcePngPath = Join-Path $outputDirectory "taskbar-source.png"
$roundedIcoPath = Join-Path $outputDirectory "taskbar.ico"

function New-DibIconFrame {
    param([System.Drawing.Bitmap]$Bitmap)

    $size = $Bitmap.Width
    $xorStride = $size * 4
    $andStride = [int]([Math]::Ceiling($size / 32.0) * 4)
    $xorBytes = New-Object byte[] ($xorStride * $size)
    $andBytes = New-Object byte[] ($andStride * $size)
    $offset = 0
    for ($row = 0; $row -lt $size; $row++) {
        $y = $size - 1 - $row
        for ($x = 0; $x -lt $size; $x++) {
            $pixel = $Bitmap.GetPixel($x, $y)
            $xorBytes[$offset++] = $pixel.B
            $xorBytes[$offset++] = $pixel.G
            $xorBytes[$offset++] = $pixel.R
            $xorBytes[$offset++] = $pixel.A
            if ($pixel.A -eq 0) {
                $maskOffset = ($row * $andStride) + [int][Math]::Floor($x / 8.0)
                $andBytes[$maskOffset] = [byte]($andBytes[$maskOffset] -bor (0x80 -shr ($x % 8)))
            }
        }
    }

    $dibStream = New-Object System.IO.MemoryStream
    $dibWriter = New-Object System.IO.BinaryWriter($dibStream)
    try {
        $dibWriter.Write([UInt32]40)
        $dibWriter.Write([Int32]$size)
        $dibWriter.Write([Int32]($size * 2))
        $dibWriter.Write([UInt16]1)
        $dibWriter.Write([UInt16]32)
        $dibWriter.Write([UInt32]0)
        $dibWriter.Write([UInt32]0)
        $dibWriter.Write([Int32]0)
        $dibWriter.Write([Int32]0)
        $dibWriter.Write([UInt32]0)
        $dibWriter.Write([UInt32]0)
        $dibWriter.Write($xorBytes)
        $dibWriter.Write($andBytes)
        $dibWriter.Flush()
        return ,$dibStream.ToArray()
    } finally {
        $dibWriter.Dispose()
        $dibStream.Dispose()
    }
}

if (-not (Test-Path $SourceIconPath)) {
    throw "Source icon not found: $SourceIconPath"
}

Add-Type -AssemblyName System.Drawing
$resolvedSourcePath = (Resolve-Path $SourceIconPath).Path
$sourceImage = [System.Drawing.Image]::FromFile($resolvedSourcePath)
if ($sourceImage.Width -ne $sourceImage.Height -or $sourceImage.Width -lt 128) {
    $sourceImage.Dispose()
    throw "Provide a square image with at least 128x128 resolution."
}

$sourceBitmap = New-Object System.Drawing.Bitmap($sourceImage)
$roundedBitmap = New-Object System.Drawing.Bitmap(
    $sourceBitmap.Width,
    $sourceBitmap.Height,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
)
$graphics = [System.Drawing.Graphics]::FromImage($roundedBitmap)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$icoStream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($icoStream)
try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    $size = $sourceBitmap.Width
    $cornerDiameter = [int][Math]::Round($size * 0.42)
    $path.AddArc(0, 0, $cornerDiameter, $cornerDiameter, 180, 90)
    $path.AddArc($size - $cornerDiameter, 0, $cornerDiameter, $cornerDiameter, 270, 90)
    $path.AddArc($size - $cornerDiameter, $size - $cornerDiameter, $cornerDiameter, $cornerDiameter, 0, 90)
    $path.AddArc(0, $size - $cornerDiameter, $cornerDiameter, $cornerDiameter, 90, 90)
    $path.CloseFigure()
    $graphics.SetClip($path)
    $graphics.DrawImage($sourceBitmap, 0, 0, $size, $size)

    if ([System.IO.Path]::GetFullPath($resolvedSourcePath) -ne [System.IO.Path]::GetFullPath($sourcePngPath)) {
        $sourceBitmap.Save($sourcePngPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }

    $frameSizes = @(16, 32, 48, 256)
    $frames = New-Object System.Collections.Generic.List[object]
    foreach ($frameSize in $frameSizes) {
        $frameBitmap = New-Object System.Drawing.Bitmap(
            $frameSize,
            $frameSize,
            [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
        )
        try {
            $frameGraphics = [System.Drawing.Graphics]::FromImage($frameBitmap)
            try {
                $frameGraphics.Clear([System.Drawing.Color]::Transparent)
                $frameGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
                $frameGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $frameGraphics.DrawImage($roundedBitmap, 0, 0, $frameSize, $frameSize)
            } finally {
                $frameGraphics.Dispose()
            }
            $frames.Add([pscustomobject]@{
                Size = $frameSize
                Data = (New-DibIconFrame -Bitmap $frameBitmap)
            })
        } finally {
            $frameBitmap.Dispose()
        }
    }

    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$frames.Count)
    $imageOffset = 6 + (16 * $frames.Count)
    foreach ($frame in $frames) {
        $directorySize = if ($frame.Size -eq 256) { 0 } else { [byte]$frame.Size }
        $writer.Write([Byte]$directorySize)
        $writer.Write([Byte]$directorySize)
        $writer.Write([Byte]0)
        $writer.Write([Byte]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]32)
        $writer.Write([UInt32]$frame.Data.Length)
        $writer.Write([UInt32]$imageOffset)
        $imageOffset += $frame.Data.Length
    }
    foreach ($frame in $frames) {
        $writer.Write([byte[]]$frame.Data)
    }
    $writer.Flush()
    [System.IO.File]::WriteAllBytes($roundedIcoPath, $icoStream.ToArray())
} finally {
    $writer.Dispose()
    $icoStream.Dispose()
    $path.Dispose()
    $graphics.Dispose()
    $roundedBitmap.Dispose()
    $sourceBitmap.Dispose()
    $sourceImage.Dispose()
}

Write-Host "Saved high-resolution source: $sourcePngPath"
Write-Host "Saved rounded taskbar/executable icon: $roundedIcoPath"