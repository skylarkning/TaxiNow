# MAP Vertical Situation Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a MAP-only PROFILE control and a complete cached terrain/plan/live-aircraft vertical situation display for SimBrief routes in MSFS 2020/2024 and X-Plane 12.

**Architecture:** Extend the shared telemetry and parsed flight-plan models with optional vertical data, then add a bounded server-side elevation service that samples and caches Open-Meteo/Copernicus terrain. Keep route/profile mathematics in a pure frontend module and rendering in a dedicated accessible canvas view; `flightDeck.ts` only coordinates state, fetching, and MAP/TAXI visibility.

**Tech Stack:** .NET 10, ASP.NET Core minimal APIs, SimConnect, X-Plane RREF UDP, TypeScript 5.9, HTML Canvas 2D, MapLibre GL, Vitest, xUnit v3.

**Spec:** `docs/superpowers/specs/2026-09-12-map-vertical-profile-design.md`

## Global Constraints

- PROFILE appears immediately below TAXI only while MAP is active.
- FROM, TO, and Plan Taxi appear only while TAXI is active.
- The expanded panel uses about 28 percent of MAP height and resizes rather than covers the map.
- Terrain comes from a configurable Open-Meteo-compatible endpoint, is sampled at about 2 NM with no more than 600 points, and is requested upstream in batches of no more than 100 coordinates.
- Terrain cache entries are fresh for 30 days; stale entries may be used only as an offline fallback.
- MSFS uses `PLANE ALTITUDE` and `PLANE ALT ABOVE GROUND`; X-Plane uses `sim/flightmodel/position/elevation` and `sim/flightmodel/position/y_agl`.
- The display is for flight simulation only and must not call itself TAWS, EGPWS, or certified navigation equipment.
- Do not add a chart dependency; render the functional plot with the existing browser Canvas 2D API and provide an accessible text summary.
- Preserve all unrelated dirty-worktree changes and stage only files belonging to the task being committed.
- For an already-modified shared file, inspect its diff and use interactive hunk staging; never stage pre-existing unrelated edits with a task commit.

---

### Task 1: Carry MSL and AGL altitude through every telemetry source

**Files:**
- Modify: `src/TaxiNow.Core/Telemetry/TelemetrySnapshot.cs`
- Modify: `src/TaxiNow.SimConnect/Managed/ManagedSimConnectTelemetrySource.cs`
- Modify: `src/TaxiNow.SimConnect/Replay/ReplayTelemetrySource.cs`
- Modify: `src/TaxiNow.Server/XPlane/XPlaneTelemetrySource.cs`
- Modify: `src/TaxiNow.Web/src/contracts.ts`
- Modify: `tests/TaxiNow.Core.Tests/TelemetryTests.cs`
- Modify: `tests/TaxiNow.Server.Tests/XPlaneTelemetryTests.cs`
- Modify: `tests/TaxiNow.Server.Tests/ServerContractTests.cs`

**Interfaces:**
- Produces: `TelemetrySnapshot.AltitudeMslFeet: double?` and `TelemetrySnapshot.AltitudeAglFeet: double?` serialized as `altitudeMslFeet` and `altitudeAglFeet`.
- Consumes: existing simulator position streams and replay JSON-lines frames.

- [ ] **Step 1: Write failing telemetry contract tests**

Add assertions showing altitude is optional for old callers and serialized for new callers:

```csharp
var sample = new TelemetrySnapshot(
    1, SimulatorEdition.Msfs2024, true, false,
    43.0, -79.0, 90, 250, now, now, 10,
    AltitudeMslFeet: 12_345,
    AltitudeAglFeet: 10_900);
var json = JsonSerializer.Serialize(sample, options);
Assert.Contains("\"altitudeMslFeet\":12345", json);
Assert.Contains("\"altitudeAglFeet\":10900", json);
```

Update the X-Plane loopback response to send seven values and assert metre-to-feet conversion:

```csharp
await simulator.SendAsync(
    CreateResponse(43.68f, -79.62f, 237.5f, 10f, 0f, 3762.756f, 914.4f),
    request.RemoteEndPoint,
    timeout.Token);
Assert.Equal(12_345, samples.Current.AltitudeMslFeet, 0);
Assert.Equal(3_000, samples.Current.AltitudeAglFeet, 0);
```

- [ ] **Step 2: Run focused tests and verify the expected failure**

Run:

```powershell
dotnet test tests/TaxiNow.Core.Tests/TaxiNow.Core.Tests.csproj --filter Altitude
dotnet test tests/TaxiNow.Server.Tests/TaxiNow.Server.Tests.csproj --filter "XPlaneTelemetrySource_ReceivesAnXPlane12PositionOverUdp|TelemetryContract_SerializesAltitude"
```

Expected: compile/test failure because the altitude properties do not exist and X-Plane subscribes to only five values.

- [ ] **Step 3: Append optional altitude fields to the shared contract**

Append defaults to the record so existing positional construction remains valid:

```csharp
public sealed record TelemetrySnapshot(
    // existing parameters unchanged
    TrackingState State = TrackingState.Connected,
    double? AltitudeMslFeet = null,
    double? AltitudeAglFeet = null);
```

Mirror them in TypeScript:

```ts
altitudeMslFeet?: number | null;
altitudeAglFeet?: number | null;
```

- [ ] **Step 4: Read altitude from MSFS, X-Plane, and replay**

Extend `UserAircraftData` and its definitions in the same order:

```csharp
public double AltitudeMslFeet;
public double AltitudeAglFeet;

connection.AddToDataDefinition(
    DataDefinition.UserAircraft, "PLANE ALTITUDE", "feet",
    SIMCONNECT_DATATYPE.FLOAT64, 0, 5);
connection.AddToDataDefinition(
    DataDefinition.UserAircraft, "PLANE ALT ABOVE GROUND", "feet",
    SIMCONNECT_DATATYPE.FLOAT64, 0, 6);
```

Pass both values into `TelemetrySnapshot` and include a 1-foot threshold in `HasMeaningfulChange`.

Append these X-Plane datarefs:

```csharp
"sim/flightmodel/position/elevation",
"sim/flightmodel/position/y_agl"
```

Convert `values[5]` and `values[6]` with `3.28083989501312`. Extend `ReplayFrame` with nullable `altitudeMslFeet` and `altitudeAglFeet`, then forward them without requiring old fixtures to change.

- [ ] **Step 5: Run telemetry tests**

Run:

```powershell
dotnet test tests/TaxiNow.Core.Tests/TaxiNow.Core.Tests.csproj
dotnet test tests/TaxiNow.Server.Tests/TaxiNow.Server.Tests.csproj --filter "XPlaneTelemetryTests|TelemetryContract"
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit telemetry support**

```powershell
git add -p -- src/TaxiNow.Core/Telemetry/TelemetrySnapshot.cs src/TaxiNow.SimConnect/Managed/ManagedSimConnectTelemetrySource.cs src/TaxiNow.SimConnect/Replay/ReplayTelemetrySource.cs src/TaxiNow.Server/XPlane/XPlaneTelemetrySource.cs src/TaxiNow.Web/src/contracts.ts tests/TaxiNow.Core.Tests/TelemetryTests.cs tests/TaxiNow.Server.Tests/XPlaneTelemetryTests.cs tests/TaxiNow.Server.Tests/ServerContractTests.cs
git commit -m "feat: add simulator altitude telemetry"
```

---

### Task 2: Normalize SimBrief planned altitudes and restrictions

**Files:**
- Modify: `src/TaxiNow.Web/src/flightPlan.ts`
- Modify: `src/TaxiNow.Web/src/flightPlan.test.ts`

**Interfaces:**
- Produces: `AltitudeConstraintKind`, optional altitude fields on `FlightPoint`, and `FlightPlan.originElevationFeet` / `destinationElevationFeet`.
- Consumes: SimBrief `general`, airport, and navlog fix objects.

- [ ] **Step 1: Add failing parser tests with realistic mixed string/number fields**

Use a plan fixture containing:

```ts
navlog: { fix: [
  { ident: "CLB", pos_long: "-79", pos_lat: "43", altitude_feet: "12000", altitude_desc: "2", altitude1: "10000" },
  { ident: "CRZ", pos_long: "-78", pos_lat: "44", altitude_feet: 35000, altitude_desc: "4", altitude1: "33000", altitude2: "35000" }
] },
origin: { icao_code: "CYYZ", pos_long: "-79.63", pos_lat: "43.67", elevation: "569" },
destination: { icao_code: "CYQT", pos_long: "-89.32", pos_lat: "48.37", elevation: 653 }
```

Assert that planned altitude remains distinct from restrictions, descriptor `2` maps to `atOrAbove`, descriptor `4` maps to `between`, and invalid values such as `NaN`, negative altitude below `-2_000`, or altitude above `100_000` are ignored.

- [ ] **Step 2: Run the focused Vitest file and verify failure**

Run:

```powershell
pnpm --dir src/TaxiNow.Web test -- src/flightPlan.test.ts
```

Expected: failure because vertical fields are absent.

- [ ] **Step 3: Add normalized flight-plan types and parser helpers**

Add:

```ts
export type AltitudeConstraintKind =
  | "at" | "atOrAbove" | "atOrBelow" | "between";

export interface FlightPoint {
  ident: string;
  position: Position;
  airway: string;
  isProcedure?: boolean;
  plannedAltitudeFeet?: number;
  constraintKind?: AltitudeConstraintKind;
  minimumAltitudeFeet?: number;
  maximumAltitudeFeet?: number;
}
```

Implement `optionalAltitude(value)` to accept finite strings/numbers in `[-2_000, 100_000]`. Map descriptor values `1/AT`, `2/AT_OR_ABOVE`, `3/AT_OR_BELOW`, and `4/BETWEEN`; omit a constraint when its required bound is invalid. Add optional airport elevations to `FlightPlan`.

- [ ] **Step 4: Preserve vertical data during duplicate-point removal**

When adjacent coordinates collapse, keep the later point's vertical fields if they are defined instead of silently discarding the restriction. Add a test with two fixes less than `0.005 NM` apart.

- [ ] **Step 5: Run parser tests and the full frontend suite**

Run:

```powershell
pnpm --dir src/TaxiNow.Web test -- src/flightPlan.test.ts
pnpm --dir src/TaxiNow.Web test
```

Expected: all tests pass.

- [ ] **Step 6: Commit flight-plan vertical parsing**

```powershell
git add -p -- src/TaxiNow.Web/src/flightPlan.ts src/TaxiNow.Web/src/flightPlan.test.ts
git commit -m "feat: parse SimBrief vertical profile data"
```

---

### Task 3: Fetch, validate, batch, and cache route terrain

**Files:**
- Create: `src/TaxiNow.Server/Elevation/ElevationProfileService.cs`
- Create: `src/TaxiNow.Server/Elevation/ElevationEndpoints.cs`
- Create: `tests/TaxiNow.Server.Tests/ElevationProfileServiceTests.cs`
- Modify: `src/TaxiNow.Storage/StoragePaths.cs`
- Modify: `src/TaxiNow.Server/TaxiNowHost.cs`
- Modify: `src/TaxiNow.Server/OpenApiDocument.cs`
- Modify: `tests/TaxiNow.Storage.Tests/StorageTests.cs`

**Interfaces:**
- Consumes: `ElevationProfileRequest(IReadOnlyList<ElevationCoordinate> Route)` through `POST /api/v1/elevation/profile`.
- Produces: `ElevationProfileResponse(IReadOnlyList<ElevationSample> Samples, string CacheState, DateTimeOffset GeneratedAt, string Source, string Attribution)` where each sample contains longitude, latitude, cumulative nautical miles, and elevation feet.

- [ ] **Step 1: Write failing validation, batching, and cache tests**

Create a fake `HttpMessageHandler` that records upstream URLs and returns deterministic elevation arrays. Cover:

```csharp
[Fact] public async Task GetAsync_BatchesAtOneHundredCoordinates()
[Fact] public async Task GetAsync_ReturnsFreshCacheWithoutNetwork()
[Fact] public async Task GetAsync_ReturnsStaleCacheWhenNetworkFails()
[Fact] public async Task GetAsync_RejectsMismatchedElevationCount()
[Theory] [InlineData(0)] [InlineData(3001)]
public async Task GetAsync_RejectsInvalidRoutePointCount(int count)
```

Assert 201 samples create three upstream calls, metre values convert to feet, cache metadata includes attribution, and route samples never exceed 600.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```powershell
dotnet test tests/TaxiNow.Server.Tests/TaxiNow.Server.Tests.csproj --filter ElevationProfile
dotnet test tests/TaxiNow.Storage.Tests/TaxiNow.Storage.Tests.csproj --filter Elevation
```

Expected: compile failure because service, endpoint, and cache path do not exist.

- [ ] **Step 3: Add the owned elevation cache directory**

Add `ElevationProfilesPath => Path.Combine(Root, "elevation-profiles")`, create it in `EnsureCreated`, and add `elevation-profiles` to `CanClaimOwnership` allowed names. Test all three behaviours.

- [ ] **Step 4: Implement bounded route densification and cache identity**

In `ElevationProfileService`, validate 2–3000 route coordinates, finite WGS84 ranges, and a maximum serialized request size. Densify great-circle segments near 2 NM, increasing spacing when required so the final list is at most 600 points. Compute cumulative distance while sampling.

Build a SHA-256 cache key from schema version plus coordinates rounded to five decimal places. Store JSON atomically using a temporary file in `ElevationProfilesPath` followed by `File.Move(temp, target, true)`.

- [ ] **Step 5: Implement upstream acquisition with strict batching**

Use the configured base URL `TaxiNow:Elevation:BaseUrl`, defaulting to `https://api.open-meteo.com/v1/elevation`. When `TaxiNow:Elevation:ApiKey` is non-empty, append it as the `apikey` query parameter without logging it. Send comma-separated latitude/longitude pairs in batches of 100 with a 15-second timeout, no automatic redirects, and a 1 MB response limit. Validate that every response has exactly one finite elevation per requested coordinate. Add a test proving the configured key reaches the fake upstream and does not appear in response/cache metadata.

Return:

```csharp
new ElevationProfileResponse(
    samples,
    CacheState: "fresh",
    GeneratedAt: now,
    Source: "Open-Meteo / Copernicus DEM",
    Attribution: "Elevation: Open-Meteo · Copernicus DEM");
```

On acquisition failure, return a stale valid cache entry with `CacheState: "cachedOffline"`; otherwise throw a typed unavailable exception mapped to HTTP 502.

- [ ] **Step 6: Register the service and endpoint**

Register a named/configured `HttpClient`, add `app.MapElevationProfile()`, and document the POST path in `OpenApiDocument`. Return 400 for validation, 502 for unavailable upstream without cache, and 200 for fresh/cached responses.

- [ ] **Step 7: Run server and storage tests**

Run:

```powershell
dotnet test tests/TaxiNow.Storage.Tests/TaxiNow.Storage.Tests.csproj
dotnet test tests/TaxiNow.Server.Tests/TaxiNow.Server.Tests.csproj --filter "ElevationProfile|ServerContract"
```

Expected: all selected tests pass.

- [ ] **Step 8: Commit the terrain service**

```powershell
git add -- src/TaxiNow.Server/Elevation/ElevationProfileService.cs src/TaxiNow.Server/Elevation/ElevationEndpoints.cs tests/TaxiNow.Server.Tests/ElevationProfileServiceTests.cs
git add -p -- src/TaxiNow.Storage/StoragePaths.cs src/TaxiNow.Server/TaxiNowHost.cs src/TaxiNow.Server/OpenApiDocument.cs tests/TaxiNow.Storage.Tests/StorageTests.cs
git commit -m "feat: add cached route elevation profiles"
```

---

### Task 4: Build the pure vertical-profile display model

**Files:**
- Create: `src/TaxiNow.Web/src/verticalProfile.ts`
- Create: `src/TaxiNow.Web/src/verticalProfile.test.ts`
- Modify: `src/TaxiNow.Web/src/contracts.ts`

**Interfaces:**
- Consumes: `FlightPlan`, `ElevationProfileResponse`, and optional `TelemetrySnapshot`.
- Produces: `buildVerticalProfileModel(input): VerticalProfileModel`, `projectPositionOntoRoute(points, position): RouteProjection`, and `terrainClearanceBand(clearanceFeet, airborne): "normal" | "amber" | "red"`.

- [ ] **Step 1: Write failing pure-function tests**

Cover cumulative distance, nearest-leg projection, anti-meridian routes, exact and estimated altitude paths, constraint preservation, cache state, disconnected telemetry, and bands:

```ts
expect(terrainClearanceBand(2500, true)).toBe("normal");
expect(terrainClearanceBand(1500, true)).toBe("amber");
expect(terrainClearanceBand(500, true)).toBe("red");
expect(terrainClearanceBand(500, false)).toBe("normal");
```

Assert a point halfway along a 100 NM leg projects near 50 NM, and a stale sample produces no live aircraft marker.

- [ ] **Step 2: Run the test and verify failure**

Run:

```powershell
pnpm --dir src/TaxiNow.Web test -- src/verticalProfile.test.ts
```

Expected: failure because `verticalProfile.ts` does not exist.

- [ ] **Step 3: Define the terrain API contract**

Add to `contracts.ts`:

```ts
export interface ElevationProfileResponse {
  samples: Array<{
    longitude: number;
    latitude: number;
    distanceNm: number;
    elevationFeet: number;
  }>;
  cacheState: "fresh" | "cachedOffline";
  generatedAt: string;
  source: string;
  attribution: string;
}
```

- [ ] **Step 4: Implement route projection and profile normalization**

Use local tangent-plane projection per route leg, clamp the fraction to `[0, 1]`, and choose the candidate with minimum cross-track distance. Interpolate terrain elevation at the projected route distance.

Use exact `plannedAltitudeFeet` values when present. For missing values, create a display-only estimate that starts/ends at airport elevation, reaches cruise altitude by the first 20 percent of distance, and starts descent at the final 30 percent. Mark each generated point with `estimated: true`; do not create constraints.

- [ ] **Step 5: Implement clearance bands and display metrics**

Calculate clearance against live MSL altitude when a valid airborne sample exists, otherwise against the planned/estimated path. Red is `<= 1_000 ft`, amber is `<= 2_000 ft`, and normal is above 2,000 feet. Emit current ALT, AGL, next restriction, distance remaining, source/cache badge, and a sentence suitable for assistive technology.

- [ ] **Step 6: Run focused and full frontend tests**

Run:

```powershell
pnpm --dir src/TaxiNow.Web test -- src/verticalProfile.test.ts
pnpm --dir src/TaxiNow.Web test
```

Expected: all tests pass.

- [ ] **Step 7: Commit profile mathematics**

```powershell
git add -- src/TaxiNow.Web/src/verticalProfile.ts src/TaxiNow.Web/src/verticalProfile.test.ts
git add -p -- src/TaxiNow.Web/src/contracts.ts
git commit -m "feat: model vertical route profiles"
```

---

### Task 5: Render the accessible vertical situation panel

**Files:**
- Create: `src/TaxiNow.Web/src/verticalProfileView.ts`
- Create: `src/TaxiNow.Web/src/verticalProfileView.test.ts`
- Modify: `src/TaxiNow.Web/src/flightDeck.css`

**Interfaces:**
- Consumes: `VerticalProfileModel` from Task 4.
- Produces: `createVerticalProfileView(host): VerticalProfileView` with `render(model)`, `setOpen(open)`, `resize()`, and `destroy()`.

- [ ] **Step 1: Write failing view-state tests**

Test DOM-independent helpers exported from the view module:

```ts
expect(profilePanelHeight(1200, false)).toBeCloseTo(0.28 * 1200);
expect(profilePanelHeight(600, true)).toBeGreaterThan(0.4 * 600);
expect(selectWaypointLabelIndexes(80, 8)).toHaveLength(8);
```

Test that the view's accessible summary includes route endpoints, live altitude when valid, terrain-unavailable state, and simulation-only wording.

- [ ] **Step 2: Run the focused view test and verify failure**

Run:

```powershell
pnpm --dir src/TaxiNow.Web test -- src/verticalProfileView.test.ts
```

Expected: failure because the view module does not exist.

- [ ] **Step 3: Create the panel DOM and canvas lifecycle**

Create one `<section id="fd-vertical-profile">` containing a compact metric header, loading/empty/error overlay, `<canvas>`, attribution, retry button, close button, and a visually hidden `aria-live="polite"` summary. Scale the backing canvas with `devicePixelRatio`, use `ResizeObserver`, and redraw only when model, size, or theme changes.

- [ ] **Step 4: Draw the avionics-inspired plot**

Render in this order: background, grid/ticks, terrain fill, amber/red terrain overlays, planned line, restriction glyphs, airport markers, waypoint labels, and live aircraft marker. Use TaxiNow theme variables and existing typography. Clamp labels and use the selection helper to avoid overlap.

Pointer hover/focus exposes distance, waypoint, terrain, planned altitude, and restriction in a tooltip. Keyboard Left/Right moves among sampled points; Escape closes the panel.

- [ ] **Step 5: Add responsive styling**

Add CSS so desktop uses 28 percent height with a 220 px minimum and 360 px maximum. At `max-width: 620px`, default closed and use 46 percent height when opened. Set `#fd-root[data-profile-open="true"] #fd-map` and related map overlays above the panel bottom, with transitions disabled under `prefers-reduced-motion`.

- [ ] **Step 6: Run view and full frontend tests**

Run:

```powershell
pnpm --dir src/TaxiNow.Web test -- src/verticalProfileView.test.ts
pnpm --dir src/TaxiNow.Web build
pnpm --dir src/TaxiNow.Web test
```

Expected: TypeScript, production build, and all tests pass.

- [ ] **Step 7: Commit the panel renderer**

```powershell
git add -- src/TaxiNow.Web/src/verticalProfileView.ts src/TaxiNow.Web/src/verticalProfileView.test.ts
git add -p -- src/TaxiNow.Web/src/flightDeck.css
git commit -m "feat: render vertical situation panel"
```

---

### Task 6: Integrate PROFILE into MAP and load terrain safely

**Files:**
- Modify: `src/TaxiNow.Web/src/flightDeck.ts`
- Modify: `src/TaxiNow.Web/src/flightPlanGround.ts`
- Modify: `src/TaxiNow.Web/src/flightPlanGround.test.ts`
- Create: `src/TaxiNow.Web/src/verticalProfileController.ts`
- Create: `src/TaxiNow.Web/src/verticalProfileController.test.ts`

**Interfaces:**
- Consumes: plan import/restore/clear events, `updateFlightDeckPosition`, elevation endpoint, `VerticalProfileModel`, and `VerticalProfileView`.
- Produces: MAP-only PROFILE rail control and latest-request-wins terrain/profile orchestration.

- [ ] **Step 1: Write failing rail-state tests**

Replace the binary shortcut helper with a complete state function:

```ts
expect(flightDeckAuxiliaryControls("globe")).toEqual({
  profile: true,
  airports: false,
  taxiPlanner: false
});
expect(flightDeckAuxiliaryControls("ground")).toEqual({
  profile: false,
  airports: true,
  taxiPlanner: true
});
```

Add controller tests proving one request per route hash, cache result reuse, retry after error, and an older response cannot replace a newer imported plan.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```powershell
pnpm --dir src/TaxiNow.Web test -- src/flightPlanGround.test.ts src/verticalProfileController.test.ts
```

Expected: failure because the new helper/controller do not exist.

- [ ] **Step 3: Add the MAP-only PROFILE rail control**

Create `#fd-profile-mode` immediately after the TAXI primary button and before `#fd-airport-shortcuts`. Label it `垂直` for Chinese locales and `PROFILE` otherwise. `setMode` applies `flightDeckAuxiliaryControls` to the PROFILE, airport shortcuts, and Plan Taxi elements. Set `aria-pressed` and the existing blue selected style when the panel is open.

- [ ] **Step 4: Implement latest-request-wins terrain loading**

`VerticalProfileController` owns an `AbortController`, current route hash, terrain response, open preference, and view. `setPlan(plan)` immediately renders plan-only/loading state, posts route positions to `/api/v1/elevation/profile`, ignores aborted/older results, and renders retryable plan-only state on failure. `setTelemetry(sample)` rebuilds only live metrics/marker without refetching terrain.

- [ ] **Step 5: Connect import, restore, clear, telemetry, and resize events**

After cached-plan restore and successful import, call `controller.setPlan(plan)`. When clearing, call `controller.setPlan(undefined)`. Forward every `updateFlightDeckPosition` sample. On panel open/close, call `routeMap.resize()` after layout, then `fitRoute()` only when explicitly requested so the user's manual map position is preserved.

Switching to TAXI hides the panel; returning to MAP restores the session preference. On narrow screens the initial preference is closed.

- [ ] **Step 6: Run integration-oriented frontend checks**

Run:

```powershell
pnpm --dir src/TaxiNow.Web test -- src/flightPlanGround.test.ts src/verticalProfileController.test.ts
pnpm --dir src/TaxiNow.Web build
pnpm --dir src/TaxiNow.Web test
```

Expected: build and all frontend tests pass.

- [ ] **Step 7: Commit MAP integration**

```powershell
git add -- src/TaxiNow.Web/src/verticalProfileController.ts src/TaxiNow.Web/src/verticalProfileController.test.ts
git add -p -- src/TaxiNow.Web/src/flightDeck.ts src/TaxiNow.Web/src/flightPlanGround.ts src/TaxiNow.Web/src/flightPlanGround.test.ts
git commit -m "feat: add MAP vertical profile control"
```

---

### Task 7: End-to-end verification, visual QA, and preview packaging

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-12-map-vertical-profile-design.md` only if verified implementation details require factual correction
- Create: `design-qa.md`
- Generate: `artifacts/TaxiNow-FlightDeck-Preview-VerticalProfile-win-x64/`
- Generate: `artifacts/TaxiNow-FlightDeck-Preview-VerticalProfile-win-x64.zip`

**Interfaces:**
- Consumes: the completed tasks and supplied avionics screenshot.
- Produces: verified documentation, passing `design-qa.md`, running preview, and portable ZIP.

- [ ] **Step 1: Document the user-visible feature and attribution**

Add a concise README section explaining MAP → PROFILE, online-first/cached terrain, MSFS/X-Plane altitude support, Open-Meteo/Copernicus attribution, offline states, and the simulation-only limitation.

- [ ] **Step 2: Run the complete automated verification suite**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build.ps1 -Configuration Release -SkipWebInstall
```

Expected: TypeScript check, Vite production build, all Vitest tests, Python map-pipeline tests, .NET build, and all xUnit tests pass with zero errors.

- [ ] **Step 3: Run a real terrain acquisition through the preview API**

Start the Release app, import or restore a route, POST its coordinates to `/api/v1/elevation/profile`, and verify: HTTP 200, 2–600 samples, finite increasing distances, finite elevations, exact attribution, and a cache file in `elevation-profiles`. Repeat with the upstream endpoint intentionally unavailable and verify `cacheState` is `cachedOffline`.

- [ ] **Step 4: Verify simulator transport contracts**

Run the X-Plane loopback test and inspect the published output for `altitudeMslFeet` and `altitudeAglFeet`. Verify the packaged managed/native SimConnect assemblies load and export `SimConnect_Open`. If MSFS or X-Plane is running, perform a live smoke test; otherwise report live connection as unverified rather than claiming it passed.

- [ ] **Step 5: Perform browser interaction and responsive checks**

In the user's in-app browser, verify:

1. MAP shows PROFILE below TAXI and hides FROM/TO/Plan Taxi.
2. PROFILE opens/closes the panel and selected state.
3. TAXI hides PROFILE and shows FROM/TO/Plan Taxi.
4. Returning to MAP restores the panel preference.
5. Import/restore renders terrain and planned path; disconnected simulator hides only the aircraft marker.
6. Desktop and 620 px layouts remain usable and map controls are not covered.
7. Browser console contains no new errors.

- [ ] **Step 6: Run Product Design visual QA**

Use the `product-design:design-qa` skill. Capture the same expanded state as the supplied avionics reference, compare source and implementation together, fix all P0/P1/P2 issues, and write `design-qa.md` ending with exactly `final result: passed`. Remaining P3 polish may be listed as follow-up notes.

- [ ] **Step 7: Publish and launch the portable preview**

Restore `win-x64`, publish self-contained to `artifacts/TaxiNow-FlightDeck-Preview-VerticalProfile-win-x64`, verify these files exist, then create the ZIP:

```text
TaxiNow.App.exe
Microsoft.FlightSimulator.SimConnect.dll
SimConnect.dll
pipeline/taxinow-map-pipeline.exe
wwwroot/index.html
```

Stop only the old `TaxiNow.App` preview process, launch the new executable visibly, confirm `/api/v1/status` responds, and leave the in-app browser open on the running preview.

- [ ] **Step 8: Commit documentation and QA evidence**

```powershell
git add -- design-qa.md
git add -p -- README.md docs/superpowers/specs/2026-09-12-map-vertical-profile-design.md
git commit -m "docs: verify MAP vertical profile"
```
