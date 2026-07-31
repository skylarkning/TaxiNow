#ifndef RepoRoot
  #error RepoRoot must be supplied by the build script.
#endif
#ifndef PublishDir
  #error PublishDir must be supplied by the build script.
#endif
#ifndef InstallerOutputDir
  #error InstallerOutputDir must be supplied by the build script.
#endif
#ifndef PrerequisiteDir
  #error PrerequisiteDir must be supplied by the build script.
#endif

#define ProductName "TaxiNow Local Map Pack Builder"
#define ProductDisplayName "TaxiNow Local Map Pack Builder (Build 102)"
#define ProductVersion "1.0.0.102"
#define ProductPublisher "Sky Ning"
#define ProductExeName "TaxiNow.MapPackBuilder.exe"
#define SetupBaseFilename "TaxiNow-Local-Map-Pack-Builder-Build-102-Setup"

[Setup]
AppId={{E78A7A6A-A234-4BBF-875B-0C284972E6F0}
AppName={#ProductName}
AppVerName={#ProductDisplayName}
AppVersion={#ProductVersion}
AppPublisher={#ProductPublisher}
AppPublisherURL=https://github.com/skylarkning/TaxiNow-Release
AppSupportURL=https://github.com/skylarkning/TaxiNow-Release/issues
AppUpdatesURL=https://github.com/skylarkning/TaxiNow-Release/releases
DefaultDirName={localappdata}\Programs\TaxiNow Map Pack Builder
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
VersionInfoVersion={#ProductVersion}
VersionInfoProductVersion={#ProductVersion}
VersionInfoCompany={#ProductPublisher}
VersionInfoDescription=TaxiNow Local Map Pack Builder Build 102 Installer
VersionInfoProductName={#ProductName}
CloseApplications=yes
CloseApplicationsFilter={#ProductExeName}
RestartApplications=no
Uninstallable=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked
Name: "dependencies"; Description: "Install or update map-pack generation dependencies (recommended; internet required)"; GroupDescription: "Map-pack environment:"; Flags: checkedonce

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "*.pdb,*.map"
Source: "{#PrerequisiteDir}\micromamba.exe"; DestDir: "{app}\runtime"; Flags: ignoreversion
Source: "{#RepoRoot}\EULA.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoRoot}\LICENSE"; DestDir: "{app}"; DestName: "LICENSE.txt"; Flags: ignoreversion
Source: "{#RepoRoot}\NOTICE"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#RepoRoot}\docs\LOCAL_MAP_PACK_BUILDER.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\TaxiNow Map Pack Builder"; Filename: "{app}\{#ProductExeName}"; WorkingDir: "{app}"
Name: "{group}\TaxiNow Map Pack Builder Guide"; Filename: "{app}\LOCAL_MAP_PACK_BUILDER.md"
Name: "{group}\Uninstall TaxiNow Map Pack Builder"; Filename: "{uninstallexe}"
Name: "{autodesktop}\TaxiNow Map Pack Builder"; Filename: "{app}\{#ProductExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{cmd}"; Parameters: "/d /c ""{app}\pipeline\install_map_pack_environment.cmd"""; Description: "Install TaxiNow map-pack dependencies"; StatusMsg: "Installing Python, osmium-tool, and map processing dependencies. This may take several minutes..."; Flags: runhidden waituntilterminated; Tasks: dependencies
Filename: "{app}\{#ProductExeName}"; Description: "Launch TaxiNow Local Map Pack Builder"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\TaxiNow Map Pack Builder"
