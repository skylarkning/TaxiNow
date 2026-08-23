# TaxiNow V1.4.5 — Build 123

- Fixed an iPad WebKit rendering delay that could leave the aircraft-position
  icon hidden for roughly two minutes even though telemetry was already
  synchronized.
- All browsers now use the same DOM/SVG MapLibre marker for the aircraft,
  avoiding the delayed Canvas `ImageData` sprite-upload path while preserving
  heading rotation, stale-state opacity, and smooth position updates.
- Reduced the aircraft icon by 10% for better map visibility.
- Widened taxiway pavement and its outline by 20% in both the normal and
  fallback map renderers.
