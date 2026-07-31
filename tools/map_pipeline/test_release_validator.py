import hashlib
import json
import pathlib
import tempfile
import unittest

import validate_map_pack_release as validator


class MapPackReleaseValidatorTests(unittest.TestCase):
    def make_build(self, *, warnings=0, built=2):
        temporary = tempfile.TemporaryDirectory()
        root = pathlib.Path(temporary.name)
        output = root / "output"
        (output / "packs").mkdir(parents=True)
        (output / "quality").mkdir()
        plan = {
            "schemaVersion": 1,
            "regions": [{
                "id": "ca-bc",
                "countryCode": "CA",
                "regionCode": "CA-BC",
                "airportCount": 2,
            }],
        }
        plan_path = root / "plan.json"
        plan_path.write_text(json.dumps(plan), encoding="utf-8")
        payload = b"verified pack"
        archive = output / "packs" / "pack.zip"
        archive.write_bytes(payload)
        index = {
            "schemaVersion": 1,
            "updatedAt": "2026-07-30T00:00:00Z",
            "packs": [{
                "id": "ca-bc-v1",
                "countryCode": "CA",
                "regionCode": "CA-BC",
                "airportCount": built,
                "sizeBytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "url": "https://example.invalid/pack.zip",
            }],
        }
        (output / "index.json").write_text(
            json.dumps(index),
            encoding="utf-8",
        )
        (output / "failures.json").write_text("[]", encoding="utf-8")
        report = {
            "summary": {
                "selected": 2,
                "built": built,
                "rejected": 2 - built,
                "withWarnings": warnings,
            },
        }
        (output / "quality" / "ca-bc.json").write_text(
            json.dumps(report),
            encoding="utf-8",
        )
        return temporary, plan_path, output, index

    def test_accepts_complete_warning_free_region(self):
        temporary, plan, output, _ = self.make_build()
        self.addCleanup(temporary.cleanup)

        errors, _ = validator.validate_build(
            plan,
            output,
            {"CA-BC"},
        )

        self.assertEqual([], errors)

    def test_rejects_partial_or_warned_region(self):
        temporary, plan, output, _ = self.make_build(
            warnings=1,
            built=1,
        )
        self.addCleanup(temporary.cleanup)

        errors, _ = validator.validate_build(
            plan,
            output,
            {"CA-BC"},
        )

        self.assertTrue(any("built 1/2" in error for error in errors))
        self.assertTrue(any("quality warnings" in error for error in errors))

    def test_merged_index_replaces_only_matching_region(self):
        current = {
            "schemaVersion": 1,
            "packs": [
                {
                    "id": "old-ca-bc",
                    "countryCode": "CA",
                    "regionCode": "CA-BC",
                },
                {
                    "id": "keep-us-ca",
                    "countryCode": "US",
                    "regionCode": "US-CA",
                },
            ],
        }
        generated = {
            "schemaVersion": 1,
            "updatedAt": "now",
            "packs": [{
                "id": "new-ca-bc",
                "countryCode": "CA",
                "regionCode": "CA-BC",
            }],
        }

        merged = validator.merge_indexes(current, generated)

        self.assertEqual(
            ["new-ca-bc", "keep-us-ca"],
            sorted(
                (pack["id"] for pack in merged["packs"]),
                reverse=True,
            ),
        )


if __name__ == "__main__":
    unittest.main()
