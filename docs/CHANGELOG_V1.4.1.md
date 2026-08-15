# TaxiNow V1.4.1 — Build 119

- Removed the red runway-end heading capsules. TaxiNow's global runway data
  provides true geometric headings, while published runway headings and
  designators use magnetic azimuth and require current national AIP data.
  Mixing those values could mislead users, so only the runway's established
  pavement designator remains.
- Increased the centerline separation between paired aiming-point and
  touchdown-zone markings while keeping every block inside the physical runway
  edges.
- Replaced the former runway-end lead-in presentation with a dark blast-pad
  area and three yellow chevrons at each end.
- Kept the MapLibre and constrained-device SVG fallback renderers visually
  consistent for the revised runway markings.

TaxiNow remains for flight simulation only and must not be used for real-world
navigation.
