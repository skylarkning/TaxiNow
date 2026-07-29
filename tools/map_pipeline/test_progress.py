import pathlib
import tempfile
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


if __name__ == "__main__":
    unittest.main()
