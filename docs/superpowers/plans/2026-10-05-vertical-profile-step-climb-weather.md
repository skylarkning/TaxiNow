# Vertical Profile Step-Climb and Weather Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the MAP vertical profile into a zoomable step-climb planning display with adaptive waypoint labels, a downward aircraft marker, and a forecast-derived 500 NM radar-style cloud and precipitation cross-section.

**Architecture:** Add a server-owned weather profile pipeline that samples the route, aligns forecasts to ETA, derives cloud layers, enriches them with aviation reports, and returns cacheable display bands. Split the web profile into viewport, label-selection, weather-geometry, and renderer modules; the existing controller coordinates terrain and weather requests while the view owns input and presentation.

**Tech Stack:** .NET 10 / ASP.NET Core / `HttpClient` / `System.Text.Json` / xUnit; TypeScript 5.9 / Canvas 2D / Vite 8 / Vitest 4; existing Open-Meteo and AviationWeather.gov public APIs; no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-05-vertical-profile-step-climb-weather-design.md`

## Global Constraints

- Weather is forecast-derived and must always say `Forecast / estimated — not airborne radar` through localized copy.
- The default airborne window is current projected route distance through 500 NM ahead; preflight starts at origin; minimum visible range is 25 NM.
- A visible range of 120 NM or less makes every waypoint eligible; full-route view retains only endpoints, next waypoint, constraints, step points, TOC, and TOD.
- Step changes require at least 1,000 ft after at least 20 NM within a 500 ft altitude band.
- The aircraft marker is a larger downward-pointing triangle whose tip anchors the live distance and MSL altitude.
- Cloud threshold is 60 percent; displayed base and top are rounded to 1,000 ft; gaps over 50 NM or two forecast steps split bands.
- The planned-path relation uses a nominal plus/minus 4,000 ft vertical envelope; solid is on-path and striped is off-path.
- Weather horizon is at most 500 NM with at most 32 route samples; ordinary zoom and pan are client-only.
- Fresh weather cache target is 15 minutes; stale-success fallback is at most two hours; acquisition failures use a short negative cache.
- Keep the terrain/altitude profile operational when weather is partial, stale, or unavailable.
- First release excludes wind, icing, turbulence, manual radar controls, and real-radar claims.
- Keep the weather endpoint behind `TaxiNow:Features:VerticalWeatherProfileEnabled`, default `false`, until provider terms, attribution, cache behavior, and performance are accepted for release.

## Review Focus

- Dateline crossings, polar legs, duplicate coordinates, and zero-length legs must produce a bounded 500 NM window and monotonically increasing samples (Task 1 tests).
- Provider 204, 429, malformed JSON, oversized bodies, missing pressure levels, and cancellation must degrade to partial/stale data without retry storms (Tasks 2 and 4 tests).
- Dense short routes, long identifiers, narrow screens, and overlapping labels must retain all short-range waypoints without clipping or hiding critical points (Tasks 6 and 8 tests).
- Ground, disconnected, stale, negative-speed, and implausibly fast telemetry must choose the documented ETA fallback and never move the aircraft marker from invalid data (Tasks 1, 5, and 9 tests).
- Multiple cloud decks, single-level layers, unknown bases/tops, and conflicting model/report values must preserve confidence and avoid invented boundaries (Tasks 2 and 3 tests).

---

### Task 1: Weather profile contracts, route sampling, and ETA

**Files:**
- Create: `src/TaxiNow.Server/Weather/WeatherProfileContracts.cs`
- Create: `src/TaxiNow.Server/Weather/WeatherProfileDerivation.cs`
- Create: `tests/TaxiNow.Server.Tests/WeatherProfileDerivationTests.cs`

**Interfaces:**
- Produces: `WeatherProfileRequest`, `WeatherRoutePoint`, `TimedRouteSample`, `WeatherProfileResponse`, `WeatherBand`, `WeatherBandColumn`, `WeatherFeatureKind`, `WeatherIntensity`, `WeatherPathRelation`, `WeatherConfidence`, `WeatherValueKind`, and `WeatherSourceInfo`.
- Produces: `WeatherProfileDerivation.SampleRoute(WeatherProfileRequest request, DateTimeOffset now) -> WeatherRouteWindow` and `WeatherProfileDerivation.ClassifyPathRelation(double plannedAltitudeFeet, double? baseFeet, double? topFeet) -> WeatherPathRelation`.
- Consumes: no new project interfaces.

- [ ] **Step 1: Write failing route and ETA tests**

Add tests named `SampleRoute_LimitsTheWindowToFiveHundredNmAndThirtyTwoSamples`, `SampleRoute_StartsAtCurrentDistanceAndIncludesCriticalAltitudePoints`, `SampleRoute_UsesScheduledAverageThenLiveSpeedThenFourHundredFiftyKnots`, and `SampleRoute_NormalizesDatelineDuplicateAndZeroLengthLegs`. Assert a 25 NM nominal spacing, monotonic distances, exact endpoints, maximum 32 samples, and ETA basis values `scheduled`, `liveGroundSpeed`, and `fallback450Kt`. Include negative, zero, and greater-than-750 kt live speeds and verify they use the fallback.

- [ ] **Step 2: Run the focused tests and verify red**

Run: `dotnet test tests/TaxiNow.Server.Tests/TaxiNow.Server.Tests.csproj --filter WeatherProfileDerivation`

Expected: FAIL because the Weather namespace and derivation types do not exist.

- [ ] **Step 3: Define the wire contracts and derivation signatures**

Use these request fields:

```csharp
public sealed record WeatherProfileRequest(
    IReadOnlyList<WeatherRoutePoint> Route,
    double? CurrentDistanceNm,
    double? GroundSpeedKnots,
    DateTimeOffset? DepartureTimeUtc,
    double? EstimatedEnrouteSeconds);

public sealed record WeatherRoutePoint(
    string? Ident,
    double Longitude,
    double Latitude,
    double? PlannedAltitudeFeet,
    bool Critical);
```

Validate 2–200 route points, finite WGS84 coordinates, maximum 10,000 NM, finite optional altitudes from -2,000 through 100,000 ft, and a serialized body no larger than 256 KiB. Keep enums string-serializable through the host's existing JSON options.

- [ ] **Step 4: Implement sampling, interpolation, ETA, and path relation**

Interpolate along great-circle legs, include window endpoints and critical points, then reduce only non-critical samples when the result exceeds 32. Scheduled ETA requires both valid departure time and positive ETE; live speed is accepted only from 50 through 750 kt; otherwise use 450 kt. `OnPath` means the layer intersects planned altitude ±4,000 ft; null bounds return `Unknown` rather than inventing a relation.

- [ ] **Step 5: Run the derivation tests and verify green**

Run: `dotnet test tests/TaxiNow.Server.Tests/TaxiNow.Server.Tests.csproj --filter WeatherProfileDerivation`

Expected: PASS with zero failures.

- [ ] **Step 6: Commit the task**

```powershell
git add src/TaxiNow.Server/Weather/WeatherProfileContracts.cs src/TaxiNow.Server/Weather/WeatherProfileDerivation.cs tests/TaxiNow.Server.Tests/WeatherProfileDerivationTests.cs
git commit -m "feat: derive timed weather profile route samples"
```

### Task 2: Open-Meteo pressure-level forecast and cloud-band derivation

**Files:**
- Create: `src/TaxiNow.Server/Weather/OpenMeteoWeatherProvider.cs`
- Create: `src/TaxiNow.Server/Weather/WeatherBandBuilder.cs`
- Create: `tests/TaxiNow.Server.Tests/OpenMeteoWeatherProviderTests.cs`
- Create: `tests/TaxiNow.Server.Tests/WeatherBandBuilderTests.cs`

**Interfaces:**
- Consumes: `WeatherRouteWindow` and `TimedRouteSample` from Task 1.
- Produces: `IWeatherForecastProvider.GetAsync(WeatherRouteWindow window, CancellationToken token) -> Task<ForecastProfileData>`.
- Produces: `WeatherBandBuilder.Build(ForecastProfileData forecast, WeatherRouteWindow window) -> IReadOnlyList<WeatherBand>`.

- [ ] **Step 1: Write failing provider parsing tests**

Cover batched multi-location responses at forecast hours bracketing each ETA; pressure-level `cloud_cover_*hPa` plus `geopotential_height_*hPa`; precipitation, showers, weather code, and CAPE when present. Assert 204 returns an empty successful result, cancellation propagates, response bodies above 2 MiB fail acquisition, and malformed or misaligned arrays do not create fabricated samples.

- [ ] **Step 2: Write failing band-building tests**

Add tests for: 59 percent excluded and 60 percent included; interpolated threshold crossing; two separate cloud decks; a single-level low-confidence deck; unknown base/top retained as null; gaps over 50 NM split bands; weak/moderate/strong normalization; ±4,000 ft on-path relation; and model values retained before later aviation-report adjustment.

- [ ] **Step 3: Run both suites and verify red**

Run: `dotnet test tests/TaxiNow.Server.Tests/TaxiNow.Server.Tests.csproj --filter "OpenMeteoWeatherProvider|WeatherBandBuilder"`

Expected: FAIL because both implementations are missing.

- [ ] **Step 4: Implement the provider without new dependencies**

Use `https://api.open-meteo.com/v1/forecast` by default, configurable as `TaxiNow:Weather:ForecastBaseUrl`. Request only the Task 1 coordinates and necessary hourly variables. Use `HttpCompletionOption.ResponseHeadersRead`, a 15-second timeout, bounded JSON reading, invariant query formatting, the existing TaxiNow user agent convention, and no automatic redirects.

- [ ] **Step 5: Implement deterministic band derivation**

Convert pressure levels with geopotential height, find and interpolate 60-percent crossings, round only presentation values (not stored raw values), and emit stable band IDs from feature kind plus source sample indices. Normalize provider precipitation into `Weak`, `Moderate`, or `Strong` in one adapter function so thresholds are not embedded in Canvas code.

- [ ] **Step 6: Run focused tests and verify green**

Run: `dotnet test tests/TaxiNow.Server.Tests/TaxiNow.Server.Tests.csproj --filter "OpenMeteoWeatherProvider|WeatherBandBuilder"`

Expected: PASS with zero failures.

- [ ] **Step 7: Commit the task**

```powershell
git add src/TaxiNow.Server/Weather/OpenMeteoWeatherProvider.cs src/TaxiNow.Server/Weather/WeatherBandBuilder.cs tests/TaxiNow.Server.Tests/OpenMeteoWeatherProviderTests.cs tests/TaxiNow.Server.Tests/WeatherBandBuilderTests.cs
git commit -m "feat: derive forecast cloud and precipitation bands"
```

### Task 3: METAR, TAF, and SIGMET enrichment

**Files:**
- Create: `src/TaxiNow.Server/Weather/AviationWeatherProvider.cs`
- Create: `src/TaxiNow.Server/Weather/AviationWeatherEnrichment.cs`
- Create: `tests/TaxiNow.Server.Tests/AviationWeatherProviderTests.cs`
- Create: `tests/TaxiNow.Server.Tests/AviationWeatherEnrichmentTests.cs`

**Interfaces:**
- Consumes: `WeatherRouteWindow`, forecast `WeatherBand` values, and route-point identifiers supplied by the request.
- Produces: `IAviationWeatherProvider.GetAsync(WeatherRouteWindow window, CancellationToken token) -> Task<AviationWeatherData>`.
- Produces: `AviationWeatherEnrichment.Apply(IReadOnlyList<WeatherBand> forecast, AviationWeatherData reports, WeatherRouteWindow window) -> WeatherEnrichmentResult`.

- [ ] **Step 1: Write failing API and parser tests**

Embed minimized recorded JSON payloads as string constants in the test class for worldwide METAR, TAF, domestic `airsigmet`, and international `isigmet` responses. Assert station cloud bases, report validity windows, SIGMET polygons, explicit bases/tops, source time, and 204 behavior. Assert 429, malformed JSON, timeout, and cancellation remain distinguishable acquisition outcomes.

- [ ] **Step 2: Write failing enrichment tests**

Assert METAR changes a model cloud base only near its airport and observation time; TAF changes it only within the selected forecast period; a valid intersecting SIGMET explicit top overrides the model top; conflicting or expired reports leave the model untouched and add warnings; unknown reported bounds remain unknown; and every adjusted band retains original value, adjusted value, source, confidence, and `observed`/`forecast`/`estimated` classification.

- [ ] **Step 3: Run focused tests and verify red**

Run: `dotnet test tests/TaxiNow.Server.Tests/TaxiNow.Server.Tests.csproj --filter "AviationWeatherProvider|AviationWeatherEnrichment"`

Expected: FAIL because the provider and enrichment types do not exist.

- [ ] **Step 4: Implement bounded AviationWeather.gov access**

Use the documented `/api/data/metar`, `/api/data/taf`, `/api/data/airsigmet`, and `/api/data/isigmet` endpoints with `format=json`, exact documented parameters, scoped station IDs, a custom user agent, a 15-second timeout, bounded responses, and server-side access because the API does not permit CORS. Treat 204 as valid no-data and never retry 429 inside the same request.

- [ ] **Step 5: Implement conservative enrichment**

Only origin, destination, and route points with airport identifiers are METAR/TAF candidates. Geometry intersection and validity periods gate SIGMET application. Never infer cloud top from METAR/TAF. Return partial enrichment and warnings when any report family fails.

- [ ] **Step 6: Run focused tests and verify green**

Run: `dotnet test tests/TaxiNow.Server.Tests/TaxiNow.Server.Tests.csproj --filter "AviationWeatherProvider|AviationWeatherEnrichment"`

Expected: PASS with zero failures.

- [ ] **Step 7: Commit the task**

```powershell
git add src/TaxiNow.Server/Weather/AviationWeatherProvider.cs src/TaxiNow.Server/Weather/AviationWeatherEnrichment.cs tests/TaxiNow.Server.Tests/AviationWeatherProviderTests.cs tests/TaxiNow.Server.Tests/AviationWeatherEnrichmentTests.cs
git commit -m "feat: enrich weather profiles with aviation reports"
```

### Task 4: Weather cache, orchestration service, endpoint, and host wiring

**Files:**
- Create: `src/TaxiNow.Server/Weather/WeatherProfileService.cs`
- Create: `src/TaxiNow.Server/Weather/WeatherProfileEndpoints.cs`
- Create: `tests/TaxiNow.Server.Tests/WeatherProfileServiceTests.cs`
- Modify: `src/TaxiNow.Server/TaxiNowHost.cs`
- Modify: `src/TaxiNow.Storage/StoragePaths.cs`
- Modify: `tests/TaxiNow.Storage.Tests/StorageTests.cs`
- Modify: `tests/TaxiNow.Storage.Tests/StoragePathsTests.cs`
- Modify: `tests/TaxiNow.Server.Tests/ServerContractTests.cs`

**Interfaces:**
- Consumes: all server interfaces from Tasks 1–3.
- Produces: `WeatherProfileService.GetAsync(WeatherProfileRequest request, CancellationToken token) -> Task<WeatherProfileResponse>`.
- Produces: `POST /api/v1/weather/profile` with 400 validation, 200 partial/full success, and 502 only when no fresh or cached weather exists.
- Produces: `StoragePaths.WeatherProfilesPath`.

- [ ] **Step 1: Write failing storage and contract tests**

Assert `weather-profiles` is created under the storage root, accepted by ownership validation, and exposed as `StoragePaths.WeatherProfilesPath`. Add JSON contract assertions for camel-case enum values, nullable base/top fields, `distanceNm`, source attribution, warnings, and `TaxiNowHost.WeatherProfilePath`. Verify the endpoint is absent when `TaxiNow:Features:VerticalWeatherProfileEnabled` is false or omitted and is mapped when explicitly true.

- [ ] **Step 2: Write failing orchestration and cache tests**

Test fresh cache within 15 minutes, stale cache returned after provider failure through two hours, stale cache rejected after two hours, a two-minute negative cache after total acquisition failure, no negative cache for cancellation, single-flight behavior for identical keys, partial forecast-only success, partial report-only success, and atomic cache replacement.

- [ ] **Step 3: Run focused server and storage tests and verify red**

Run: `dotnet test tests/TaxiNow.Storage.Tests/TaxiNow.Storage.Tests.csproj --filter Weather; dotnet test tests/TaxiNow.Server.Tests/TaxiNow.Server.Tests.csproj --filter "WeatherProfile|ServerContract"`

Expected: FAIL because storage, service, and endpoint wiring are absent.

- [ ] **Step 4: Implement storage and service orchestration**

Cache identity includes schema version, rounded route samples, forecast hours, planned altitudes, and provider configuration. Preserve attribution and value-kind metadata. Use a per-key in-flight request map rather than one global lock so unrelated routes can load concurrently. Cache write failures are best-effort after successful acquisition.

- [ ] **Step 5: Register named clients and map the endpoint**

Add named forecast and aviation clients in `TaxiNowHost.Build`, both with redirects disabled and TaxiNow user agent. Register providers and service as singletons, expose `WeatherProfilePath`, and conditionally call `app.MapWeatherProfile()` beside elevation mapping only when `TaxiNow:Features:VerticalWeatherProfileEnabled` is true.

- [ ] **Step 6: Run focused tests and verify green**

Run: `dotnet test tests/TaxiNow.Storage.Tests/TaxiNow.Storage.Tests.csproj --filter Weather; dotnet test tests/TaxiNow.Server.Tests/TaxiNow.Server.Tests.csproj --filter "WeatherProfile|ServerContract"`

Expected: PASS with zero failures.

- [ ] **Step 7: Commit the task**

```powershell
git add src/TaxiNow.Server/Weather src/TaxiNow.Server/TaxiNowHost.cs src/TaxiNow.Storage/StoragePaths.cs tests/TaxiNow.Storage.Tests tests/TaxiNow.Server.Tests
git commit -m "feat: expose cached route weather profiles"
```

### Task 5: Flight-plan timing, web weather contracts, and profile model

**Files:**
- Modify: `src/TaxiNow.Web/src/simBriefClient.ts`
- Modify: `src/TaxiNow.Web/src/flightPlan.ts`
- Modify: `src/TaxiNow.Web/src/flightPlan.test.ts`
- Modify: `src/TaxiNow.Web/src/contracts.ts`
- Modify: `src/TaxiNow.Web/src/verticalProfile.ts`
- Modify: `src/TaxiNow.Web/src/verticalProfile.test.ts`

**Interfaces:**
- Consumes: Task 4 response JSON.
- Produces: optional `FlightPlan.departureTimeUtc` and `FlightPlan.estimatedEnrouteSeconds` from valid SimBrief `times.sched_out` and `times.est_time_enroute` values.
- Produces: TypeScript `WeatherProfileResponse` matching Task 4.
- Produces: `BuildVerticalProfileInput.weatherProfile?: WeatherProfileResponse` and model fields `weatherBands`, `weatherWarnings`, and `weatherSourceSummary`.

- [ ] **Step 1: Write failing parsing and contract-model tests**

Assert valid epoch/string SimBrief timing is normalized, invalid or absent timing is omitted, existing saved plans remain compatible, nullable cloud bounds survive parsing, weather bands are sorted and clipped to total route distance, and stale/estimated/source warnings enter the accessibility summary. Include stale or invalid telemetry and confirm the model omits the aircraft.

- [ ] **Step 2: Run focused web tests and verify red**

Run: `pnpm --dir src/TaxiNow.Web test -- src/flightPlan.test.ts src/verticalProfile.test.ts`

Expected: FAIL because timing and weather model fields are missing.

- [ ] **Step 3: Extend the SimBrief fetch and plan parser**

Add `times` to the allowlisted SimBrief fields. Parse only finite positive ETE values and valid UTC departure timestamps; do not make them required for old saved plans.

- [ ] **Step 4: Add exact web contracts and integrate the model**

Mirror Task 4 enum strings as TypeScript unions. Keep terrain `source` fields unchanged and add weather source fields separately so weather failure cannot make terrain appear unavailable.

- [ ] **Step 5: Run focused tests and verify green**

Run: `pnpm --dir src/TaxiNow.Web test -- src/flightPlan.test.ts src/verticalProfile.test.ts`

Expected: PASS with zero failures.

- [ ] **Step 6: Commit the task**

```powershell
git add src/TaxiNow.Web/src/simBriefClient.ts src/TaxiNow.Web/src/flightPlan.ts src/TaxiNow.Web/src/flightPlan.test.ts src/TaxiNow.Web/src/contracts.ts src/TaxiNow.Web/src/verticalProfile.ts src/TaxiNow.Web/src/verticalProfile.test.ts
git commit -m "feat: model timed vertical profile weather"
```

### Task 6: Viewport transforms and adaptive waypoint selection

**Files:**
- Create: `src/TaxiNow.Web/src/verticalProfileViewport.ts`
- Create: `src/TaxiNow.Web/src/verticalProfileViewport.test.ts`
- Create: `src/TaxiNow.Web/src/verticalProfileLabels.ts`
- Create: `src/TaxiNow.Web/src/verticalProfileLabels.test.ts`

**Interfaces:**
- Produces: `createProfileViewport(totalDistanceNm: number, aircraftDistanceNm?: number) -> ProfileViewport`.
- Produces: `zoomProfileViewport(viewport, factor, anchorDistanceNm)`, `panProfileViewport(viewport, deltaNm)`, `resetProfileViewport(...)`, `distanceToProfileX(...)`, and `profileXToDistance(...)`.
- Produces: `classifyVerticalProfilePoints(model: VerticalProfileModel) -> ProfileLabelCandidate[]` and `layoutVerticalProfileLabels(candidates, viewport, width, measureText) -> ProfileLabelPlacement[]`.

- [ ] **Step 1: Write failing viewport tests**

Assert default airborne `[aircraft, min(aircraft + 500, destination)]`, preflight `[0, min(500, destination)]`, 25 NM minimum, full-route maximum, pointer-centered zoom, clamped pan, reset behavior, reversible transforms, zero-distance safety, and finite output for dateline-derived route distances.

- [ ] **Step 2: Write failing classification and layout tests**

Assert every waypoint is returned for a 120 NM view using no more than three stagger rows; at longer range ordinary points drop before critical ones; full route retains endpoints, next waypoint, constraints, step points, TOC, and TOD; exact 1,000/20/500 thresholds; long labels remain inside the plot; and a 320 px plot never clips critical labels.

- [ ] **Step 3: Run focused tests and verify red**

Run: `pnpm --dir src/TaxiNow.Web test -- src/verticalProfileViewport.test.ts src/verticalProfileLabels.test.ts`

Expected: FAIL because the new modules do not exist.

- [ ] **Step 4: Implement immutable viewport helpers**

Use route-distance units in state and derive pixels only at render time. Keep all functions pure so wheel, keyboard, drag, resize, and tests share one transform.

- [ ] **Step 5: Implement priority classification and label placement**

Represent priority as an enum or numeric rank in one module. For short views, keep all candidates and choose one of three rows by first-fit interval placement; for longer views, place high-priority candidates first and skip colliding lower-priority candidates.

- [ ] **Step 6: Run focused tests and verify green**

Run: `pnpm --dir src/TaxiNow.Web test -- src/verticalProfileViewport.test.ts src/verticalProfileLabels.test.ts`

Expected: PASS with zero failures.

- [ ] **Step 7: Commit the task**

```powershell
git add src/TaxiNow.Web/src/verticalProfileViewport.ts src/TaxiNow.Web/src/verticalProfileViewport.test.ts src/TaxiNow.Web/src/verticalProfileLabels.ts src/TaxiNow.Web/src/verticalProfileLabels.test.ts
git commit -m "feat: add profile viewport and adaptive waypoint labels"
```

### Task 7: Weather geometry and layered Canvas renderer

**Files:**
- Create: `src/TaxiNow.Web/src/verticalProfileWeather.ts`
- Create: `src/TaxiNow.Web/src/verticalProfileWeather.test.ts`
- Create: `src/TaxiNow.Web/src/verticalProfileRenderer.ts`
- Create: `src/TaxiNow.Web/src/verticalProfileRenderer.test.ts`
- Modify: `src/TaxiNow.Web/src/verticalProfileView.ts`
- Modify: `src/TaxiNow.Web/src/verticalProfileView.test.ts`

**Interfaces:**
- Consumes: model types from Task 5 and viewport/labels from Task 6.
- Produces: `buildWeatherPolygons(bands, viewport) -> WeatherPolygon[]` preserving null bounds and splitting gaps.
- Produces: `drawVerticalProfile(context, model, viewport, bounds, palette, labels) -> void`.
- Produces: `aircraftTriangle(distanceX: number, altitudeY: number, size: number) -> [Point, Point, Point]` with the first point as the downward anchor tip.

- [ ] **Step 1: Write failing weather-geometry tests**

Assert contiguous columns merge, gaps over 50 NM split, viewport clipping does not bridge missing data, multiple decks remain separate, null base/top produce open/unknown annotations rather than zero-height polygons, and on-path/off-path/value-kind metadata survives.

- [ ] **Step 2: Write failing renderer operation tests**

Using the existing Canvas proxy pattern, assert layer order is background → sparse horizontal references → terrain → striped off-path weather → solid on-path weather → route → constraints → labels → aircraft. Assert there are no full-height vertical grid strokes, intensity uses distinct palette entries, off-path invokes a stripe pattern, and the triangle tip has greater Y than both base corners and is anchored at the live point.

- [ ] **Step 3: Run focused tests and verify red**

Run: `pnpm --dir src/TaxiNow.Web test -- src/verticalProfileWeather.test.ts src/verticalProfileRenderer.test.ts src/verticalProfileView.test.ts`

Expected: FAIL because geometry and renderer modules are missing and the view still owns drawing.

- [ ] **Step 4: Implement weather geometry and the renderer split**

Move plot-only code out of `verticalProfileView.ts`. Use Canvas patterns for stripes, organic but deterministic curves between band columns, no animation on initial paint, and no color-only meaning. Keep terrain and route drawing compatible with missing weather.

- [ ] **Step 5: Rewire view rendering without adding input behavior yet**

The view creates palette, bounds, labels, and viewport, then calls the renderer. Preserve device-pixel-ratio scaling, unchanged redraw suppression, focus tooltip behavior, theme observation, and no-Canvas fallback.

- [ ] **Step 6: Run focused tests and verify green**

Run: `pnpm --dir src/TaxiNow.Web test -- src/verticalProfileWeather.test.ts src/verticalProfileRenderer.test.ts src/verticalProfileView.test.ts`

Expected: PASS with zero failures.

- [ ] **Step 7: Commit the task**

```powershell
git add src/TaxiNow.Web/src/verticalProfileWeather.ts src/TaxiNow.Web/src/verticalProfileWeather.test.ts src/TaxiNow.Web/src/verticalProfileRenderer.ts src/TaxiNow.Web/src/verticalProfileRenderer.test.ts src/TaxiNow.Web/src/verticalProfileView.ts src/TaxiNow.Web/src/verticalProfileView.test.ts
git commit -m "feat: render radar-style vertical weather profile"
```

### Task 8: Zoom, pan, inspection, responsive labels, and profile controls

**Files:**
- Modify: `src/TaxiNow.Web/src/verticalProfileView.ts`
- Modify: `src/TaxiNow.Web/src/verticalProfileView.test.ts`
- Modify: `src/TaxiNow.Web/src/flightDeck.css`

**Interfaces:**
- Consumes: viewport and renderer interfaces from Tasks 6–7.
- Produces: wheel/trackpad zoom, drag pan, `+`, `−`, and reset controls, keyboard zoom/pan, and viewport-aware inspection.
- Preserves: `VerticalProfileView.render`, `setOpen`, `resize`, and `destroy` public interface.

- [ ] **Step 1: Write failing interaction tests**

Extend the browser fixture with wheel and pointer coordinates. Assert wheel zoom is pointer-centered, drag clamps at route bounds, `+`/`−` and reset use the same transforms, `ArrowLeft`/`ArrowRight` still inspect samples, keyboard zoom/pan works, resize retains route-distance viewport, and reduced-motion preference skips interpolation.

- [ ] **Step 2: Write failing responsive-label tests**

Render dense 80 NM and full-route fixtures at 1,000 px, 620 px, and 320 px. Assert all short-range identifiers appear, critical full-route identifiers remain, ordinary full-route identifiers do not, and labels stay within the plot bounds across three rows.

- [ ] **Step 3: Run view tests and verify red**

Run: `pnpm --dir src/TaxiNow.Web test -- src/verticalProfileView.test.ts`

Expected: FAIL because controls and input handlers are not implemented.

- [ ] **Step 4: Implement controls and event lifecycle**

Add visible compact zoom-out, reset, and zoom-in controls within the profile plot. Use pointer capture for drag, prevent wheel page scrolling only over the plot, schedule redraw through one animation frame, and remove all new listeners/observers/animation frames in `destroy()`.

- [ ] **Step 5: Update focused CSS**

Style controls and radar legend within existing `#fd-vertical-profile` tokens. Preserve dark plot colors in a light shell, mobile wrapping, visible focus, 44 px coarse-pointer targets, and no dense background grid.

- [ ] **Step 6: Run view tests and web build**

Run: `pnpm --dir src/TaxiNow.Web test -- src/verticalProfileView.test.ts; pnpm --dir src/TaxiNow.Web build`

Expected: all selected tests PASS and the TypeScript/Vite build exits 0.

- [ ] **Step 7: Commit the task**

```powershell
git add src/TaxiNow.Web/src/verticalProfileView.ts src/TaxiNow.Web/src/verticalProfileView.test.ts src/TaxiNow.Web/src/flightDeck.css
git commit -m "feat: add interactive profile zoom and pan"
```

### Task 9: Controller loading, localization, accessibility, documentation, and full verification

**Files:**
- Modify: `src/TaxiNow.Web/src/verticalProfileController.ts`
- Modify: `src/TaxiNow.Web/src/verticalProfileController.test.ts`
- Modify: `src/TaxiNow.Web/src/localization.flightdeck.ts`
- Modify: `src/TaxiNow.Web/src/localization.test.ts`
- Modify: `README.md`
- Modify: `NOTICE`

**Interfaces:**
- Consumes: `POST /api/v1/weather/profile` from Task 4 and model/view contracts from Tasks 5–8.
- Produces: independent terrain and weather request generations, weather cache reuse, retry behavior, localized forecast disclaimer/legend/status, and complete accessible summaries.

- [ ] **Step 1: Write failing controller tests**

Assert terrain and weather load independently; the weather body contains planned altitudes, critical flags, current route distance, valid live speed, and optional plan timing; opening the panel triggers deferred weather load; closing or replacing the route aborts superseded weather; stale responses cannot resurrect old data; weather failure retains terrain and plan; a 404 feature-disabled response suppresses repeat requests for the session; retry requests only missing data; and identical route/time buckets reuse weather.

- [ ] **Step 2: Write failing localization and accessibility tests**

Add keys for forecast disclaimer, stale/partial/unavailable weather, cloud base/top, weak/moderate/strong return, on-path/off-path, zoom/reset, ETA basis, and unknown boundary in every supported locale. Assert the accessible summary includes nearest waypoint, valid time, confidence, base/top when known, and explicit unknown wording otherwise.

- [ ] **Step 3: Run focused tests and verify red**

Run: `pnpm --dir src/TaxiNow.Web test -- src/verticalProfileController.test.ts src/verticalProfileView.test.ts src/localization.test.ts`

Expected: FAIL because weather orchestration and copy are missing.

- [ ] **Step 4: Implement independent controller request state**

Keep separate abort controllers, route/time cache keys, and status fields for terrain and weather. Send the server no more than 200 route points. Recompute weather only when route identity changes, ETA crosses a five-minute bucket, the requested interval leaves cache coverage, or the user explicitly retries missing/stale data.

- [ ] **Step 5: Add localized copy and operational documentation**

Update every locale in `localization.flightdeck.ts`. Document the feature flag, data sources, 15-minute fresh/two-hour stale behavior, endpoint configuration, attribution, forecast-only limitations, and the non-airborne-radar disclaimer. Add Open-Meteo and AviationWeather.gov attribution to the existing notice file without changing the project license.

- [ ] **Step 6: Run all web tests and build**

Run: `pnpm --dir src/TaxiNow.Web test; pnpm --dir src/TaxiNow.Web build`

Expected: all tests PASS and build exits 0.

- [ ] **Step 7: Run all server and storage tests**

Run: `dotnet test tests/TaxiNow.Storage.Tests/TaxiNow.Storage.Tests.csproj; dotnet test tests/TaxiNow.Server.Tests/TaxiNow.Server.Tests.csproj`

Expected: all tests PASS with zero failures.

- [ ] **Step 8: Run repository-level build verification**

Run: `dotnet build TaxiNow.sln --no-restore`

Expected: build exits 0. If restore inputs changed unexpectedly, run `dotnet build TaxiNow.sln` and record why restore was required.

- [ ] **Step 9: Perform manual acceptance checks**

Use replay telemetry and fixtures to inspect: disabled and enabled feature-flag states; an 80 NM route with every waypoint; a long-haul route with multiple step climbs; the aircraft triangle tip at live distance/altitude; a 500 NM forecast view with all three intensities; missing, partial, and stale weather; desktop/mobile widths; and light/dark shells. Confirm no screen describes the overlay as live airborne radar, and record provider terms/attribution approval before changing the release default.

- [ ] **Step 10: Commit the integration**

```powershell
git add src/TaxiNow.Web/src/verticalProfileController.ts src/TaxiNow.Web/src/verticalProfileController.test.ts src/TaxiNow.Web/src/localization.flightdeck.ts src/TaxiNow.Web/src/localization.test.ts README.md NOTICE
git commit -m "feat: integrate forecast weather vertical profile"
```

- [ ] **Step 11: Request whole-branch review**

Review the entire branch against the spec, especially provider failure semantics, cache bounds, forecast wording, Canvas layer order, label density, accessibility, and cleanup of aborted requests. Fix findings through focused red/green test cycles, rerun Steps 6–8, and commit each fix separately.
