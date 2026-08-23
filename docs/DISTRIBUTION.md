# Windows distribution

TaxiNow V1.4.5 (internal build 123) ships in two forms:

1. A Windows installer is the primary release for most users.
2. A portable ZIP is a secondary release for advanced users and troubleshooting.

Official public binaries are published only by `skylarkning` through the
[TaxiNow page on flightsim.to](https://flightsim.to/addon/112712/taxinow) and the
[TaxiNow-Release repository](https://github.com/skylarkning/TaxiNow-Release).
The private development repository is not a public distribution channel.

The per-user installer:

- displays and requires acceptance of `EULA.txt`;
- installs the self-contained x64 app under
  `%LocalAppData%\Programs\TaxiNow`;
- creates Start menu entries, an optional desktop shortcut, and an uninstaller;
- detects or installs the Microsoft Edge WebView2 Evergreen Runtime;
- preserves application and map data during in-place upgrades; and
- asks whether to retain TaxiNow-owned data during uninstall.

The installer and executable should be code signed with a publicly trusted
code-signing certificate before public distribution. The packaging script does
not create or trust a self-signed certificate.

The portable ZIP contains the same self-contained x64 application and native
dependencies, but it cannot provide the same prerequisite checks, shortcuts,
uninstall experience, or reliable upgrade workflow. It does not store
downloaded maps inside the extracted application directory.

## Map-data location

Downloaded airport maps, the SQLite asset catalog, source cache, pipeline
working files, and logs belong in a user-writable data directory rather than
the installation directory. TaxiNow defaults to:

```text
%LocalAppData%\TaxiNow
```

The Windows app exposes **Maps & storage → Downloaded maps location → Change
folder**. The selected root is saved per Windows user in:

```text
%LocalAppData%\TaxiNow\desktop-settings.json
```

Changing the root requires restarting TaxiNow. Existing data is deliberately
left in the old location: TaxiNow never silently copies or deletes a potentially
large map library. Selecting the old folder restores access to those assets.
The folder picker is a desktop-only capability and is not exposed through the
LAN browser interface.

Every data root selected by the app carries this ownership marker:

```text
.taxinow-data-root
```

TaxiNow accepts only an empty dedicated custom folder, an existing TaxiNow-only
folder, or an already marked folder. This lets the uninstaller distinguish
TaxiNow storage from an arbitrary user folder.

## Uninstall behavior

Uninstalling always removes the installed application and shortcuts. The
uninstaller then offers a bilingual choice:

- **Yes / Keep data** (the default and recommended upgrade choice) preserves
  downloaded airport maps, the asset database, caches, settings, logs, the
  WebView2 profile, and the selected custom-storage pointer.
- **No / Delete data** permanently removes those TaxiNow-owned files for the
  current Windows user.

When deletion is selected, the default `%LocalAppData%\TaxiNow` directory is
removed recursively. For a marked custom root, the uninstaller deletes only
known TaxiNow directories, database files, and the ownership marker. If
unrelated files are present, it leaves those files and their parent directory
untouched.

The uninstaller does not remove Microsoft Flight Simulator or the system-wide
Microsoft Edge WebView2 Runtime.

## Build release artifacts

Run from the repository root:

```powershell
.\scripts\package-windows.ps1
```

The script publishes the self-contained app, verifies the Microsoft signature
on the downloaded WebView2 bootstrapper, compiles the Inno Setup installer,
creates the portable ZIP, and writes SHA-256 checksums beneath
`artifacts\installer`.
