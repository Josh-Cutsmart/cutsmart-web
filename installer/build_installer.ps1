param(
    [string]$Version = "1.0.0",
    [string]$InnoCompilerPath = "",
    [string]$AppName = "CutSmart",
    [string]$Publisher = "CutSmart",
    [string]$ExeName = "CutSmart.exe",
    [string]$BuildOutputDir = "..\dist\CutSmart"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
$issPath = Join-Path $scriptDir "CutSmart.iss"
$resolvedBuildOutputDir = Join-Path $scriptDir $BuildOutputDir
$exePath = Join-Path $resolvedBuildOutputDir $ExeName

if (-not (Test-Path $issPath)) {
    throw "Inno script not found: $issPath"
}
if (-not (Test-Path $resolvedBuildOutputDir)) {
    throw "Build output folder not found: $resolvedBuildOutputDir`nBuild app first so your dist folder exists."
}
if (-not (Test-Path $exePath)) {
    throw "App EXE not found: $exePath`nCheck ExeName/build output settings."
}

$iconA = Join-Path $repoRoot "src\cutsmart\local_data\app_icon\app.ico"
$iconB = Join-Path $repoRoot "src\cutsmart\local_data\app_icon\icon.ico"
if (-not ((Test-Path $iconA) -or (Test-Path $iconB))) {
    throw "No .ico icon found. Add app.ico or icon.ico under src\cutsmart\local_data\app_icon\"
}
$resolvedIconFile = if (Test-Path $iconA) { $iconA } else { $iconB }

if ([string]::IsNullOrWhiteSpace($InnoCompilerPath)) {
    $commonCandidates = @(
        "$env:ProgramFiles(x86)\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
    )
    foreach ($candidate in $commonCandidates) {
        if (Test-Path $candidate) {
            $InnoCompilerPath = $candidate
            break
        }
    }
}

if ([string]::IsNullOrWhiteSpace($InnoCompilerPath) -or -not (Test-Path $InnoCompilerPath)) {
    throw "Could not find ISCC.exe. Install Inno Setup 6 or pass -InnoCompilerPath."
}

Write-Host "Compiling installer with version $Version ..."

$args = @(
    "/DMyAppVersion=$Version",
    "/DMyAppName=$AppName",
    "/DMyAppPublisher=$Publisher",
    "/DMyAppExeName=$ExeName",
    "/DBuildOutputDir=$BuildOutputDir",
    "/DAppIconFile=$resolvedIconFile",
    $issPath
)

& $InnoCompilerPath @args

if ($LASTEXITCODE -ne 0) {
    throw "Inno compiler failed with exit code $LASTEXITCODE"
}

Write-Host ""
Write-Host "Installer built successfully."
Write-Host "Output folder: $(Join-Path $scriptDir 'Output')"
