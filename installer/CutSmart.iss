#ifndef MyAppName
  #define MyAppName "CutSmart"
#endif
#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif
#ifndef MyAppPublisher
  #define MyAppPublisher "CutSmart"
#endif
#ifndef MyAppExeName
  #define MyAppExeName "CutSmart.exe"
#endif

; Build output folder from PyInstaller/cx_Freeze/etc.
#ifndef BuildOutputDir
  #define BuildOutputDir "..\dist\CutSmart"
#endif
; Desktop/installer icon must be .ico for Inno Setup.
#ifndef AppIconFile
  #ifexist "..\src\cutsmart\local_data\app_icon\app.ico"
    #define AppIconFile "..\src\cutsmart\local_data\app_icon\app.ico"
  #elifexist "..\src\cutsmart\local_data\app_icon\icon.ico"
    #define AppIconFile "..\src\cutsmart\local_data\app_icon\icon.ico"
  #else
    #error "No installer icon found (.ico). Add app.ico or icon.ico under src\cutsmart\local_data\app_icon\"
  #endif
#endif

[Setup]
AppId={{A9A47C4B-86AF-4B24-93DB-C4F0FDE7A771}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
OutputDir=.\Output
OutputBaseFilename=CutSmart-Setup-{#MyAppVersion}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
SetupIconFile={#AppIconFile}
UninstallDisplayIcon={app}\{#MyAppExeName}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#BuildOutputDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{#AppIconFile}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon; IconFilename: "{#AppIconFile}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
