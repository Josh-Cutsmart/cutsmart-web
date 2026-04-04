param(
    [string]$AppName = "CutSmart",
    [string]$EntryPoint = "main_pyside.py",
    [string]$SourcePath = "src"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "..")
Set-Location $repoRoot

$pythonExe = Join-Path $repoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $pythonExe)) {
    throw "Python venv not found at .venv\Scripts\python.exe"
}

$entry = Join-Path $repoRoot $EntryPoint
if (-not (Test-Path $entry)) {
    throw "Entry point not found: $EntryPoint"
}

$iconA = Join-Path $repoRoot "src\cutsmart\local_data\app_icon\app.ico"
$iconB = Join-Path $repoRoot "src\cutsmart\local_data\app_icon\icon.ico"
$iconArg = ""
if (Test-Path $iconA) {
    $iconArg = $iconA
} elseif (Test-Path $iconB) {
    $iconArg = $iconB
}

Write-Host "Building app with PyInstaller..."
& $pythonExe -m pip install pyinstaller | Out-Host

$args = @(
    "-m", "PyInstaller",
    "--noconfirm",
    "--clean",
    "--name", $AppName,
    "--windowed",
    "--paths", $SourcePath
)
if ($iconArg) {
    $args += @("--icon", $iconArg)
}
$secretDir = Join-Path $repoRoot "secret"
if (Test-Path $secretDir) {
    # Include Firebase config/service account in onedir output under "secret".
    $args += @("--add-data", "$secretDir;secret")
}
$uiAssetsDir = Join-Path $repoRoot "src\cutsmart\qtui\assets"
if (Test-Path $uiAssetsDir) {
    # Include assets in both locations:
    # - cutsmart\qtui\assets (used by most in-app icon path lookups)
    # - src\cutsmart\qtui\assets (used by startup splash fallback)
    $args += @("--add-data", "$uiAssetsDir;cutsmart\qtui\assets")
    $args += @("--add-data", "$uiAssetsDir;src\cutsmart\qtui\assets")
}
$args += $EntryPoint

& $pythonExe @args
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller failed with exit code $LASTEXITCODE"
}

Write-Host ""
Write-Host "App build complete."
Write-Host "Output folder: $(Join-Path $repoRoot "dist\$AppName")"
