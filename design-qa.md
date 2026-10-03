# MAP vertical profile — design QA

## Evidence and normalization

- Source visual truth:
  `C:\Users\34895\Documents\xwechat_files\wxid_fwca4vqls1u312_0a12\temp\RWTemp\2026-09\9e20f478899dc29eb19741386f9343c8\1edcf35bb806bb2a4ee713f65034af6d.jpg`
- Source dimensions: 380 × 317 pixels at 144 DPI. This is a perspective
  cockpit photograph rather than a CSS viewport, so it was used for avionics
  palette, hierarchy, grid, terrain, and planned-path intent—not literal frame
  or pixel matching.
- Final desktop implementation:
  `artifacts/vertical-profile-qa/implementation-desktop-avionics.png`
- Desktop viewport and capture: 1188 × 776 CSS px, 1188 × 776 image pixels,
  device density 1×.
- Final narrow implementation:
  `artifacts/vertical-profile-qa/implementation-mobile-620-avionics.png`
- Narrow viewport and capture: 620 × 800 CSS px, 620 × 800 image pixels,
  device density 1×.
- State: MAP active, restored ZSPD → VHHH flight plan, PROFILE expanded over
  the complete main region, terrain available from Open-Meteo/Copernicus DEM,
  simulator disconnected, aircraft marker therefore hidden.
- Comparison method: the source photograph and each implementation screenshot
  were opened together in the same comparison input. Density was already 1:1
  for both browser captures. No resampling was applied to the photographic
  source because its perspective crop has no meaningful CSS equivalent.

## Full-view comparison evidence

- Desktop: the persistent top bar and left MAP/TAXI/PROFILE rail remain usable;
  PROFILE fills the complete MAP main region. The plot, compact metric header,
  footer, grid, terrain silhouette, and cyan planned path form one dark-navy
  avionics display consistent with the reference intent.
- 620 px: PROFILE fills the available main region without overlap or clipping.
  The header wraps into a readable second row, the close control remains
  reachable, and attribution/advisory copy stacks without obscuring the plot.
- The low terrain stays on the accurate 0–45,000 ft MSL scale. Its lighter
  two-pixel ridge outline remains visible instead of vertically exaggerating
  terrain to imitate the photograph.

## Focused comparison evidence

The profile display is the only reference target and occupies nearly the whole
implementation capture, so a separate raster crop was not needed. The combined
comparison was inspected at native size for the compact header text, axis/tick
labels, grid contrast, terrain ridge, cyan path, close control, and footer. All
were readable in the final desktop capture; the same regions were separately
checked in the native 620 × 800 capture for responsive wrapping.

## Required fidelity surfaces

- Fonts and typography: TaxiNow's Inter/Segoe UI/Microsoft YaHei stack is an
  intentional product constraint; compact 9–12 px labels preserve the cockpit
  hierarchy, metric values remain legible, and narrow-state wrapping/truncation
  does not collide.
- Spacing and layout rhythm: header, plot, and footer are aligned as a single
  edge-to-edge instrument. Desktop spacing is compact; the 620 px header/footer
  reflow maintains usable gaps and tap targets.
- Colors and tokens: dedicated profile tokens provide navy plot/surfaces,
  off-white text, muted blue labels, subtle blue grid lines, blue-grey terrain,
  a lighter terrain ridge, cyan plan line, and semantic amber/red bands. The
  outer light theme cannot turn the profile white.
- Image quality and asset fidelity: the profile is data visualization, so canvas
  rendering is appropriate. It uses no rasterized UI, placeholder illustration,
  decorative CSS art, emoji replacement, or low-resolution imagery.
- Copy and content: ZSPD → VHHH, MSL/AGL/clearance/remaining metrics,
  Open-Meteo/Copernicus attribution, cached/fresh status, and simulation-only
  notice are coherent and scoped to the feature.
- Icons and affordances: PROFILE selected state, close control, MAP/TAXI rail
  controls, focus outline, keyboard inspection, and Retry/error affordances are
  preserved.
- Accessibility: high-contrast text and route/terrain strokes, semantic button
  labels, screen-reader summary, keyboard Left/Right/Escape support, visible
  focus, reduced-motion handling, and practical narrow-screen controls remain.

## Interaction and responsive checks

- MAP shows PROFILE below TAXI and hides FROM/TO/Plan Taxi.
- PROFILE opens full-screen and exposes its selected state; close restores MAP.
- TAXI hides PROFILE and shows FROM ZSPD, TO VHHH, and Plan Taxi.
- Returning to MAP restores the remembered open preference.
- TO VHHH switches to the VHHH airport as expected.
- Mobile starts collapsed, then fills the main region after PROFILE is selected.
- Disconnected telemetry hides only the aircraft marker; route and terrain stay.
- No new application console errors were reported during the final browser pass.

## Comparison history

### Iteration 0 — blocked

- Evidence: `artifacts/vertical-profile-qa/implementation-desktop-initial.png`.
- [P1] The profile plot, header, and footer inherited the generic light theme and
  appeared white/light grey, conflicting with both TaxiNow's dark shell and the
  supplied navy avionics reference.
- [P1] Low terrain relied on fill alone and became visually indistinct at the
  bottom of a long route with a 45,000 ft vertical scale.

### Fixes applied

- Added dedicated dark-navy profile background, surface, text, muted, grid,
  terrain, route, warning, and aircraft tokens independent of the outer theme.
- Added a two-pixel high-contrast ridge stroke at the terrain's true y position;
  the altitude scale and terrain values were not altered.
- Added a regression test that was observed failing with a white first canvas
  fill before the fix and passing with the dark plot plus terrain stroke after.

### Iteration 1 — passed

- Evidence: `artifacts/vertical-profile-qa/implementation-desktop-avionics.png`
  and `artifacts/vertical-profile-qa/implementation-mobile-620-avionics.png`.
- Post-fix comparison found no actionable P0, P1, or P2 mismatch. Dark avionics
  hierarchy, full-screen composition, responsive wrapping, planned path, grid,
  and accurate visible terrain all meet the source intent and product constraints.

## Findings

No actionable P0, P1, or P2 findings remain.

## Open questions

None blocking. A real simulator was not running during browser QA, so the live
aircraft marker was verified through automated model/view/transport tests rather
than a cockpit connection.

## Implementation checklist

- [x] Dedicated dark avionics palette in both TaxiNow themes.
- [x] Accurate terrain fill with visible ridge outline.
- [x] Desktop and 620 px full-main-region layouts.
- [x] MAP/TAXI/PROFILE state and airport navigation interactions.
- [x] Accessibility, attribution, offline state, and simulation-only notice.
- [x] No remaining actionable P0/P1/P2 differences.

## Follow-up polish

No P3 item is required for handoff.

final result: passed
