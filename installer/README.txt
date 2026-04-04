CutSmart Inno Setup
===================

Files
-----
- Script: installer\CutSmart.iss
- App build helper: installer\build_app.ps1
- Build helper: installer\build_installer.ps1
- Required icon for installer/desktop shortcut: src\cutsmart\local_data\app_icon\app.ico

Notes
-----
- Runtime app icon (inside the app window) already supports PNG from:
  src\cutsmart\local_data\app_icon\icon.png
- Desktop/start menu shortcut icon in Inno Setup should be .ico.
- If app.ico is missing, the installer script will also accept:
  src\cutsmart\local_data\app_icon\icon.ico

Before compiling
----------------
1. Build your app:
   powershell -ExecutionPolicy Bypass -File installer\build_app.ps1
   (This uses PyInstaller with `--paths src` so `cutsmart` is bundled correctly.)
2. Place your icon as:
   src\cutsmart\local_data\app_icon\app.ico
3. Run:
   powershell -ExecutionPolicy Bypass -File installer\build_installer.ps1 -Version 1.0.0

If your EXE filename or build folder is different
-------------------------------------------------
Either edit installer\CutSmart.iss or pass parameters:
- -ExeName
- -BuildOutputDir
- -AppName
- -Publisher
- -InnoCompilerPath

Examples
--------
- Default compiler path lookup:
  powershell -ExecutionPolicy Bypass -File installer\build_installer.ps1 -Version 1.2.3

- Custom Inno compiler location:
  powershell -ExecutionPolicy Bypass -File installer\build_installer.ps1 -Version 1.2.3 -InnoCompilerPath "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
