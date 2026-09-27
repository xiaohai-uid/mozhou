#ifndef Bundle
  #error Bundle is required
#endif
#ifndef AppVersion
  #error AppVersion is required
#endif
[Setup]
AppId=MoZhou.Local.Windows
AppName=墨舟
AppVersion={#AppVersion}
AppPublisher=MoZhou
DefaultDirName={localappdata}\Programs\MoZhou
DefaultGroupName=墨舟
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#Output}
OutputBaseFilename=MoZhou-{#AppVersion}-windows-x64-setup
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\MoZhou.exe
CloseApplications=yes
RestartApplications=no
SetupLogging=yes

[Files]
Source: "{#Bundle}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\墨舟"; Filename: "{app}\MoZhou.exe"; WorkingDir: "{app}"
Name: "{group}\卸载墨舟"; Filename: "{uninstallexe}"
Name: "{userdesktop}\墨舟"; Filename: "{app}\MoZhou.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"

[Run]
Filename: "{app}\MoZhou.exe"; Description: "启动墨舟"; Flags: nowait postinstall skipifsilent

[Code]
function StopMoZhou(): Boolean;
var ExitCode: Integer;
begin
  Result := True;
  if FileExists(ExpandConstant('{app}\MoZhou.exe')) then
    Result := Exec(ExpandConstant('{app}\MoZhou.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) and (ExitCode = 0);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not StopMoZhou() then Result := '请先退出墨舟，再重试安装。';
end;

function InitializeUninstall(): Boolean;
begin
  Result := StopMoZhou();
  if not Result then MsgBox('请先退出墨舟，再重试卸载。', mbError, MB_OK);
end;

// No user-data deletion: manuscripts and installation.key survive upgrades
// and uninstall in LocalAppData\MoZhou, outside the installation directory.
