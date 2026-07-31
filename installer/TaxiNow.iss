#ifndef RepoRoot
  #error RepoRoot must be supplied by the packaging script.
#endif
#ifndef PublishDir
  #error PublishDir must be supplied by the packaging script.
#endif
#ifndef PrerequisiteDir
  #error PrerequisiteDir must be supplied by the packaging script.
#endif
#ifndef InstallerOutputDir
  #error InstallerOutputDir must be supplied by the packaging script.
#endif
#ifndef SetupBaseFilename
  #define SetupBaseFilename "TaxiNow-V1.0-Beta-6-Build-103-Setup"
#endif
#ifndef DefaultDataRoot
  #define DefaultDataRoot "{localappdata}\TaxiNow"
#endif

#define ProductName "TaxiNow"
#define ProductDisplayName "TaxiNow V1.0 Beta 6 (Build 103)"
#define ProductVersion "1.0.0.103"
#define ProductPublisher "Sky Ning"
#define ProductExeName "TaxiNow.App.exe"
#define WebView2ClientId "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
#define StorageMarker ".taxinow-data-root"
#define StorageMarkerContents "TaxiNow Storage Root v1"

[Setup]
AppId={{3AFCD6B3-F400-4B15-B890-93DEBCE043E3}
AppName={#ProductName}
AppVerName={#ProductDisplayName}
AppVersion={#ProductVersion}
AppPublisher={#ProductPublisher}
AppPublisherURL=https://github.com/skylarkning/TaxiNow-Release
AppSupportURL=https://github.com/skylarkning/TaxiNow-Release/issues
AppUpdatesURL=https://github.com/skylarkning/TaxiNow-Release/releases
DefaultDirName={localappdata}\Programs\TaxiNow
DefaultGroupName=TaxiNow
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#InstallerOutputDir}
OutputBaseFilename={#SetupBaseFilename}
SetupIconFile={#RepoRoot}\src\TaxiNow.App\Assets\TaxiNow.ico
UninstallDisplayIcon={app}\{#ProductExeName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
LicenseFile={#RepoRoot}\EULA.txt
InfoAfterFile={#RepoRoot}\NOTICE
VersionInfoVersion=1.0.0.103
VersionInfoProductVersion=1.0.0.103
VersionInfoCompany={#ProductPublisher}
VersionInfoDescription=TaxiNow V1.0 Beta 6 Build 103 Installer
VersionInfoProductName={#ProductName}
CloseApplications=yes
CloseApplicationsFilter={#ProductExeName}
RestartApplications=no
AppMutex=Local\TaxiNow.Desktop
SetupLogging=yes
Uninstallable=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
ConfirmUninstall=Uninstall TaxiNow? You will be asked whether to keep downloaded maps and user data for a future installation.%n%n卸载 TaxiNow？下一步可选择为后续安装保留已下载地图和用户数据。

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "*.pdb,*.map"
Source: "{#PrerequisiteDir}\MicrosoftEdgeWebview2Setup.exe"; Flags: dontcopy

[Icons]
Name: "{group}\TaxiNow"; Filename: "{app}\{#ProductExeName}"; WorkingDir: "{app}"
Name: "{group}\TaxiNow EULA"; Filename: "{app}\EULA.txt"
Name: "{group}\TaxiNow License"; Filename: "{app}\LICENSE.txt"
Name: "{group}\Third-party notices"; Filename: "{app}\NOTICE"
Name: "{group}\TaxiNow official releases"; Filename: "https://github.com/skylarkning/TaxiNow-Release"
Name: "{group}\Uninstall TaxiNow"; Filename: "{uninstallexe}"
Name: "{autodesktop}\TaxiNow"; Filename: "{app}\{#ProductExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#ProductExeName}"; Description: "Launch TaxiNow"; Flags: nowait postinstall skipifsilent

[Code]
const
  WebView2RegistryPath =
    'Software\Microsoft\EdgeUpdate\Clients\{#WebView2ClientId}';
  StorageMarkerName = '{#StorageMarker}';
  StorageMarkerValue = '{#StorageMarkerContents}';

var
  KeepTaxiNowData: Boolean;

function HasWebView2AtRoot(RootKey: Integer): Boolean;
var
  Version: String;
begin
  Result :=
    RegQueryStringValue(RootKey, WebView2RegistryPath, 'pv', Version) and
    (Version <> '') and (Version <> '0.0.0.0');
end;

function WebView2Installed(): Boolean;
begin
  Result :=
    HasWebView2AtRoot(HKCU) or
    HasWebView2AtRoot(HKLM32) or
    HasWebView2AtRoot(HKLM64);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  Bootstrapper: String;
begin
  Result := '';
  if WebView2Installed() then
  begin
    Log('Microsoft Edge WebView2 Runtime is already installed.');
    exit;
  end;

  ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
  Bootstrapper := ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe');
  Log('Installing Microsoft Edge WebView2 Runtime.');
  if not Exec(
    Bootstrapper,
    '/silent /install',
    '',
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode) then
  begin
    Result :=
      'TaxiNow requires Microsoft Edge WebView2 Runtime, but its installer ' +
      'could not be started.';
  end
  else if ResultCode <> 0 then
  begin
    Result :=
      'Microsoft Edge WebView2 Runtime installation failed with code ' +
      IntToStr(ResultCode) + '.';
  end;
end;

function IsMarkedTaxiNowRoot(Root: String): Boolean;
var
  Marker: AnsiString;
begin
  Result := False;
  if LoadStringFromFile(
       AddBackslash(Root) + StorageMarkerName,
       Marker) then
    Result := Trim(String(Marker)) = StorageMarkerValue;
end;

procedure DeleteCustomTaxiNowStorage(Root: String);
begin
  Root := RemoveBackslashUnlessRoot(Trim(Root));
  if (Root = '') or not DirExists(Root) then
    exit;

  if not IsMarkedTaxiNowRoot(Root) then
  begin
    Log('Skipping unmarked custom storage root: ' + Root);
    exit;
  end;

  Log('Removing TaxiNow custom storage: ' + Root);
  DelTree(AddBackslash(Root) + 'maps', True, True, True);
  DelTree(AddBackslash(Root) + 'source-cache', True, True, True);
  DelTree(AddBackslash(Root) + 'pipeline', True, True, True);
  DelTree(AddBackslash(Root) + 'web', True, True, True);
  DelTree(AddBackslash(Root) + 'logs', True, True, True);
  DeleteFile(AddBackslash(Root) + 'TaxiNow.db');
  DeleteFile(AddBackslash(Root) + 'TaxiNow.db-shm');
  DeleteFile(AddBackslash(Root) + 'TaxiNow.db-wal');
  DeleteFile(AddBackslash(Root) + 'TaxiNow.db-journal');
  DeleteFile(AddBackslash(Root) + StorageMarkerName);
  RemoveDir(Root);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DefaultRoot: String;
  PointerPath: String;
  CustomRoot: String;
  PointerContents: AnsiString;
begin
  if CurUninstallStep <> usUninstall then
    exit;

  KeepTaxiNowData := True;
  if not UninstallSilent then
    KeepTaxiNowData :=
      MsgBox(
        'Keep downloaded airport maps and TaxiNow user data?' + #13#10 + #13#10 +
        'Choose Yes (recommended for upgrades) to reuse your maps and ' +
        'settings after reinstalling.' + #13#10 +
        'Choose No to permanently delete all TaxiNow data.' + #13#10 + #13#10 +
        '是否保留已下载机场地图和 TaxiNow 用户数据？' + #13#10 +
        '升级用户建议选择“是”，重新安装后可继续使用地图和设置；' +
        '选择“否”将永久删除全部 TaxiNow 数据。',
        mbConfirmation,
        MB_YESNO or MB_DEFBUTTON1) = IDYES;
  if KeepTaxiNowData then
  begin
    Log('Preserving TaxiNow maps and user data at user request.');
    exit;
  end;

  DefaultRoot := ExpandConstant('{#DefaultDataRoot}');
  PointerPath := AddBackslash(DefaultRoot) + 'desktop-storage-root.txt';
  if LoadStringFromFile(PointerPath, PointerContents) then
  begin
    CustomRoot :=
      RemoveBackslashUnlessRoot(Trim(String(PointerContents)));
    if (CustomRoot <> '') and
       (CompareText(
          CustomRoot,
          RemoveBackslashUnlessRoot(DefaultRoot)) <> 0) then
      DeleteCustomTaxiNowStorage(CustomRoot);
  end;

  { The default path is always a TaxiNow-owned per-user directory. }
  Log('Removing TaxiNow default user data: ' + DefaultRoot);
  DelTree(DefaultRoot, True, True, True);
end;
