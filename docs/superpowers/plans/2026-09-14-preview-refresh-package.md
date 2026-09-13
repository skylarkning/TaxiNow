# Refreshed Preview Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the user's latest Flight Deck changes into the vertical-profile preview, verify MSFS 2024 and X-Plane 12 transports, and produce a complete Windows test package.

**Architecture:** Preserve the user's uncommitted main-worktree changes and reproduce them in the isolated preview branch. Validate behavior at the unit, packaged-file, native-library, UDP-loopback, server-API, and map-download pipeline boundaries before creating the ZIP.

**Tech Stack:** TypeScript/Vitest/Vite, .NET 10/xUnit, SimConnect, X-Plane UDP DataRefs, Python/PyInstaller map pipeline, PowerShell packaging.

**Spec:** User request in this task dated 2026-09-14.

## Global Constraints

- Do not modify or discard the user's uncommitted files in the main worktree.
- Remove the visible NavLog tab while retaining SimBrief navlog parsing required for route data.
- Preserve the existing full-screen MAP vertical profile and TAXI-only FROM/TO behavior.
- The package must contain the managed and native SimConnect libraries.
- The package must contain the map download pipeline executable and its required runtime data.
- Verify X-Plane 12 telemetry through a real UDP loopback into the packaged server API.

---

### Task 1: Integrate the other window's Flight Deck changes

**Files:**
- Create: `src/TaxiNow.Web/src/flightDeckPresentation.ts`
- Create: `src/TaxiNow.Web/src/flightDeckPresentation.test.ts`
- Create: `src/TaxiNow.Web/src/vatsimTrafficPresentation.ts`
- Create: `src/TaxiNow.Web/src/vatsimTrafficPresentation.test.ts`
- Modify: `src/TaxiNow.Web/src/flightDeck.ts`
- Modify: `src/TaxiNow.Web/src/flightDeck.css`
- Modify: `src/TaxiNow.Web/src/contracts.ts`
- Modify: `src/TaxiNow.Server/Vatsim/VatsimTrafficService.cs`
- Modify: `tests/TaxiNow.Server.Tests/VatsimTrafficServiceTests.cs`

**Interfaces:**
- Consumes: the user's uncommitted diff in `D:/TaxiNow-main/TaxiNow-main`.
- Produces: two-tab Flight Deck navigation, waypoint coordinate formatting, and typed VATSIM route details.

- [ ] **Step 1: Run the new presentation and VATSIM tests in the source worktree**

Run the targeted Vitest files and `VatsimTrafficServiceTests`; confirm the user's changes pass before copying them.

- [ ] **Step 2: Apply the changes to the preview branch**

Use focused patches so the existing vertical-profile changes remain intact.

- [ ] **Step 3: Run the targeted tests in the preview branch**

Run both new Vitest files plus the server VATSIM tests and confirm zero failures.

- [ ] **Step 4: Commit the integration**

Commit only the integrated source, tests, and this plan.

### Task 2: Verify simulator and map-download boundaries

**Files:**
- Inspect: `src/TaxiNow.SimConnect/**`
- Inspect: `src/TaxiNow.Server/XPlane/**`
- Inspect: `tools/map_pipeline/**`
- Inspect: packaged output under `artifacts/`

**Interfaces:**
- Consumes: built Windows x64 output.
- Produces: evidence for SimConnect library loading/export, X-Plane UDP telemetry publication, and map-pipeline execution.

- [ ] **Step 1: Run the complete Release build and test suite**

Run `scripts/build.ps1 -Configuration Release -SkipWebInstall` and require exit code 0.

- [ ] **Step 2: Publish the Windows x64 test build**

Publish `TaxiNow.App.csproj` self-contained with the current web output and pipeline executable.

- [ ] **Step 3: Validate MSFS 2024 SimConnect files**

Load `Microsoft.FlightSimulator.SimConnect.dll`, load native `SimConnect.dll`, and resolve `SimConnect_Open`.

- [ ] **Step 4: Validate X-Plane 12 transport**

Send X-Plane-compatible UDP DataRef telemetry to the packaged server and require connected JSON containing position, MSL altitude, and AGL altitude.

- [ ] **Step 5: Validate the map downloader**

Require `pipeline/taxinow-map-pipeline.exe`, invoke its version/help boundary, and verify bundled airport/runway catalogs and server map-download tests.

### Task 3: Package and audit the refreshed preview

**Files:**
- Create: `artifacts/TaxiNow-FlightDeck-Preview-Refresh-win-x64.zip`
- Create: `artifacts/preview-refresh-validation.json`

**Interfaces:**
- Consumes: verified Windows x64 publish directory.
- Produces: a portable test ZIP and a machine-readable manifest audit.

- [ ] **Step 1: Audit required package files**

Require the desktop app/server executables, web assets, SimConnect libraries, map pipeline executable, airport/runway catalogs, notices, and runtime configuration.

- [ ] **Step 2: Create the ZIP**

Compress the exact audited publish directory under a new preview filename without modifying the earlier package.

- [ ] **Step 3: Re-open and verify the ZIP**

List the archive entries, re-check required relative paths, record total entries, byte size, and SHA-256, and compare package contents with the audited publish directory.

- [ ] **Step 4: Report live-simulator limits accurately**

State whether MSFS 2024 or X-Plane 12 was actually running; do not present DLL/UDP-loopback verification as a live cockpit session.
