$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$source = [Drawing.Image]::FromFile((Join-Path $root 'apps\shared\icon.png'))
$targets = @{'public\icons\app-192.png'=192;'public\icons\app-512.png'=512;'public\icons\apple-touch-icon.png'=180;'apps\android\res\drawable-nodpi\app_icon.png'=192}
try {
    foreach ($relative in $targets.Keys) {
        $destination = Join-Path $root $relative
        New-Item -ItemType Directory -Force (Split-Path $destination -Parent) | Out-Null
        $size = $targets[$relative]
        $bitmap = New-Object Drawing.Bitmap $size,$size
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([Drawing.Color]::FromArgb(247,240,229))
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.DrawImage($source, [Drawing.Rectangle]::new([int]($size * .18),[int]($size * .18),[int]($size * .64),[int]($size * .64)))
            $bitmap.Save($destination, [Drawing.Imaging.ImageFormat]::Png)
        } finally { $graphics.Dispose(); $bitmap.Dispose() }
    }
    $iconBitmap = New-Object Drawing.Bitmap $source,256,256
    try {
        $pngStream = New-Object IO.MemoryStream
        try {
            $iconBitmap.Save($pngStream,[Drawing.Imaging.ImageFormat]::Png)
            $png = $pngStream.ToArray()
            $destinationStream = [IO.File]::Create((Join-Path $root 'build\app.ico'))
            $writer = New-Object IO.BinaryWriter $destinationStream
            try {
                $writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]1)
                $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
                $writer.Write([UInt16]1); $writer.Write([UInt16]32); $writer.Write([UInt32]$png.Length); $writer.Write([UInt32]22); $writer.Write($png)
            } finally { $writer.Dispose(); $destinationStream.Dispose() }
        } finally { $pngStream.Dispose() }
    } finally { $iconBitmap.Dispose() }
} finally { $source.Dispose() }
