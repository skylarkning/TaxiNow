import os
import pathlib
import subprocess
import tempfile
import time
import unittest
from unittest import mock

import map_pack_builder


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


if __name__ == "__main__":
    unittest.main()
