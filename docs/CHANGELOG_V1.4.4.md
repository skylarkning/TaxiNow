# TaxiNow V1.4.4 — Build 122

- Fixed an ownship rendering race introduced after V1.4: aircraft telemetry
  received while the map layer was still loading could be incorrectly marked
  as rendered, leaving a stationary aircraft icon hidden until a later change.
- The aircraft icon now synchronizes as soon as the native map layer or SVG
  fallback becomes ready, including after switching airports.
- Ownship animation now starts immediately after its map layer is created
  instead of waiting for the map's idle event or fallback timeout.
