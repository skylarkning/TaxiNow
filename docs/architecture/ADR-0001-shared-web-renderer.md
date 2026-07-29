# ADR-0001: Shared web renderer

- Status: Accepted
- Date: 2026-07-29

## Context

TaxiNow needs an embedded Windows map and an optional local-network browser map.
Two renderers would duplicate geometry, label, interpolation, and test behavior.

## Decision

Use a TypeScript/Vite/MapLibre GL JS SPA with no external basemap. Kestrel serves
the same compiled assets to WebView2 and ordinary browsers. WPF owns native
shell concerns only. Prefer `WebView2CompositionControl`, but permit the standard
WPF `WebView2` control when the composition control cannot realize a window on
the target Windows/WebView2 combination.

## Consequences

Map behavior stays identical across surfaces and GPU rendering is reused.
WebView2 becomes a desktop runtime prerequisite, and native dialogs must remain
outside the map surface. The standard-control fallback can reintroduce WPF
airspace limitations, so composition control must be re-tested after WebView2 or
graphics-stack changes.
