import hashlib
import json
import os
import pathlib
import tempfile
import threading
import time
import unittest
import zipfile
from unittest import mock

import taxinow_map_pipeline as pipeline
import skycharts_airport_map as skycharts
import map_pack_builder
import global_map_pack_builder


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
        self.assertIn("out body geom;", query)
        self.assertNotIn("out tags geom;", query)

    def test_terminal_detail_query_keeps_relation_members(self):
        query = skycharts.overpass_terminal_query(
            (40.04, 116.55, 40.12, 116.64),
        )

        self.assertIn('nwr["aeroway"="terminal"]', query)
        self.assertIn("out body geom;", query)
        self.assertNotIn("out tags geom;", query)

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

    def test_generic_osm_building_is_promoted_by_terminal_label(self):
        generic = {
            "type": "way",
            "id": "outer-terminal",
            "tags": {"building": "yes"},
            "geometry": [
                {"lon": -123.180, "lat": 49.190},
                {"lon": -123.178, "lat": 49.190},
                {"lon": -123.178, "lat": 49.192},
                {"lon": -123.180, "lat": 49.192},
                {"lon": -123.180, "lat": 49.190},
            ],
        }
        result = {
            "center": [-123.179, 49.191],
            "features": [{
                "kind": "terminal",
                "name": "Domestic Terminal",
                "points": [[-123.179, 49.191]],
            }],
        }

        promoted = skycharts.promote_osm_terminal_buildings(
            [generic],
            result,
        )

        self.assertEqual(1, len(promoted))
        self.assertEqual("terminal", promoted[0]["tags"]["building"])
        self.assertEqual(
            "Domestic Terminal",
            promoted[0]["tags"]["name"],
        )

    def test_faa_designator_discards_gate_range_from_terminal_name(self):
        self.assertEqual(
            "Terminal 1",
            skycharts.faa_designator_name("TERMINAL 1 A1-A9"),
        )

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

    def test_large_hub_with_explicit_terminal_skips_all_building_query(self):
        result = {
            "center": [-0.45, 51.47],
            "features": [{
                "kind": "terminal",
                "name": "Terminal 5",
                "points": [
                    [-0.46, 51.47],
                    [-0.45, 51.47],
                    [-0.45, 51.48],
                    [-0.46, 51.48],
                    [-0.46, 51.47],
                ],
            }],
        }
        result["features"].extend({
            "kind": "gate",
            "points": [[-0.42 + index * 0.001, 51.47]],
        } for index in range(20))

        self.assertTrue(skycharts.needs_terminal_supplement(result))
        self.assertFalse(skycharts.needs_focused_terminal_detail(result))

    def test_uncovered_named_terminal_still_requests_focused_detail(self):
        result = {
            "center": [-0.45, 51.47],
            "features": [
                {
                    "kind": "terminal",
                    "name": "Terminal 5",
                    "points": [
                        [-0.46, 51.47],
                        [-0.45, 51.47],
                        [-0.45, 51.48],
                        [-0.46, 51.48],
                        [-0.46, 51.47],
                    ],
                },
                {
                    "kind": "terminal",
                    "name": "Terminal 4",
                    "points": [[-0.40, 51.46]],
                },
            ],
        }

        self.assertTrue(skycharts.needs_focused_terminal_detail(result))

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

    def test_terminal_overpass_request_has_bounded_time_and_size(self):
        with mock.patch.object(
            skycharts,
            "request_overpass",
            return_value={"elements": []},
        ) as request:
            skycharts.fetch_overpass_terminals((1.0, 2.0, 3.0, 4.0))

        self.assertEqual(
            skycharts.OVERPASS_TERMINAL_TOTAL_TIMEOUT,
            request.call_args.kwargs["total_timeout"],
        )
        self.assertEqual(
            skycharts.OVERPASS_TERMINAL_MAX_RESPONSE_BYTES,
            request.call_args.kwargs["maximum_response_bytes"],
        )

    def test_terminal_overpass_request_respects_smaller_airport_budget(self):
        with mock.patch.object(
            skycharts,
            "request_overpass",
            return_value={"elements": []},
        ) as request:
            skycharts.fetch_overpass_terminals(
                (1.0, 2.0, 3.0, 4.0),
                total_timeout=7,
            )

        self.assertEqual(7, request.call_args.kwargs["total_timeout"])

    def test_failed_osm_terminal_detail_allows_gateway_gap_fill(self):
        result = {
            "center": [-0.45, 51.47],
            "features": [{
                "kind": "terminal",
                "points": [
                    [-0.46, 51.47],
                    [-0.45, 51.47],
                    [-0.45, 51.48],
                    [-0.46, 51.48],
                    [-0.46, 51.47],
                ],
            }],
        }
        result["features"].extend({
            "kind": "gate",
            "points": [[-0.44 + index * 0.001, 51.47]],
        } for index in range(10))

        self.assertFalse(
            skycharts.should_try_gateway_terminal_supplement(result)
        )
        self.assertTrue(
            skycharts.should_try_gateway_terminal_supplement(
                result,
                terminal_detail_failed=True,
            )
        )

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

    def test_large_airport_connected_features_survive_runway_buffer(self):
        airport = {"latitude": 40.077349, "longitude": 116.596702}
        features = [
            {
                "id": "runway-west",
                "kind": "runway",
                "points": [[116.59, 40.05], [116.59, 40.105]],
            },
            {
                "id": "runway-east",
                "kind": "runway",
                "points": [[116.62, 40.05], [116.62, 40.105]],
            },
            {
                "id": "connector-a",
                "kind": "taxiway",
                "points": [[116.602, 40.075], [116.606, 40.075]],
            },
            {
                "id": "connector-b",
                "kind": "taxiway",
                "points": [[116.606, 40.075], [116.611, 40.075]],
            },
            {
                "id": "terminal-3",
                "kind": "terminal",
                "points": [
                    [116.611, 40.0745],
                    [116.616, 40.0745],
                    [116.616, 40.0755],
                    [116.611, 40.0755],
                    [116.611, 40.0745],
                ],
            },
            {
                "id": "unrelated-heliport",
                "kind": "hangar",
                "points": [
                    [116.65, 40.12],
                    [116.651, 40.12],
                    [116.651, 40.121],
                    [116.65, 40.12],
                ],
            },
        ]

        selected = skycharts.filter_isolated_airport_features(
            features,
            airport,
            maximum_distance=1000,
            connection_distance=100,
        )

        self.assertEqual(
            [
                "runway-west",
                "runway-east",
                "connector-a",
                "connector-b",
                "terminal-3",
            ],
            [feature["id"] for feature in selected],
        )


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


class RegionalMapPackTests(unittest.TestCase):
    def test_withdrawn_pilot_archives_are_removed_before_index_load(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = pipeline.SourceCache(pathlib.Path(directory))
            pack_root = cache.root / "map-packs"
            pack_root.mkdir(parents=True)
            for name in pipeline.REVOKED_MAP_PACK_ARCHIVES:
                (pack_root / name).write_bytes(b"withdrawn")
            empty_index = json.dumps({
                "schemaVersion": 1,
                "packs": [],
            }).encode("utf-8")

            with mock.patch.object(
                pipeline,
                "request_bytes",
                return_value=empty_index,
            ):
                result = pipeline.load_map_pack_index(cache)

            self.assertEqual([], result["packs"])
            for name in pipeline.REVOKED_MAP_PACK_ARCHIVES:
                self.assertFalse((pack_root / name).exists())

    def test_region_prefers_exact_subdivision_pack(self):
        index = {
            "schemaVersion": 1,
            "packs": [
                {
                    "id": "US",
                    "countryCode": "US",
                    "url": "https://example.test/us.zip",
                    "sha256": "a",
                },
                {
                    "id": "US-DC",
                    "countryCode": "US",
                    "regionCode": "US-DC",
                    "url": "https://example.test/dc.zip",
                    "sha256": "b",
                },
            ],
        }

        packs = pipeline.select_map_packs(index, "US", "US-DC")

        self.assertEqual(["US-DC"], [pack["id"] for pack in packs])

    def test_pack_extraction_validates_and_skips_installed_airports(self):
        map_data = {
            "schemaVersion": 2,
            "airport": {"icao": "KDCA"},
            "features": [],
        }
        payload = json.dumps(map_data).encode("utf-8")
        manifest = {
            "schemaVersion": 1,
            "maps": [{
                "icao": "KDCA",
                "path": "maps/KDCA.json",
                "sha256": hashlib.sha256(payload).hexdigest(),
            }],
        }
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            archive = root / "pack.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr(
                    "manifest.json",
                    json.dumps(manifest),
                )
                bundle.writestr("maps/KDCA.json", payload)

            outputs, written = pipeline.extract_map_pack(
                archive,
                root / "output",
                {"KDCA"},
                set(),
            )
            skipped, skipped_bytes = pipeline.extract_map_pack(
                archive,
                root / "skipped",
                {"KDCA"},
                {"KDCA"},
            )

        self.assertEqual(["KDCA.json"], [
            pathlib.Path(path).name for path in outputs
        ])
        self.assertEqual(len(payload), written)
        self.assertEqual([], skipped)
        self.assertEqual(0, skipped_bytes)

    def test_pack_rejects_path_traversal(self):
        with self.assertRaises(pipeline.PipelineError):
            pipeline.safe_pack_member("../KDCA.json")

    def test_icao_prefers_smallest_pack_containing_airport(self):
        index = {
            "schemaVersion": 1,
            "packs": [
                {
                    "id": "large",
                    "airportCount": 200,
                    "sizeBytes": 1000,
                    "icaos": ["CYVR"],
                    "url": "https://example.test/large.zip",
                    "sha256": "a",
                },
                {
                    "id": "small",
                    "airportCount": 20,
                    "sizeBytes": 500,
                    "icaos": ["CYVR"],
                    "url": "https://example.test/small.zip",
                    "sha256": "b",
                },
            ],
        }

        packs = pipeline.select_map_packs_for_icao(index, "cyvr")

        self.assertEqual(["small"], [pack["id"] for pack in packs])

    def test_country_selection_uses_only_newest_complete_shard_set(self):
        index = {
            "packs": [
                {
                    "id": "old",
                    "countryCode": "CA",
                    "version": "1",
                    "generatedAt": "2026-07-29T00:00:00Z",
                    "url": "https://example.test/old.zip",
                    "sha256": "a",
                },
                *[
                    {
                        "id": f"new-{part}",
                        "countryCode": "CA",
                        "version": "2",
                        "generatedAt": "2026-07-30T00:00:00Z",
                        "url": f"https://example.test/new-{part}.zip",
                        "sha256": "b",
                    }
                    for part in (1, 2)
                ],
                {
                    "id": "bc-new",
                    "countryCode": "CA",
                    "regionCode": "CA-BC",
                    "version": "2",
                    "generatedAt": "2026-07-30T01:00:00Z",
                    "url": "https://example.test/bc.zip",
                    "sha256": "c",
                },
            ],
        }

        packs = pipeline.select_map_packs(index, "CA", None)

        self.assertEqual(["new-1", "new-2"], [pack["id"] for pack in packs])

    def test_country_selection_keeps_newest_pack_for_each_subdivision(self):
        index = {
            "packs": [
                {
                    "id": "bc",
                    "countryCode": "CA",
                    "regionCode": "CA-BC",
                    "version": "1",
                    "generatedAt": "2026-07-30T00:00:00Z",
                    "url": "https://example.test/bc.zip",
                    "sha256": "a",
                },
                {
                    "id": "on",
                    "countryCode": "CA",
                    "regionCode": "CA-ON",
                    "version": "1",
                    "generatedAt": "2026-07-30T01:00:00Z",
                    "url": "https://example.test/on.zip",
                    "sha256": "b",
                },
            ],
        }

        packs = pipeline.select_map_packs(index, "CA", None)

        self.assertEqual(["bc", "on"], [pack["id"] for pack in packs])


class OpenBuildingFusionTests(unittest.TestCase):
    def test_external_building_is_promoted_and_named_from_terminal_anchor(self):
        result = {
            "center": [-123.18, 49.19],
            "features": [
                {
                    "kind": "terminal",
                    "name": "Terminal 1",
                    "label": "Terminal 1",
                    "points": [[-123.18, 49.19]],
                },
                *[
                    {
                        "kind": "gate",
                        "points": [[-123.1802 + index * 0.0001, 49.1901]],
                    }
                    for index in range(3)
                ],
            ],
        }
        building = {
            "type": "way",
            "id": "overture-1",
            "tags": {
                "building": "yes",
                "taxinow:source": "Overture Maps",
            },
            "geometry": [
                {"lon": -123.181, "lat": 49.1895},
                {"lon": -123.179, "lat": 49.1895},
                {"lon": -123.179, "lat": 49.1905},
                {"lon": -123.181, "lat": 49.1905},
                {"lon": -123.181, "lat": 49.1895},
            ],
        }

        promoted = skycharts.promote_terminal_buildings(
            [building],
            result,
            source_name="Overture Maps",
        )

        self.assertEqual(1, len(promoted))
        self.assertEqual("terminal", promoted[0]["tags"]["building"])
        self.assertEqual("Terminal 1", promoted[0]["tags"]["name"])

    def test_terminal_completeness_reports_uncovered_label(self):
        result = {
            "center": [0, 0],
            "features": [
                {
                    "kind": "terminal",
                    "name": "Terminal 2",
                    "points": [[0.02, 0.02]],
                },
                {
                    "kind": "terminal",
                    "name": "Terminal 1",
                    "points": [
                        [-0.001, -0.001],
                        [0.001, -0.001],
                        [0.001, 0.001],
                        [-0.001, 0.001],
                        [-0.001, -0.001],
                    ],
                },
            ],
        }

        metrics = skycharts.terminal_completeness_metrics(result)

        self.assertEqual(1, metrics["namedLabels"])
        self.assertEqual(0, metrics["coveredLabels"])

    def test_terminal_completeness_prefers_gates_over_remote_parking(self):
        terminal = {
            "kind": "terminal",
            "points": [
                [-0.001, -0.001],
                [0.001, -0.001],
                [0.001, 0.001],
                [-0.001, 0.001],
                [-0.001, -0.001],
            ],
        }
        result = {
            "center": [0, 0],
            "features": [
                terminal,
                *[
                    {
                        "kind": "gate",
                        "points": [[0.0001 * index, 0]],
                    }
                    for index in range(8)
                ],
                *[
                    {
                        "kind": "parking_position",
                        "points": [[0.05 + 0.001 * index, 0.05]],
                    }
                    for index in range(20)
                ],
            ],
        }

        metrics = skycharts.terminal_completeness_metrics(result)

        self.assertEqual(8, metrics["gateAnchors"])
        self.assertEqual(1.0, metrics["gateCoverage"])

    def test_terminal_completeness_ignores_fbo_company_point(self):
        result = {
            "center": [-123.18, 49.19],
            "features": [
                {
                    "kind": "terminal",
                    "name": "Jim Pattison Airways",
                    "points": [[-123.1577, 49.1804]],
                },
                {
                    "kind": "terminal",
                    "name": "Concourse A",
                    "points": [[-123.18, 49.19]],
                },
                {
                    "kind": "terminal",
                    "name": "Main Terminal",
                    "points": [
                        [-123.181, 49.189],
                        [-123.179, 49.189],
                        [-123.179, 49.191],
                        [-123.181, 49.191],
                        [-123.181, 49.189],
                    ],
                },
            ],
        }

        metrics = skycharts.terminal_completeness_metrics(result)

        self.assertEqual(1, metrics["namedLabels"])
        self.assertEqual(1, metrics["coveredLabels"])

    def test_terminal_name_is_propagated_to_nearby_unnamed_polygon(self):
        result = {
            "center": [0, 0],
            "features": [
                {
                    "kind": "terminal",
                    "name": "Terminal 2",
                    "label": "Terminal 2",
                    "points": [[0, 0]],
                },
                {
                    "kind": "terminal",
                    "points": [
                        [-0.001, -0.001],
                        [0.001, -0.001],
                        [0.001, 0.001],
                        [-0.001, 0.001],
                        [-0.001, -0.001],
                    ],
                },
            ],
        }

        skycharts.propagate_terminal_names(result)

        self.assertEqual(
            "Terminal 2",
            result["features"][1]["label"],
        )

    def test_building_part_is_not_added_over_complete_terminal(self):
        result = {
            "center": [0, 0],
            "features": [
                {
                    "kind": "terminal",
                    "name": "Terminal 1",
                    "points": [
                        [-0.002, -0.002],
                        [0.002, -0.002],
                        [0.002, 0.002],
                        [-0.002, 0.002],
                        [-0.002, -0.002],
                    ],
                },
                {
                    "kind": "gate",
                    "points": [[0, 0]],
                },
                {
                    "kind": "gate",
                    "points": [[0.0001, 0]],
                },
            ],
        }
        complete_terminal = {
            "type": "way",
            "id": "terminal",
            "tags": {"aeroway": "terminal"},
            "geometry": [
                {"lon": -0.002, "lat": -0.002},
                {"lon": 0.002, "lat": -0.002},
                {"lon": 0.002, "lat": 0.002},
                {"lon": -0.002, "lat": 0.002},
                {"lon": -0.002, "lat": -0.002},
            ],
        }
        building_part = {
            "type": "way",
            "id": "part",
            "tags": {
                "building": "yes",
                "taxinow:building_type": "building_part",
                "taxinow:source": "Overture Maps",
            },
            "geometry": [
                {"lon": -0.001, "lat": -0.001},
                {"lon": 0.001, "lat": -0.001},
                {"lon": 0.001, "lat": 0.001},
                {"lon": -0.001, "lat": 0.001},
                {"lon": -0.001, "lat": -0.001},
            ],
        }

        promoted = skycharts.promote_terminal_buildings(
            [complete_terminal, building_part],
            result,
            source_name="Overture Maps",
        )

        self.assertEqual([], promoted)


class MapPackBuilderTests(unittest.TestCase):
    def test_map_partitions_respect_airport_limit(self):
        maps = [
            (f"C{i:03d}", b"x" * 10)
            for i in range(5)
        ]

        partitions = map_pack_builder.partition_maps(
            maps,
            maximum_airports=2,
            maximum_uncompressed_bytes=1024 * 1024,
        )

        self.assertEqual([2, 2, 1], [len(value) for value in partitions])

    def test_overture_reader_marks_building_parts(self):
        feature = {
            "type": "Feature",
            "id": "part-1",
            "properties": {"names": {"primary": "Terminal 1"}},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 1],
                    [0, 0],
                ]],
            },
        }
        with tempfile.TemporaryDirectory() as temporary:
            path = pathlib.Path(temporary) / "part.geojson"
            path.write_text(
                json.dumps({
                    "type": "FeatureCollection",
                    "features": [feature],
                }),
                encoding="utf-8",
            )
            elements = map_pack_builder.read_overture_buildings(
                path,
                "building_part",
            )

        self.assertEqual("building_part", elements[0]["tags"]["taxinow:building_type"])
        self.assertEqual("Overture Maps", elements[0]["tags"]["taxinow:source"])

    def test_microsoft_quadkeys_cover_small_bbox(self):
        keys = map_pack_builder.quadkeys_for_bounds(
            (49.18, -123.20, 49.21, -123.16)
        )

        self.assertTrue(keys)
        self.assertTrue(all(len(value) == 9 for value in keys))


class GlobalMapPackPlannerTests(unittest.TestCase):
    def test_large_country_uses_complete_subdivision_extracts(self):
        airports = [
            pipeline.Airport(
                "KAAA",
                "A",
                "US",
                "US-CA",
                None,
                0,
                0,
                "large_airport",
            ),
            pipeline.Airport(
                "KBBB",
                "B",
                "US",
                "US-NY",
                None,
                0,
                0,
                "large_airport",
            ),
        ]
        records = [
            {
                "id": "us",
                "name": "United States",
                "countries": ["US"],
                "regions": [],
                "pbfUrl": "https://example.test/us.pbf",
            },
            {
                "id": "ca",
                "name": "California",
                "countries": [],
                "regions": ["US-CA"],
                "pbfUrl": "https://example.test/ca.pbf",
            },
            {
                "id": "ny",
                "name": "New York",
                "countries": [],
                "regions": ["US-NY"],
                "pbfUrl": "https://example.test/ny.pbf",
            },
        ]

        plan = global_map_pack_builder.create_plan(
            records,
            airports,
            split_threshold=1,
        )

        self.assertEqual(
            ["US-CA", "US-NY"],
            [region["regionCode"] for region in plan["regions"]],
        )

    def test_nearly_complete_subdivision_coverage_uses_country_fallback(self):
        airports = [
            pipeline.Airport(
                f"K{index:03d}",
                str(index),
                "US",
                region,
                None,
                0,
                0,
                "small_airport",
            )
            for index, region in enumerate(
                ["US-CA", "US-NY", "US-TX", "US-U-A"]
            )
        ]
        records = [
            {
                "id": "us",
                "name": "United States",
                "countries": ["US"],
                "regions": [],
                "pbfUrl": "https://example.test/us.pbf",
            },
            *[
                {
                    "id": region.lower(),
                    "name": region,
                    "countries": [],
                    "regions": [region],
                    "pbfUrl": f"https://example.test/{region}.pbf",
                }
                for region in ("US-CA", "US-NY", "US-TX")
            ],
        ]

        plan = global_map_pack_builder.create_plan(
            records,
            airports,
            split_threshold=1,
        )
        fallback = next(
            region for region in plan["regions"]
            if region["regionCode"] == "US-U-A"
        )

        self.assertEqual("country-fallback", fallback["extractScope"])
        self.assertEqual("https://example.test/us.pbf", fallback["pbfUrl"])


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

    def test_fused_sources_keep_individual_license_attribution(self):
        upgraded = pipeline.upgrade_skycharts_data(
            {
                "schemaVersion": 1,
                "ident": "CYVR",
                "name": "Vancouver International Airport",
                "source": (
                    "OpenStreetMap regional extract + Overture Maps + "
                    "Microsoft Global ML Building Footprints"
                ),
                "center": [-123.18, 49.19],
                "features": [
                    {
                        "kind": "runway",
                        "points": [
                            [-123.19, 49.18],
                            [-123.17, 49.20],
                        ],
                    }
                ],
            },
            "CA",
            "CA-BC",
            "Richmond",
        )

        licenses = {
            source["name"]: source["license"]
            for source in upgraded["sources"]
        }
        self.assertEqual(
            "ODbL 1.0",
            licenses["OpenStreetMap regional extract"],
        )
        self.assertEqual("ODbL 1.0", licenses["Overture Maps"])
        self.assertEqual(
            "CDLA Permissive 2.0",
            licenses["Microsoft Global ML Building Footprints"],
        )


if __name__ == "__main__":
    unittest.main()
