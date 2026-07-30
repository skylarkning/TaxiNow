import os
import pathlib
import tempfile
import threading
import time
import unittest
from unittest import mock

import taxinow_map_pipeline as pipeline
import skycharts_airport_map as skycharts


class CapturingProtocol(pipeline.Protocol):
    def __init__(self):
        super().__init__({"requestId": "test"})
        self.events = []

    def emit(self, event, **payload):
        self.events.append({"event": event, **payload})


class DownloadProgressTests(unittest.TestCase):
    def test_country_eta_waits_for_multiple_completed_airports(self):
        protocol = CapturingProtocol()

        protocol.progress(
            "waiting_sources",
            completed=1,
            total=500,
            current_icao="CNC3",
            source="OpenStreetMap",
            overall_percentage=0.2,
        )
        protocol.progress(
            "waiting_sources",
            completed=4,
            total=500,
            current_icao="CYAG",
            source="OpenStreetMap",
            overall_percentage=0.8,
        )

        self.assertIsNone(
            protocol.events[0]["estimatedRemainingSeconds"]
        )
        self.assertIsNotNone(
            protocol.events[1]["estimatedRemainingSeconds"]
        )

    def test_worker_reports_stage_bytes_speed_and_eta(self):
        airport = pipeline.Airport(
            "CYYZ",
            "Toronto Pearson International Airport",
            "CA",
            "CA-ON",
            "Toronto",
            43.6772,
            -79.6306,
            "large_airport",
        )
        protocol = CapturingProtocol()

        def fake_download(_airport, output, _cache, callback):
            callback(
                phase="downloading_map",
                percentage=42,
                source="OpenStreetMap",
                bytes_downloaded=524288,
                download_bytes_total=1048576,
                download_bytes_per_second=262144,
                estimated_remaining_seconds=2,
            )
            time.sleep(0.35)
            path = output / "CYYZ.json"
            return path, 123

        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            cache = pipeline.SourceCache(root / "cache")
            with mock.patch.object(
                pipeline, "download_airport", side_effect=fake_download
            ):
                result = pipeline.download_airport_with_progress(
                    protocol,
                    airport,
                    root / "output",
                    cache,
                    completed=0,
                    total=1,
                    bytes_written=0,
                    warnings=[],
                )

        self.assertEqual(123, result[1])
        progress = [
            event
            for event in protocol.events
            if event["event"] == "progress"
        ]
        self.assertTrue(progress)
        latest = progress[-1]
        self.assertEqual("downloading_map", latest["phase"])
        self.assertEqual(42, latest["percentage"])
        self.assertEqual(524288, latest["bytesDownloaded"])
        self.assertEqual(1048576, latest["downloadBytesTotal"])
        self.assertEqual(262144, latest["downloadBytesPerSecond"])
        self.assertEqual(2, latest["estimatedRemainingSeconds"])

    def test_country_workers_obey_parallel_limit(self):
        airports = [
            pipeline.Airport(
                f"CY{index:02d}",
                f"Airport {index}",
                "CA",
                "CA-ON",
                "Toronto",
                43.6 + index * 0.01,
                -79.6,
                "medium_airport",
            )
            for index in range(4)
        ]
        protocol = CapturingProtocol()
        active = 0
        peak_active = 0
        active_lock = threading.Lock()

        def fake_download(airport, output, _cache, callback):
            nonlocal active, peak_active
            with active_lock:
                active += 1
                peak_active = max(peak_active, active)
            try:
                callback(
                    phase="downloading_map",
                    percentage=50,
                    source="OpenStreetMap",
                    bytes_downloaded=100,
                    download_bytes_total=200,
                    download_bytes_per_second=1000,
                    estimated_remaining_seconds=0.1,
                )
                time.sleep(0.12)
                return output / f"{airport.icao}.json", 200
            finally:
                with active_lock:
                    active -= 1

        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            cache = pipeline.SourceCache(root / "cache")
            with mock.patch.object(
                pipeline, "download_airport", side_effect=fake_download
            ):
                outputs, written, warnings = (
                    pipeline.download_airports_parallel(
                        protocol,
                        airports,
                        root / "output",
                        cache,
                        max_parallel=2,
                        warnings=[],
                    )
                )

        self.assertEqual(2, peak_active)
        self.assertEqual(4, len(outputs))
        self.assertEqual(800, written)
        self.assertEqual([], warnings)

    def test_country_workers_skip_one_broken_airport(self):
        airports = [
            pipeline.Airport(
                "ZBCZ", "Changzhi Wangcun Airport", "CN", "CN-14", "Changzhi",
                36.2475, 113.1258, "medium_airport"
            ),
            pipeline.Airport(
                "ZYYC", "Yichun Lindu Airport", "CN", "CN-23", "Yichun",
                47.7521, 129.019, "medium_airport"
            ),
        ]
        protocol = CapturingProtocol()

        def fake_download(airport, output, _cache, _callback):
            if airport.icao == "ZBCZ":
                raise ValueError("malformed source metadata")
            return output / f"{airport.icao}.json", 200

        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            cache = pipeline.SourceCache(root / "cache")
            with (
                mock.patch.object(
                    pipeline,
                    "download_airport",
                    side_effect=fake_download,
                ),
                mock.patch.object(
                    pipeline,
                    "download_runway_fallback",
                    side_effect=pipeline.PipelineError(
                        "fallback unavailable"
                    ),
                ),
            ):
                outputs, written, warnings = (
                    pipeline.download_airports_parallel(
                        protocol,
                        airports,
                        root / "output",
                        cache,
                        max_parallel=2,
                        warnings=[],
                    )
                )

        self.assertEqual(
            [str(root / "output" / "ZYYC.json")],
            outputs,
        )
        self.assertEqual(200, written)
        self.assertTrue(
            any("ZBCZ: malformed source metadata" in warning
                for warning in warnings)
        )
        self.assertTrue(
            any("ZBCZ: fallback failed: fallback unavailable" in warning
                for warning in warnings)
        )


class OpenStreetMapPriorityTests(unittest.TestCase):
    def tearDown(self):
        with skycharts._ENDPOINT_CONDITION:
            skycharts._ENDPOINT_IN_FLIGHT.clear()
            skycharts._ENDPOINT_RETRY_AFTER.clear()
            skycharts._ENDPOINT_FAILURE_COUNT.clear()
            skycharts._ENDPOINT_LATENCY.clear()
            skycharts._ENDPOINT_CONDITION.notify_all()

    def test_overpass_waits_through_short_endpoint_cooldown(self):
        endpoint = "https://overpass.test/api/interpreter"
        with skycharts._ENDPOINT_CONDITION:
            skycharts._ENDPOINT_RETRY_AFTER[endpoint] = (
                time.monotonic() + 0.05
            )

        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.__exit__.return_value = False
        response.headers = {}
        response.read.side_effect = [b'{"elements":[]}', b""]

        started = time.monotonic()
        with (
            mock.patch.object(
                skycharts.urllib.request,
                "urlopen",
                return_value=response,
            ) as urlopen,
            mock.patch.object(skycharts, "OVERPASS_BUSY_WAIT", 1),
        ):
            result = skycharts.request_overpass(
                "[out:json];out;",
                (endpoint,),
                timeout=1,
            )

        self.assertGreaterEqual(time.monotonic() - started, 0.02)
        self.assertEqual([], result["elements"])
        urlopen.assert_called_once()

    def test_legacy_busy_marker_does_not_block_new_osm_attempt(self):
        with tempfile.TemporaryDirectory() as temporary:
            marker = pathlib.Path(temporary) / "ZBSN.unavailable.json"
            marker.write_text(
                (
                    '{"reason":"Overpass services remained busy for 25 seconds",'
                    f'"retryAfter":{time.time() + 900}}}'
                ),
                encoding="utf-8",
            )

            reason = skycharts.cached_unavailable_reason(marker)

        self.assertIsNone(reason)

    def test_runway_bounds_reduce_dense_city_query_area(self):
        airport = {
            "latitude": 40.7769,
            "longitude": -73.8740,
        }
        runway_raw = {
            "elements": [{
                "geometry": [
                    {"lat": 40.766, "lon": -73.884},
                    {"lat": 40.789, "lon": -73.858},
                ],
            }],
        }

        compact = skycharts.airport_query_bounds(airport, runway_raw)
        fixed = skycharts.coordinate_bounds(
            airport["latitude"],
            airport["longitude"],
            5500,
        )
        compact_area = (
            (compact[2] - compact[0]) * (compact[3] - compact[1])
        )
        fixed_area = (fixed[2] - fixed[0]) * (fixed[3] - fixed[1])

        self.assertLess(compact_area, fixed_area)
        self.assertLessEqual(compact[0], 40.766)
        self.assertGreaterEqual(compact[2], 40.789)

    def test_overpass_query_keeps_named_terminal_buildings(self):
        query = skycharts.overpass_query(
            40.7772,
            -73.8726,
            bounds=(40.76, -73.89, 40.79, -73.85),
        )

        self.assertIn(
            'nwr["building"]["name"~"terminal|concourse|satellite",i]',
            query,
        )

    def test_named_terminal_buildings_exclude_parking_garages(self):
        self.assertEqual(
            "terminal",
            skycharts.feature_kind({
                "building": "yes",
                "name": "Terminal 1",
            }),
        )
        self.assertIsNone(skycharts.feature_kind({
            "building": "yes",
            "name": "Terminal 1 Parking Garage",
        }))

    def test_uncovered_terminal_label_requests_focused_osm_detail(self):
        result = {
            "center": [-77.04, 38.85],
            "features": [
                {
                    "kind": "terminal",
                    "name": "Terminal 2",
                    "points": [
                        [-77.044, 38.853],
                        [-77.041, 38.853],
                        [-77.041, 38.858],
                        [-77.044, 38.858],
                        [-77.044, 38.853],
                    ],
                },
                {
                    "kind": "terminal",
                    "name": "Terminal 1",
                    "points": [[-77.042, 38.848]],
                },
            ],
        }

        uncovered = skycharts.uncovered_terminal_label_points(result)

        self.assertEqual(
            ["Terminal 1"],
            [feature["name"] for feature in uncovered],
        )

    def test_missing_gate_coverage_requests_terminal_supplement(self):
        result = {
            "center": [-73.87, 40.77],
            "features": [{
                "kind": "terminal",
                "points": [
                    [-73.871, 40.770],
                    [-73.870, 40.770],
                    [-73.870, 40.771],
                    [-73.871, 40.771],
                    [-73.871, 40.770],
                ],
            }],
        }
        result["features"].extend({
            "kind": "gate",
            "points": [[-73.8705 + index * 0.001, 40.7705]],
        } for index in range(10))

        self.assertTrue(skycharts.needs_terminal_supplement(result))

    def test_missing_small_gate_cluster_requests_terminal_supplement(self):
        result = {
            "center": [-73.87, 40.77],
            "features": [{
                "kind": "terminal",
                "points": [
                    [-73.872, 40.769],
                    [-73.868, 40.769],
                    [-73.868, 40.772],
                    [-73.872, 40.772],
                    [-73.872, 40.769],
                ],
            }],
        }
        result["features"].extend({
            "kind": "gate",
            "points": [[
                -73.8705 + (index % 4) * 0.0002,
                40.7700 + (index // 4) * 0.0002,
            ]],
        } for index in range(12))
        result["features"].extend({
            "kind": "gate",
            "points": [[-73.8500 + index * 0.0002, 40.7700]],
        } for index in range(4))

        self.assertTrue(skycharts.needs_terminal_supplement(result))

    def test_public_overpass_queries_are_serialized(self):
        active = 0
        maximum_active = 0
        state_lock = threading.Lock()

        def fake_request(*_args, **_kwargs):
            nonlocal active, maximum_active
            with state_lock:
                active += 1
                maximum_active = max(maximum_active, active)
            time.sleep(0.03)
            with state_lock:
                active -= 1
            return {"elements": []}

        with mock.patch.object(
            skycharts,
            "_request_overpass_unlocked",
            side_effect=fake_request,
        ):
            workers = [
                threading.Thread(
                    target=skycharts.request_overpass,
                    args=("query", ("https://overpass.test",)),
                )
                for _ in range(3)
            ]
            for worker in workers:
                worker.start()
            for worker in workers:
                worker.join()

        self.assertEqual(1, maximum_active)

    def test_gateway_terminal_supplement_skips_osm_overlap(self):
        def terminal(element_id, west):
            return {
                "type": "way",
                "id": element_id,
                "tags": {"building": "terminal"},
                "geometry": [
                    {"lon": west, "lat": 40.77},
                    {"lon": west + 0.001, "lat": 40.77},
                    {"lon": west + 0.001, "lat": 40.771},
                    {"lon": west, "lat": 40.771},
                    {"lon": west, "lat": 40.77},
                ],
            }

        selected = skycharts.gateway_terminal_supplements(
            [terminal("osm", -73.87)],
            [
                terminal("gateway-overlap", -73.87),
                terminal("gateway-missing", -73.85),
            ],
        )

        self.assertEqual(
            ["gateway-missing"],
            [element["id"] for element in selected],
        )

    def test_isolated_nearby_airport_geometry_is_removed(self):
        airport = {"latitude": 38.8512, "longitude": -77.0402}
        runway = {
            "id": "runway",
            "kind": "runway",
            "points": [[-77.048, 38.840], [-77.033, 38.863]],
        }
        terminal = {
            "id": "terminal",
            "kind": "terminal",
            "points": [[-77.043, 38.852], [-77.042, 38.853]],
        }
        remote_hangar = {
            "id": "remote",
            "kind": "hangar",
            "points": [[-76.996, 38.875], [-76.995, 38.876]],
        }

        selected = skycharts.filter_isolated_airport_features(
            [runway, terminal, remote_hangar],
            airport,
        )

        self.assertEqual(["runway", "terminal"], [
            feature["id"] for feature in selected
        ])


class CatalogReliabilityTests(unittest.TestCase):
    def test_bundled_catalog_avoids_first_run_network_dependency(self):
        with tempfile.TemporaryDirectory() as temporary:
            cache = pipeline.SourceCache(pathlib.Path(temporary))
            with (
                mock.patch.object(
                    pipeline,
                    "bundled_catalog",
                    return_value=b"bundled catalog",
                ),
                mock.patch.object(pipeline, "request_bytes") as request,
            ):
                result = pipeline.load_catalog_dataset(
                    cache,
                    "airports.csv",
                    ("https://example.test/airports.csv",),
                )

        self.assertEqual(b"bundled catalog", result)
        request.assert_not_called()

    def test_stale_catalog_is_used_when_all_mirrors_fail(self):
        with tempfile.TemporaryDirectory() as temporary:
            cache = pipeline.SourceCache(pathlib.Path(temporary))
            key = pipeline.SourceCache.key("ourairports", "airports.csv")
            cache.write_bytes(key, b"cached catalog")
            cache_path = cache.positive / key
            old = time.time() - 8 * 24 * 60 * 60
            os.utime(cache_path, (old, old))
            with (
                mock.patch.object(pipeline, "bundled_catalog", return_value=None),
                mock.patch.object(
                    pipeline,
                    "request_bytes",
                    side_effect=pipeline.PipelineError("connection reset"),
                ),
            ):
                result = pipeline.load_catalog_dataset(
                    cache,
                    "airports.csv",
                    (
                        "https://one.test/airports.csv",
                        "https://two.test/airports.csv",
                    ),
                )

        self.assertEqual(b"cached catalog", result)


class AirportSelectionTests(unittest.TestCase):
    def setUp(self):
        self.catalog = [
            pipeline.Airport(
                "CYUL", "Montréal-Trudeau", "CA", "CA-QC", "Montréal",
                45.4706, -73.7408, "large_airport"
            ),
            pipeline.Airport(
                "CYYZ", "Toronto Pearson", "CA", "CA-ON", "Toronto",
                43.6772, -79.6306, "large_airport"
            ),
            pipeline.Airport(
                "CA-0001", "Local identifier only", "CA", "CA-ON", "Ottawa",
                45.0, -75.0, "small_airport"
            ),
        ]

    def test_country_download_excludes_installed_airports(self):
        selected = pipeline.select_airports(
            {
                "command": "download_country",
                "countryCode": "CA",
                "excludeIcaos": ["CYUL"],
            },
            self.catalog,
        )

        self.assertEqual(["CYYZ"], [airport.icao for airport in selected])

    def test_country_download_can_complete_when_every_airport_is_installed(self):
        selected = pipeline.select_airports(
            {
                "command": "download_country",
                "countryCode": "CA",
                "excludeIcaos": ["CYUL", "CYYZ"],
            },
            self.catalog,
        )

        self.assertEqual([], selected)

    def test_country_download_skips_non_icao_catalog_identifiers(self):
        selected = pipeline.select_airports(
            {
                "command": "download_country",
                "countryCode": "CA",
                "excludeIcaos": [],
            },
            self.catalog,
        )

        self.assertEqual(
            ["CYUL", "CYYZ"],
            [airport.icao for airport in selected],
        )


class SkyChartsUpgradeTests(unittest.TestCase):
    def test_numeric_source_revision_is_normalized_to_string(self):
        upgraded = pipeline.upgrade_skycharts_data(
            {
                "schemaVersion": 1,
                "ident": "ZBCZ",
                "name": "Changzhi Wangcun Airport",
                "source": "X-Plane Scenery Gateway",
                "sourceRevision": 4,
                "center": [113.1258, 36.2475],
                "features": [
                    {
                        "kind": "runway",
                        "points": [
                            [113.12, 36.24],
                            [113.13, 36.25],
                        ],
                    }
                ],
            },
            "CN",
            "CN-14",
            "Changzhi",
        )

        self.assertEqual("4", upgraded["sources"][0]["revision"])


if __name__ == "__main__":
    unittest.main()
