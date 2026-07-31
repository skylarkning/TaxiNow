# ADR-0004: Managed SimConnect source for MSFS 2020 and MSFS 2024

- Status: Accepted
- Date: 2026-07-29
- Extended: 2026-07-31

## Context

TaxiNow needs live MSFS 2020 and MSFS 2024 position data, while the current Windows
development environment does not have the native C++ workload required by the
earlier bridge design. The installed MSFS SDK includes Microsoft's managed
SimConnect wrapper, and a live compatibility probe confirmed that it loads on
the project's current .NET runtime and returns the five required variables.

## Decision

Use the official managed wrapper behind `ITelemetrySource` for both simulator
editions. Prefer the MSFS 2024 SDK client library when available; live tests
confirmed that this client connects to both MSFS 2020 and MSFS 2024. Detect
`FlightSimulator.exe` and `FlightSimulator2024.exe` independently and attach
the accepted edition to every status and telemetry sample. One dedicated owner
thread creates the connection,
receives callbacks, and performs every SimConnect call. TaxiNow subscribes to
the `Sim` system event to distinguish a running simulator from an active
flight.

Request latitude, longitude, true heading, on-ground state, and ground speed on
visual frames with the changed-data flag and an interval of four. Forward
material position, heading, speed, and ground-state changes immediately;
otherwise publish one parked heartbeat per second. Use a bounded,
drop-oldest channel so a stalled consumer cannot grow memory use.

Keep replay as an explicitly selectable source for development and automated
tests. Keep the native bridge spike in the repository for future distribution
or API requirements.

## Consequences

MSFS 2020 and MSFS 2024 live ground tracking work without a native compiler on the current
machine, and the UI remains isolated from simulator callbacks. Source builds
need an SDK path to include live support, and public redistribution of the
runtime DLLs requires a separate licensing and installer decision. Facility
data and full restart/reconnect matrices still require compatibility testing.
