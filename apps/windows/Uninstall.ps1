$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$installDirectory = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\Retone'))
if ([IO.Path]::GetFullPath($PSScriptRoot) -ne $installDirectory) { throw 'Unexpected installation directory.' }
$marker = Join-Path $installDirectory '.retone-install'
if (!(Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw) -ne 'retone-v2:1') { throw 'Installation marker is missing.' }
if ([Windows.Forms.MessageBox]::Show('Re:tone 앱을 제거할까요? 서버의 계정과 대화는 유지됩니다.', 'Re:tone', 'YesNo') -ne 'Yes') { exit }
foreach ($folder in @([Environment]::GetFolderPath('DesktopDirectory'), [Environment]::GetFolderPath('Programs'))) {
    $shortcut = Join-Path $folder 'Retone.lnk'
    if (Test-Path -LiteralPath $shortcut) { Remove-Item -LiteralPath $shortcut -Force }
}
$registryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Retone'
if (Test-Path -LiteralPath $registryPath) { Remove-Item -LiteralPath $registryPath }
Remove-Item -LiteralPath $installDirectory -Recurse -Force
[Windows.Forms.MessageBox]::Show('Re:tone 앱을 제거했습니다.', 'Re:tone') | Out-Null
