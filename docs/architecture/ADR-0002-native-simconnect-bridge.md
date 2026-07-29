# ADR-0002: Native SimConnect bridge

- Status: Accepted
- Date: 2026-07-29

## Context

The Microsoft managed wrapper targets .NET Framework and SimConnect is not
thread-safe. TaxiNow targets current .NET and must support both simulator
generations.

## Decision

Use a small x64 C++ DLL with a versioned C ABI. One native owner thread performs
all SimConnect calls and exposes copied snapshots to .NET through P/Invoke.

## Consequences

SDK and ABI differences are isolated, and the UI never receives simulator
callbacks. A native build workload and an explicitly selected SDK are required.
If the common bridge cannot support both simulators, the approved fallback is a
.NET Framework 4.7.2 helper process with a versioned named-pipe protocol.

