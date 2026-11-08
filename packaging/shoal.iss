; Inno Setup script of the Windows installer. Built by packaging/build_app.py, which passes
; Version, SourceDir (the PyInstaller folder), OutputDir, OutputName and IconFile.
;
; Per-user install (no administrator rights), so the app can update itself silently: the updater runs
;   Shoal-<v>-windows-x64-setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /DIR="<current folder>"
; after Shoal has exited, then starts Shoal again. Projects live in %LOCALAPPDATA%\Shoal and are kept.

#ifndef Version
  #define Version "0.0.0"
#endif

[Setup]
AppId={{6F2D3C1A-8E4B-4B7C-9A51-2C0E7D9B4F36}
AppName=Shoal
AppVersion={#Version}
AppVerName=Shoal {#Version}
AppPublisher=Shoal
AppPublisherURL=https://github.com/lycself/Shoal
AppSupportURL=https://github.com/lycself/Shoal/issues
AppUpdatesURL=https://github.com/lycself/Shoal/releases
DefaultDirName={localappdata}\Programs\Shoal
DisableDirPage=auto
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename={#OutputName}
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\Shoal.exe
UninstallDisplayName=Shoal
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
; the running app holds this mutex: an interactive install asks to quit Shoal first
AppMutex=ShoalDesktopAppMutex
CloseApplications=no
ShowLanguageDialog=no

[Languages]
Name: "chinesesimplified"; MessagesFile: "languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; drop the previous version's libraries so nothing stale is left behind
Type: filesandordirs; Name: "{app}\_internal"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Shoal"; Filename: "{app}\Shoal.exe"
Name: "{autodesktop}\Shoal"; Filename: "{app}\Shoal.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Shoal.exe"; Description: "{cm:LaunchProgram,Shoal}"; Flags: nowait postinstall skipifsilent
