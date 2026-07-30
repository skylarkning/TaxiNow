# ADR-0005: Airport map source and distribution strategy

## Status

Accepted for incremental implementation after V1.0 Beta 4.

## Context

TaxiNow needs detailed airport geometry, terminal footprints and names, stand
positions, and taxiway markings. No current source is equally strong in every
category:

- OpenStreetMap normally provides the best combined 2D terminal, apron,
  taxiway, gate, and label coverage. Public Overpass instances are shared
  community infrastructure, however, and explicitly discourage applications
  from using them as a high-volume backend or stitching many per-object
  requests. Public instances apply per-user request slots and cooldowns.
- X-Plane `apt.dat` provides fast, globally consistent runways, pavement,
  taxi routes, and parking positions, but its documented format does not
  include scenery objects such as buildings. Gateway terminal buildings come
  from separate 3D facade scenery; flattening modular facade sections into 2D
  can yield unnamed or fragmented terminal shapes.
- OurAirports is a reliable catalog and runway fallback, not a detailed ground
  map.
- FAA Airport Diagram GIS data is an authoritative US supplement for the
  airports it covers. The initial published set includes DCA/KDCA and contains
  buildings, taxiways, aprons, and runways, but it is not yet a global source.

## Decision

TaxiNow uses a feature-level source policy:

1. Terminal footprints and terminal names: OSM first; authoritative national
   aviation GIS where available; X-Plane facade geometry only as a last-resort
   visual supplement.
2. Taxiways, aprons, and stands: OSM first; X-Plane Gateway fills missing
   operational detail.
3. Runways and airport catalog: OSM with OurAirports fallback and validation.
4. Geometry is accepted only when it lies inside the selected airport's
   runway-derived operational envelope. Terminal completeness is evaluated per
   gate cluster, not only as one airport-wide percentage.

For interactive ICAO downloads, TaxiNow continues to use a compact Overpass
query. Public OSM queries are serialized, regardless of the number of batch
workers, to avoid self-throttling.

Country and large-region downloads must move away from one public Overpass
request per airport. The target design is:

- build TaxiNow-normalized country or subdivision packs from official OSM
  extracts in a maintainer-controlled build pipeline;
- split very large countries such as the United States by state;
- publish a small signed manifest plus versioned compressed packs through the
  official TaxiNow release infrastructure;
- let the client download independent packs concurrently, resume interrupted
  transfers, and skip already current airport assets;
- keep on-demand Overpass only for airports missing from a pack or newer than
  the installed pack.

This permits real parallel file downloads without attempting to bypass public
OSM service limits.

## Consequences

- Selecting more airport workers no longer increases concurrent public OSM
  load. It may still overlap cache, normalization, and fallback work.
- A single ICAO remains available immediately without downloading a regional
  extract.
- Country-scale speed will improve materially only after normalized regional
  packs are published; endpoint rotation alone cannot solve the public
  Overpass capacity constraint.
- OSM attribution and ODbL obligations must remain attached to every derived
  pack and visible in TaxiNow.

## Primary references

- Overpass API public-instance guidance:
  https://dev.overpass-api.de/overpass-doc/en/preface/commons.html
- Geofabrik regional OSM extracts:
  https://download.geofabrik.de/
- X-Plane `apt.dat` format:
  https://developer.x-plane.com/article/airport-data-apt-dat-file-format-specification/
- X-Plane Terminal Kit:
  https://developer.x-plane.com/article/terminal-kit/
- FAA Airport Diagram Open Data release:
  https://www.faa.gov/air_traffic/flight_info/aeronav/safety_alerts/media/ADDS_25-01_DPN_Open_Data_Release.pdf
