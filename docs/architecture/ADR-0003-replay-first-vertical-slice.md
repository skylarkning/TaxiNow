# ADR-0003: Replay-first vertical slice

- Status: Superseded by ADR-0004
- Date: 2026-07-29

## Context

The installed simulators require interactive startup and the discovered SDK
lacks official samples. Renderer, server, smoothing, storage, and desktop work
still need deterministic testing.

## Decision

The application selects a JSONL replay telemetry source by default until a
verified native bridge is available. Replay and live sources implement the same
managed snapshot interface.

## Consequences

Most development and CI do not require MSFS. Replay mode is explicitly labeled
as simulated and cannot be used as evidence of live compatibility.
