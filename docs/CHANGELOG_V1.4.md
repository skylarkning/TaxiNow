# TaxiNow V1.4 — Build 118

- Added automatic update checks with flightsim.to, GitHub, and in-app installer choices.
- Added connected-taxiway route building and manual map start/destination points.
- Added dark and light appearances plus a one-click sun/moon toggle.
- Redesigned runway presentation with a single edge outline, threshold stripes,
  aiming points, and touchdown-zone markings.
- Added compact red runway-end capsules showing both runway designator and
  physical heading without replacing the white number painted on the runway.
- Rebuilt threshold, aiming-point, and distance-coded touchdown-zone markings
  as physical-size geometry so they retain correct proportions while zooming.
- Fixed the native and fallback renderers appearing together and producing
  doubled runway graphics at close zoom levels.
- Fixed manual taxi-point context menus stacking or appearing below the map.
- Added explicit high-contrast taxiway-label plates in light appearance.
- Added an amber breathing highlight for taxiways selected in the customized
  route builder.
- Restored the proven V1.3 dark taxiway-marker plates and their original
  spacing and collision behavior; unlabeled features can no longer leave empty
  squares over taxiways or parking-stand lead-in lines.
- Uses a dark-gray taxiway-marker plate in light appearance instead of a pure
  black plate.
- Restored parking-stand lead-in lines as a dedicated map layer so they remain
  continuous and visible independently of labels.
- Fixed self-intersecting runway-end capsule geometry and removed the duplicate
  inner runway-edge layer that made close-zoom runway graphics look doubled.
- Corrected light-mode contrast across the airport picker, About page, forms, cards, and tooltips.
- Removed the closed side-panel shadow that created a dark vignette over the map.
- Kept the full runway presentation available in the SVG fallback renderer used on constrained clients.
