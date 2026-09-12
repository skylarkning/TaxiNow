# MAP Vertical Situation Profile Design

## Goal

Add a complete vertical situation display to TaxiNow's MAP view. The feature
helps a simulator pilot understand planned altitude, altitude restrictions,
terrain, airport elevation, and the aircraft's live vertical position along the
active SimBrief route. It remains explicitly for flight-simulation use and is
not certified terrain-avoidance or real-world navigation equipment.

## Approved Interaction

- MAP and TAXI remain the two primary left-rail views.
- While MAP is active, a new `PROFILE` (`垂直`) control appears immediately
  below TAXI. FROM, TO, and Plan Taxi remain hidden.
- While TAXI is active, PROFILE is hidden and the existing FROM, TO, and Plan
  Taxi controls appear.
- Clicking PROFILE toggles a bottom-docked profile panel. Its selected state is
  visually highlighted in the existing blue rail style.
- The panel occupies approximately 28 percent of the usable MAP height and
  causes the map to resize rather than covering the route. When closed, it is
  completely absent and PROFILE is the only remaining control for reopening it.
- The open/closed preference is retained for the browser session. Switching to
  TAXI closes the visible panel without discarding the preference; returning to
  MAP restores it.
- On narrow screens the panel starts collapsed and expands to a larger,
  touch-friendly bottom sheet.

## Visual Content

The panel follows the supplied avionics reference while retaining TaxiNow's
existing dark-blue visual language:

- horizontal axis: cumulative route distance with selected waypoint labels;
- vertical axis: feet MSL with automatically chosen tick intervals;
- filled terrain silhouette using green, amber, and red advisory bands;
- planned vertical path for climb, cruise, step climbs, and descent;
- waypoint restriction markers for at, at-or-above, at-or-below, and window
  constraints;
- origin and destination elevation markers;
- live aircraft marker projected onto the route, with current MSL altitude and
  AGL when telemetry is available;
- compact header values for current altitude, terrain clearance, next altitude
  constraint, and distance to destination;
- an attribution line for Open-Meteo and Copernicus DEM.

The plot is implemented as a dedicated accessible canvas component with a text
summary for screen readers. It does not introduce decorative image assets or a
second visual design system.

## Flight Plan Model

`FlightPoint` gains normalized optional vertical fields:

- `plannedAltitudeFeet`;
- `constraintKind`: none, at, at-or-above, at-or-below, or between;
- `minimumAltitudeFeet` and `maximumAltitudeFeet`.

The SimBrief parser accepts numeric strings or numbers, rejects non-finite and
out-of-range values, and reads altitude/elevation fields when present. Airport
elevation is read from the plan when available and otherwise comes from the
terrain sample at the airport coordinate. If individual planned altitudes are
missing, the display creates an explicitly labelled estimated path from airport
elevations and the plan's initial cruise altitude; it never presents an
estimated value as a published restriction.

## Simulator Telemetry

`TelemetrySnapshot` gains optional `altitudeMslFeet` and `altitudeAglFeet`.
Existing consumers remain source-compatible because the new values are optional
and appended to the record/JSON contract.

- MSFS 2020/2024 reads `PLANE ALTITUDE` and `PLANE ALT ABOVE GROUND` in feet
  through the existing SimConnect definition.
- X-Plane 12 subscribes to `sim/flightmodel/position/elevation` and
  `sim/flightmodel/position/y_agl`, converting metres to feet.
- Replay accepts optional altitude fields while old replay fixtures continue to
  work.
- Change detection includes a small altitude threshold so a stationary aircraft
  climbing or descending still updates the profile.

The frontend projects the live latitude/longitude onto the nearest route leg to
obtain cumulative along-route distance. A stale, disconnected, or invalid
sample hides the aircraft marker without hiding the plan or terrain.

## Terrain Service And Cache

The server exposes a bounded local endpoint that receives a normalized route and
returns sampled elevations. The server, rather than the browser, calls the
Open-Meteo Elevation API.

`POST /api/v1/elevation/profile` accepts route coordinates only; it does not
accept an upstream URL. The response contains cumulative distance, elevation in
feet, source metadata, cache state, and attribution.

- Densify the route adaptively, normally every 2 nautical miles, with a hard
  limit of 600 samples.
- Send Open-Meteo requests in batches of at most 100 coordinates.
- Validate coordinate count/range, response length, finite elevations, response
  size, redirects, and timeouts.
- Convert the returned 90-metre DEM elevations from metres to feet.
- Cache successful profiles under TaxiNow storage using a versioned hash of
  rounded route coordinates. Cache entries include source, resolution,
  generated time, and attribution.
- A cache entry is fresh for 30 days. A stale entry is accepted when the network
  is unavailable and is marked `cached/offline` in the UI.
- If no cache exists and acquisition fails, the plan remains visible, terrain is
  replaced by an unavailable state, and retry is offered without blocking MAP.
- In-flight refreshes never re-download unchanged terrain.

Open-Meteo documents a 90-metre elevation model, accepts at most 100 coordinates
per request, and requires attribution to Open-Meteo and Copernicus. Commercial
distribution must use an appropriately licensed endpoint/API key or a
self-hosted compatible service; the endpoint is configurable rather than baked
into rendering code.

## Advisory Colour Rules

Colours are advisory and intentionally conservative:

- normal terrain: green/blue-grey according to the active theme;
- amber: terrain is within 2,000 feet of the displayed aircraft or planned path;
- red: terrain is within 1,000 feet or above it.

On-ground and invalid-altitude samples do not generate clearance warnings. The
UI always labels these bands as simulation advisories rather than TAWS alerts.

## Components And Boundaries

- `verticalProfile.ts`: pure route sampling, distance projection, altitude-path
  normalization, clearance bands, and display-model construction.
- `verticalProfileView.ts`: panel lifecycle, responsive canvas rendering,
  pointer/keyboard inspection, and accessible text summary.
- `flightDeck.ts`: creates the MAP-only PROFILE rail control and connects plan,
  telemetry, and panel state.
- `ElevationProfileService` and endpoint: validates, fetches, batches, caches,
  and returns terrain data.
- existing telemetry sources: add only altitude acquisition and conversion.

This keeps route mathematics, UI rendering, remote acquisition, and simulator
transport independently testable.

## States And Error Handling

- No plan: panel explains that a SimBrief plan must be imported.
- Plan parsing: show plan path immediately and terrain loading progress.
- Terrain ready: render and cache the complete profile.
- Offline with cache: render cached data with a small offline badge.
- Offline without cache: render plan-only mode and a Retry action.
- Simulator disconnected: hide live marker and show `ALT —`; retain terrain and
  plan.
- Missing restrictions: omit restriction symbols instead of inventing them.
- Superseded plan/import: cancel or ignore the older terrain request so it cannot
  replace the current route.

## Testing And Verification

- Parser tests for SimBrief altitude strings, constraints, invalid values, and
  missing fields.
- Pure frontend tests for route densification, cumulative distance, nearest-leg
  projection, estimated plan paths, terrain bands, and stale telemetry.
- Rail-state tests proving PROFILE appears only in MAP while FROM/TO appear only
  in TAXI.
- Server tests for validation, 100-coordinate batching, cache hit, offline stale
  fallback, timeout, malformed upstream data, and attribution metadata.
- MSFS definition/contract tests for MSL and AGL altitude.
- X-Plane loopback RREF test including elevation and AGL conversion.
- Replay and telemetry serialization compatibility tests.
- Browser verification at desktop and narrow widths: toggle PROFILE, switch
  MAP/TAXI, import a plan, inspect waypoint constraints, and simulate live-marker
  movement.
- Visual QA compares the expanded profile against the supplied avionics
  reference while preserving TaxiNow spacing, colour, and typography.

## Out Of Scope

- Certified TAWS/EGPWS behaviour or real-world safety claims;
- editing the SimBrief route or altitude constraints from the profile;
- worldwide terrain bundled into the installer;
- weather, winds-aloft, VNAV speed prediction, or aircraft-performance-based
  climb/descent calculations in this iteration.

## Source References

- Open-Meteo Elevation API: https://open-meteo.com/en/docs/elevation-api
- MSFS 2024 aircraft position SimVars:
  https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/SimVars/Aircraft_SimVars/Aircraft_Misc_Variables.htm
- X-Plane aircraft position and elevation datarefs:
  https://developer.x-plane.com/article/movingtheplane/
