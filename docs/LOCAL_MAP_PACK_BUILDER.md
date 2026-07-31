# TaxiNow Local Map Pack Builder

The Windows GUI replaces the slow GitHub Actions preprocessing job. It runs the
same resumable Geofabrik-based pipeline on the maintainer PC, blocks partial or
warning-bearing releases, and produces exact upload instructions only after
the build passes validation.

## 1. Install or build the GUI

For normal use, run the standard Windows installer:

```text
artifacts\map-pack-builder-installer\TaxiNow-Local-Map-Pack-Builder-Build-102-Setup.exe
```

It adds a Start menu shortcut, offers an optional desktop shortcut, and
provides a standard Windows uninstaller. The recommended installer task
automatically downloads and installs the isolated Python 3.12, `osmium-tool`,
and Overture Maps environment. Generated extracts and map packs are stored in
the workspace selected inside the application and are preserved when the
builder itself is uninstalled. Uninstalling the builder removes its managed
dependency environment and package cache.

To rebuild the installer from source:

From `C:\Users\admin\Documents\TaxiNow`, double-click
`scripts\build-map-pack-builder.cmd`, or run:

```powershell
cmd /c .\scripts\build-map-pack-builder.cmd
```

The installer, self-contained folder, and portable ZIP are created at:

```text
artifacts\map-pack-builder-installer\TaxiNow-Local-Map-Pack-Builder-Build-102-Setup.exe
artifacts\map-pack-builder\TaxiNow.MapPackBuilder.exe
artifacts\TaxiNow-Local-Map-Pack-Builder.zip
```

Keep the published folder together or distribute the generated ZIP. The `.cmd`
launcher avoids PowerShell execution-policy restrictions.

## 2. Map processing environment

The standard installer creates the dedicated environment automatically at:

```text
%LOCALAPPDATA%\TaxiNow Map Pack Builder\environment
```

No separate Python or Conda installation is required. The dependency step
requires internet access to the conda-forge package service.

For a portable/manual installation, install Miniforge or Miniconda for Windows,
then create the same environment from the file bundled beside the GUI:

```powershell
conda env create --file `
  .\tools\map_pipeline\environment-map-pack-windows.yml
```

This installs Python 3.12, the Windows build of `osmium-tool`, and the Overture
Maps client into an isolated `taxinow-map-packs` environment. `osmium-tool`
filters downloaded Geofabrik PBF extracts locally; the country build does not
send thousands of per-airport requests to public Overpass servers.

In the GUI, select:

- `python.exe` from
  `...\envs\taxinow-map-packs\python.exe`;
- `osmium.exe` from
  `...\envs\taxinow-map-packs\Library\bin\osmium.exe` if it is not found
  automatically.

Use **Validate prerequisites** before the first build.

## 3. Generate a country or subdivision

1. Enter the ISO two-letter Country/Region code, such as `CA`, `US`, or `CN`.
2. To keep a large build manageable, enter an ISO Province/State code such as
   `CA-BC`, `US-CA`, or `CN-11`. Leave it blank only when a complete country
   package is intended.
3. Use a new immutable version, for example `2026.07.30.2`.
4. Enter the GitHub release tag that will host the ZIP files, for example
   `v1.0.0-beta.5`.
5. Select a workspace on a drive with enough free space. Geofabrik PBF files,
   extracted features, normalized maps, quality reports, and ZIPs are retained
   so interrupted builds can resume.
6. Keep Overture and Microsoft building supplements enabled when terminal
   completeness is the priority.
7. Click **Build and validate map packs**.

The first build can take a long time because it downloads a regional PBF and
optional building datasets. Later runs reuse those files. Cancelling does not
delete completed downloads or regions.

## 4. Strict publication gate

The GUI calls `validate_map_pack_release.py` after generation. Publication is
blocked when any of the following is true:

- a planned region failed;
- fewer airports were examined or built than the plan requires;
- an airport was rejected;
- any generated airport retains a quality warning;
- an index count does not match the quality reports;
- a ZIP is absent, has the wrong size, or fails SHA-256 verification.

A failed build writes `output\VALIDATION-FAILED.txt`. It does not create
publication instructions. This prevents experimental, incomplete, or known-bad
pilot packages from being advertised to TaxiNow clients.

A passing build writes:

- `output\packs\*.zip` — immutable release assets;
- `output\index.publish.json` — the public index merged with unrelated packs
  already published;
- `output\PUBLISHING.md` — paste-ready `gh` commands and verification steps;
- `output\quality\*.json` — per-airport quality results;
- `output\metadata\*.json` — package metadata;
- `output\failures.json` — must remain empty.

## 5. Upload to TaxiNow-Release

Follow the generated `PUBLISHING.md` exactly:

1. Create or select the matching release tag in
   `skylarkning/TaxiNow-Release`.
2. Upload every generated ZIP to that GitHub Release. Upload the ZIP files
   before changing the public index.
3. Clone or update `skylarkning/TaxiNow-Release`.
4. Copy `index.publish.json` to `map-packs\index.json`.
5. Review, commit, and push the index directly to `main`.
6. Verify both the Release asset URLs and the raw public index.

Never overwrite an already published ZIP using the same version and filename.
Generate a new immutable version whenever package bytes change. TaxiNow verifies
the exact SHA-256 listed in the public index.

## 6. What TaxiNow does when no package exists

If `map-packs/index.json` contains no matching complete package, TaxiNow falls
back to its on-demand airport source pipeline. It does not download an
unlisted Release ZIP. The withdrawn Beta 4 CYVR and KDCA pilot ZIPs have been
removed from GitHub and are also revoked from the client cache.

An already installed CYVR map remains installed until it is deleted or
downloaded again by ICAO. Re-download it by ICAO after installing a build that
contains the package-revocation update.
