import pathlib
import tempfile
import threading
import time
import unittest
from unittest import mock

import taxinow_map_pipeline as pipeline


class CapturingProtocol(pipeline.Protocol):
    def __init__(self):
        super().__init__({"requestId": "test"})
        self.events = []

    def emit(self, event, **payload):
        self.events.append({"event": event, **payload})


class DownloadProgressTests(unittest.TestCase):
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
