# Vertical Profile Step-Climb and Weather Design

**Date:** 2026-10-05  
**Status:** Draft for written-spec review  
**Product:** TaxiNow Pro V2.0

## Purpose

The vertical profile should help a remote-flight pilot understand the next step-climb decisions at a glance. It should behave like an operational vertical display rather than a generic chart: the planned altitude path, the aircraft, the relevant waypoints, terrain, and forecast weather must remain visually distinct at every route scale.

The feature also provides a radar-inspired forecast weather cross-section for the next 500 NM. It is not, and must not be described as, live airborne radar. Weather values must retain their source time and confidence label.

## Goals

- Make step-climb, top-of-descent, descent, and altitude-restriction waypoints easy to identify.
- Support continuous zooming and panning from a short route segment to the full remaining route.
- Show every waypoint when the visible segment is short enough to label clearly.
- Reduce label density at long range while preserving operationally important waypoints.
- Replace dense box-like grid lines with a small number of altitude and distance references.
- Mark the current aircraft position with a prominent downward-pointing triangle.
- Show forecast cloud base, cloud top, and precipitation or convection intensity for up to 500 NM ahead.
- Keep the altitude profile usable when some or all weather sources are unavailable.

## Non-goals

- Claiming or simulating raw airborne radar returns.
- Manual radar tilt, elevation, gain, or azimuth controls.
- Wind, turbulence, or icing overlays in the first release.
- Weather avoidance guidance or dispatch-quality decision support.
- Replacing official weather briefings, ATC instructions, or aircraft systems.

## Display and Interaction

### View window

In flight, the default window starts at the aircraft's projected distance along the route and ends 500 NM ahead, or at the destination when less than 500 NM remains. Before departure, or when a usable aircraft position is unavailable, it starts at the origin.

The user can:

- zoom with the mouse wheel, trackpad, keyboard, and existing plus/minus controls;
- drag horizontally to inspect another route segment;
- reset to the default 500 NM ahead view;
- zoom out as far as the full remaining route and in as far as 25 NM.

Zoom is centered on the pointer when pointer coordinates are available and on the current aircraft otherwise. Panning is clamped to the route. Zoom and pan redraw cached data and do not issue new network requests unless the requested route interval is outside the cached weather interval.

### Information density

Waypoint labels are selected using screen-space priority rather than a fixed number of labels.

Priority order:

1. origin, destination, and current next waypoint;
2. altitude constraints;
3. step-climb and step-descent points;
4. top of climb and top of descent;
5. other route waypoints.

When the visible range is 120 NM or less, every waypoint in the range is eligible for display. Labels may use up to three staggered rows to avoid overlap. At longer ranges, ordinary waypoints are removed first. In a full-route view, only the first four priority groups remain.

A step point is a waypoint where the planned altitude changes by at least 1,000 ft after a span of at least 20 NM whose planned altitude varies by less than 500 ft. Top of climb is the first point after departure followed by at least 20 NM within a 500 ft altitude band. Top of descent is the first point after cruise followed by a planned loss of at least 1,000 ft within 20 NM. Explicit flight-plan constraints always take precedence over derived labels.

### Plot styling

- Use no vertical box grid.
- Draw three or four horizontal altitude references appropriate to the current scale.
- Draw distance ticks along the bottom without full-height grid lines.
- Keep terrain as a low-contrast filled silhouette with a distinct top edge.
- Draw the planned altitude path above weather and terrain.
- Render the aircraft as a larger downward-pointing triangle whose tip identifies the exact route distance and current MSL altitude.
- Preserve the existing dark avionics plot in light and dark application themes.

## Weather Presentation

### Visual language

Weather is rendered as irregular, radar-inspired regions inside the vertical cut:

- green: weak forecast precipitation or convection;
- yellow: moderate forecast precipitation or convection;
- red: strong forecast precipitation or convection;
- solid fill: weather intersecting the planned vertical-path envelope;
- reduced-opacity striped fill: weather in the vertical cut but outside the planned path envelope.

The planned-path envelope is nominally the planned altitude plus or minus 4,000 ft. The visual distinction is an aid to interpretation, not a statement of airborne-radar accuracy.

Cloud regions show a rounded base and top, with labels rounded to the nearest 1,000 ft. Each inspection tooltip includes distance, nearest waypoint, base, top, intensity, valid time, source, and whether the values are observed, forecast, or estimated. Unknown tops or bases remain unknown; the renderer must not invent a boundary.

The panel always displays `Forecast / estimated — not airborne radar` in localized form when weather is visible.

### Time alignment

Each route sample uses the forecast time at which the aircraft is expected to reach that location.

ETA is calculated from, in order:

1. the imported flight plan's time or speed information when available;
2. current ground speed when airborne and valid;
3. a conservative default cruise ground speed of 450 kt.

The response exposes the assumption used. ETA changes of less than five minutes do not force a refetch.

## Weather Data and Derivation

### Sources

The first implementation uses a hybrid provider:

- Open-Meteo multi-level forecast data supplies pressure-level cloud cover, geopotential height, surface precipitation, weather code, and convective fields where available.
- METAR and TAF reports calibrate cloud bases around departure, destination, and airport route points.
- SIGMET data supplies reported convective regions and explicit tops when available.

The provider interface must allow replacement or additional sources without changing the view model. Source timestamps, attributions, and licensing notices are retained through the entire data flow.

Open-Meteo documents pressure-level cloud cover and geopotential height as forecast variables suitable for identifying cloud-bearing vertical layers. Airbus describes the A350/A380 radar display as a computed view of a volumetric buffer and distinguishes weather inside a nominal vertical flight-path envelope from secondary weather outside it. TaxiNow borrows that display grammar only; its data remain forecast-derived.

References:

- [Open-Meteo forecast API](https://open-meteo.com/en/docs)
- [Airbus Safety First: Optimum use of weather radar](https://safetyfirst.airbus.com/optimum-use-of-weather-radar/?airbus-iframe=true)

### Route sampling

The server samples the route centerline every 25 NM for the next 500 NM, including both interval endpoints and every critical vertical point. This produces no more than 32 forecast locations after critical-point insertion. Requests are batched when the provider supports multi-location calls.

For each location and ETA:

1. use geopotential height to convert pressure levels to MSL altitude;
2. identify levels with cloud cover of at least 60 percent;
3. merge adjacent qualifying levels into a cloud layer;
4. interpolate the 60-percent crossing when adjacent levels bracket the threshold;
5. merge layers across neighboring route samples into display polygons;
6. apply METAR/TAF base calibration only near the report's airport and valid time;
7. apply explicit SIGMET tops only inside the SIGMET geometry and valid period;
8. retain the original model value, adjusted value, source, and confidence in the server model.

Thin or ambiguous single-level layers are allowed but are marked low-confidence. Gaps larger than 50 NM or two forecast time steps split a weather polygon rather than visually bridging missing data.

Precipitation intensity is normalized into weak, moderate, and strong categories by the provider adapter. The API contract exposes the category and underlying source values so thresholds can change without altering the renderer.

## Architecture

### Server

Add a weather-profile provider boundary and orchestration service beside the existing elevation-profile service.

Responsibilities:

- validate and sample the route;
- compute ETAs;
- request forecast and aviation-report data;
- derive cloud layers and weather intensity;
- merge source confidence and attribution;
- cache successful partial and complete results;
- return partial results when one source fails.

The endpoint accepts a bounded route polyline, current projected route distance, current ground speed, and departure time. Validation limits the request to 200 route points, valid geographic coordinates, 10,000 NM total route distance, and a 500 NM weather horizon.

The response contains:

- requested and effective route interval;
- generation and validity times;
- ETA assumption;
- sampled cloud layers and precipitation cells;
- per-feature confidence and observation/forecast/estimate classification;
- source attribution and cache status;
- warnings for unavailable or stale sources.

Successful forecast responses are cached by rounded route sample, forecast hour, and provider model. Fresh data use a 15-minute cache target. Stale successful data may be returned for up to two hours when refresh fails, with an explicit stale warning. Failed requests use a short negative cache to prevent retry storms.

### Web client

Keep the existing vertical-profile controller as the coordinator, but split new responsibilities into focused modules:

- `verticalProfileViewport`: zoom, pan, bounds, and coordinate transforms;
- `verticalProfileLabels`: point classification, priority, staggering, and collision handling;
- `verticalProfileWeather`: client contract normalization and weather geometry;
- `verticalProfileRenderer`: layered Canvas drawing for terrain, weather, route, labels, constraints, and aircraft.

The controller fetches weather only when the panel is open and the model has a usable route. It cancels superseded requests and ignores stale generations. Pointer and keyboard inspection use the same viewport transform as rendering.

### Layer order

The Canvas layer order is fixed:

1. background and sparse altitude references;
2. terrain fill and terrain edge;
3. off-path striped weather;
4. on-path solid weather;
5. planned-path envelope and altitude path;
6. constraints and critical points;
7. waypoint labels;
8. aircraft marker and active inspection highlight.

## Failure Handling

- If all weather sources fail, render the altitude and terrain profile with a localized weather-unavailable status.
- If aviation reports fail, render model weather and label it forecast/estimated.
- If the model fails but valid reports intersect the route, render only those report-backed regions and do not bridge the gaps.
- If cached data are stale, keep them visible with their age and stale status.
- If ETA cannot be estimated, use the documented 450 kt fallback and disclose it.
- If Canvas is unavailable, preserve the existing accessible text summary and controls.

## Accessibility

- Zoom and pan are available by keyboard.
- Focus inspection announces distance, nearest waypoint, planned altitude, cloud base/top, intensity, confidence, and valid time.
- Color is paired with solid/striped treatment and text labels.
- The aircraft is described as current position; its meaning does not depend on shape alone.
- Reduced-motion preference disables animated viewport interpolation.
- Labels and controls retain readable size at mobile widths.

## Performance

- Cap the weather horizon at 500 NM and forecast samples at 32.
- Debounce viewport-driven fetches and reuse cached intervals.
- Precompute weather polygons when data arrive; do not rebuild them on every pointer move.
- Redraw through one animation-frame scheduler.
- Keep ordinary zoom and pan entirely client-side.
- Preserve the current device-pixel-ratio Canvas scaling and redraw only when model, viewport, size, or palette changes.

## Testing

### Unit tests

- viewport clamping, pointer-centered zoom, keyboard zoom, and pan bounds;
- all-waypoint eligibility at 120 NM or less;
- critical-point-only behavior in full-route view;
- step-climb, step-descent, top-of-climb, and top-of-descent classification;
- label priority and staggered collision handling;
- downward orientation and anchor point of the aircraft triangle;
- ETA calculation and fallback disclosure;
- pressure-level conversion, cloud threshold interpolation, layer merging, and missing-layer splitting;
- METAR/TAF base calibration and SIGMET top override rules;
- intensity normalization and on-path/off-path classification;
- request cancellation, cache freshness, stale fallback, and negative caching.

### Rendering and integration tests

- Canvas operations preserve the required layer order.
- Sparse altitude lines replace the former box grid.
- Short, 500 NM, and full-route fixtures produce the approved label densities.
- Solid and striped weather remain distinguishable without color.
- Missing or partial weather never prevents the vertical profile from rendering.
- Localization and accessible summaries include forecast/estimate and not-radar wording.
- Existing elevation, flight-plan, theme, resize, mobile, and lifecycle tests continue to pass.

### Manual acceptance

Validate at minimum:

- a 60–80 NM route with every waypoint visible;
- a long-haul route with multiple step climbs and only critical full-route labels;
- an airborne position inside the route with the triangle tip at the correct distance and altitude;
- a 500 NM view with weak, moderate, and strong forecast weather;
- partial, stale, and completely unavailable weather;
- desktop and mobile layouts in light and dark application themes.

## Rollout

Ship behind an internal feature flag until provider limits, cache behavior, rendering performance, and wording have been verified. Retain the current terrain-only profile as the fallback path. Enable forecast weather by default only after the sources and attributions have been reviewed for the distribution model used by TaxiNow Pro.
