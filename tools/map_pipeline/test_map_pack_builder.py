import os
import pathlib
import subprocess
import tempfile
import time
import unittest
from unittest import mock

import map_pack_builder
import skycharts_airport_map as skycharts


class OsmiumLauncherTests(unittest.TestCase):
    @mock.patch("map_pack_builder.subprocess.run")
    @mock.patch(
        "map_pack_builder.shutil.which",
        return_value=r"C:\environment\Library\bin\osmium.exe",
    )
    def test_requests_lowercase_windows_executable_name(
        self,
        which,
        run,
    ):
        run.return_value = subprocess.CompletedProcess([], 0)

        map_pack_builder.run_osmium(["--version"])

        which.assert_called_once_with("osmium.exe")
        run.assert_called_once_with(
            [
                r"C:\environment\Library\bin\osmium.exe",
                "--version",
            ],
            check=True,
        )

    @mock.patch(
        "map_pack_builder.shutil.which",
        return_value=r"C:\environment\Library\bin\osmium.exe",
    )
    @mock.patch("map_pack_builder.subprocess.run")
    def test_readable_cache_uses_fileinfo(self, run, which):
        run.return_value = subprocess.CompletedProcess([], 0)
        with tempfile.TemporaryDirectory() as temporary:
            path = pathlib.Path(temporary) / "airport-features.osm.pbf"
            path.write_bytes(b"pbf")

            self.assertTrue(map_pack_builder.osmium_file_is_readable(path))

        which.assert_called_once_with("osmium.exe")
        self.assertEqual("fileinfo", run.call_args.args[0][1])

    @mock.patch(
        "map_pack_builder.osmium_file_is_readable",
        return_value=True,
    )
    def test_cache_must_not_precede_source(self, readable):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            source = root / "country.osm.pbf"
            cache = root / "country.airports.osm.pbf"
            source.write_bytes(b"new source")
            cache.write_bytes(b"old cache")
            now = time.time_ns()
            os.utime(
                cache,
                ns=(now - 2_000_000_000, now - 2_000_000_000),
            )
            os.utime(source, ns=(now, now))

            self.assertFalse(
                map_pack_builder.osmium_cache_is_current(source, cache)
            )

        readable.assert_called_once_with(cache)


class AirportGeometrySanitizerTests(unittest.TestCase):
    def test_discards_only_incomplete_area_fragments(self):
        runway = {
            "kind": "runway",
            "points": [[1.0, 1.0], [2.0, 2.0]],
        }
        valid_terminal = {
            "kind": "terminal",
            "points": [
                [1.0, 1.0],
                [1.0, 2.0],
                [2.0, 2.0],
                [1.0, 1.0],
            ],
        }
        open_apron = {
            "kind": "apron",
            "points": [[1.0, 1.0], [1.0, 2.0], [2.0, 2.0]],
        }

        result = skycharts.discard_incomplete_polygon_features(
            [runway, valid_terminal, open_apron]
        )

        self.assertEqual([runway, valid_terminal], result)


if __name__ == "__main__":
    unittest.main()
