# TaxiNow V1.6 (Build 129)

Release date: September 14, 2026

## Added in Build 129

- Added a dedicated **Show SayIntentions Traffic** setting. TaxiNow reads only
  the active `flight_id` from SayIntentions' documented local `flightJSON`
  endpoint and uses the official Tracker's per-flight traffic endpoint to show
  real SayIntentions callsigns instead of MSFS `AI-<object-id>` placeholders.
- Matched official SayIntentions `simconnect_id` values back to live MSFS
  objects when available, preserving one-second position and heading movement
  while refreshing the official traffic membership and callsigns once per
  minute.
- Made VATSIM, BeyondATC, and SayIntentions traffic sources mutually exclusive
  in each TaxiNow view. Enabling one source automatically disables and removes
  markers from the other two.
- Added the local bounded endpoint
  `/api/v1/integrations/sayintentions/traffic`. TaxiNow never exposes or logs
  the API key, email address, or other account fields present in `flightJSON`.

Official integration references:

- <https://p2.sayintentions.ai/p2/docs/>
- <https://tracker.sayintentions.ai/>

## Added in Build 128

- Added an independent **Show BeyondATC Traffic** setting for the desktop and
  LAN/iPad map views.
- Added one-second SimConnect discovery of non-user aircraft within 50 km of
  the player's aircraft, including callsign, position, heading, altitude,
  ground speed, aircraft type, and model title.
- Added violet, heading-aware BeyondATC aircraft markers with upright callsign
  labels.
- Added the local
  `/api/v1/integrations/beyondatc/traffic` endpoint with selected-map bounds
  filtering so all connected views share the same PC-side simulator snapshot.

## Compatibility note

SimConnect exposes AI aircraft created by any client but does not expose the
identity of the injecting client. BeyondATC's supported setup requires MSFS
traffic and other traffic injectors to be disabled, so TaxiNow labels the
remaining non-user simulator aircraft as BeyondATC traffic. TaxiNow now allows
only one selected traffic source at a time to prevent duplicate overlays.
