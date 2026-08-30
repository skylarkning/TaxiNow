# TaxiNow V1.5 (Build 126)

Build date: August 30, 2026

## New

- Customized taxi routes now accept spaces as separators in addition to
  commas, including mixed input. Gate destinations such as `GATE B19` remain
  supported.
- Added a FAQ explanation for VATSIM's approximately 15-second official
  network-data refresh cadence and TaxiNow's shared PC-side cache.

- Added an opt-in **Show VATSIM Traffic** setting for desktop and browser/iPad
  maps. The preference is off by default and saved independently per device.
- Nearby VATSIM aircraft are drawn as small orange plane icons. The local MSFS
  aircraft keeps its cyan icon and is rendered above network traffic.
- Each VATSIM aircraft now has a compact callsign label below its icon. Labels
  stay upright while the plane symbol follows its network heading.
- TaxiNow's PC service reads the official VATSIM public network-data feed,
  caches it for 15 seconds, and returns only aircraft in the selected airport
  area. Pilot names and VATSIM account IDs are not forwarded to the map.
- Traffic refresh failures retain the last successful display and recover on a
  later poll without interrupting simulator position tracking.

## Data source

VATSIM traffic data is provided by the VATSIM Data API:
`https://data.vatsim.net/v3/vatsim-data.json`.

TaxiNow is for flight-simulation use only and is not for real-world navigation.
