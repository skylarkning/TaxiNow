#!/usr/bin/env python3
"""Validate locally generated TaxiNow map packs before publication.

The validator always blocks damaged archives and failed regions. A controlled
publication policy may permit a very small number of explicitly recorded
airport omissions and non-blocking quality warnings; omitted airports remain
available through TaxiNow's normal per-airport source fallback.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import urllib.error
import urllib.request
from typing import Any


DEFAULT_RELEASE_REPOSITORY = "skylarkning/TaxiNow-Release"
DEFAULT_PUBLIC_INDEX_URL = (
    "https://raw.githubusercontent.com/"
    "skylarkning/TaxiNow-Release/main/map-packs/index.json"
)


def load_json(path: pathlib.Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def selected_regions(
    plan: dict[str, Any],
    only: set[str],
) -> list[dict[str, Any]]:
    regions = [
        region
        for region in plan.get("regions") or []
        if isinstance(region, dict)
    ]
    if not only:
        return regions
    return [
        region
        for region in regions
        if str(
            region.get("regionCode") or region.get("countryCode") or ""
        ).upper()
        in only
    ]


def region_identifier(region: dict[str, Any]) -> str:
    value = str(region.get("id") or "").lower()
    return "".join(
        character if character.isalnum() or character in "_.-" else "-"
        for character in value
    ).strip("-")


def validate_build(
    plan_path: pathlib.Path,
    output: pathlib.Path,
    only: set[str] | None = None,
    max_rejected_airports: int = 0,
    max_rejected_percent: float = 0.0,
    allow_quality_warnings: bool = False,
) -> tuple[list[str], dict[str, Any] | None]:
    errors: list[str] = []
    only = {value.upper() for value in only or set()}
    try:
        plan = load_json(plan_path)
    except (OSError, json.JSONDecodeError) as error:
        return [f"Plan cannot be read: {error}"], None

    try:
        index = load_json(output / "index.json")
    except (OSError, json.JSONDecodeError) as error:
        return [f"Generated index cannot be read: {error}"], None

    failures_path = output / "failures.json"
    try:
        failures = load_json(failures_path)
    except (OSError, json.JSONDecodeError) as error:
        errors.append(f"Failure report cannot be read: {error}")
        failures = []
    if failures:
        errors.append(
            f"{len(failures)} preprocessing region(s) failed; "
            "partial releases are not publishable."
        )

    regions = selected_regions(plan, only)
    if not regions:
        errors.append("The plan contains no matching region to publish.")

    expected_airports = 0
    built_airports = 0
    for region in regions:
        expected = int(region.get("airportCount") or 0)
        expected_airports += expected
        report_path = (
            output
            / "quality"
            / f"{region_identifier(region)}.json"
        )
        try:
            report = load_json(report_path)
        except (OSError, json.JSONDecodeError) as error:
            errors.append(
                f"{report_path.name} is missing or invalid: {error}"
            )
            continue
        summary = report.get("summary") or {}
        selected = int(summary.get("selected") or 0)
        built = int(summary.get("built") or 0)
        rejected = int(summary.get("rejected") or 0)
        warnings = int(summary.get("withWarnings") or 0)
        built_airports += built
        selector = str(
            region.get("regionCode") or region.get("countryCode") or ""
        )
        if selected != expected:
            errors.append(
                f"{selector}: plan lists {expected} airports but the "
                f"quality report examined {selected}."
            )
        if built + rejected != selected:
            errors.append(
                f"{selector}: quality totals are inconsistent: "
                f"{built} built + {rejected} rejected != {selected} selected."
            )
        rejected_percent = (
            rejected * 100.0 / expected if expected else 100.0
        )
        if rejected and (
            rejected > max_rejected_airports
            or rejected_percent > max_rejected_percent
        ):
            errors.append(
                f"{selector}: built {built}/{expected} airports with "
                f"{rejected} rejected ({rejected_percent:.2f}%); policy "
                f"allows at most {max_rejected_airports} and "
                f"{max_rejected_percent:.2f}%."
            )
        if warnings and not allow_quality_warnings:
            errors.append(
                f"{selector}: {warnings} airport map(s) still have "
                "quality warnings."
            )

    packs = [
        pack
        for pack in index.get("packs") or []
        if isinstance(pack, dict)
    ]
    if not packs:
        errors.append("No map packs were generated.")
    indexed_airports = sum(
        int(pack.get("airportCount") or 0) for pack in packs
    )
    if indexed_airports != built_airports:
        errors.append(
            f"The index contains {indexed_airports} airports but quality "
            f"reports show {built_airports} built."
        )
    for pack in packs:
        file_name = pathlib.Path(str(pack.get("url") or "")).name
        if not file_name:
            file_name = str(pack.get("fileName") or "")
        archive = output / "packs" / file_name
        if not archive.is_file():
            errors.append(f"Pack archive is missing: {file_name}")
            continue
        expected_size = int(pack.get("sizeBytes") or 0)
        if archive.stat().st_size != expected_size:
            errors.append(
                f"{file_name}: expected {expected_size} bytes, found "
                f"{archive.stat().st_size}."
            )
        expected_hash = str(pack.get("sha256") or "").lower()
        if not expected_hash or sha256_file(archive) != expected_hash:
            errors.append(f"{file_name}: SHA-256 verification failed.")
    return errors, index


def read_public_index(url: str) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "TaxiNow-map-pack-publisher/1.0",
            "Cache-Control": "no-cache",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except (
        OSError,
        urllib.error.URLError,
        UnicodeDecodeError,
        json.JSONDecodeError,
    ):
        return {"schemaVersion": 1, "packs": []}


def merge_indexes(
    current: dict[str, Any],
    generated: dict[str, Any],
) -> dict[str, Any]:
    replacements = {
        (
            str(pack.get("countryCode") or "").upper(),
            str(pack.get("regionCode") or "").upper(),
        )
        for pack in generated.get("packs") or []
        if isinstance(pack, dict)
    }
    retained = [
        pack
        for pack in current.get("packs") or []
        if isinstance(pack, dict)
        and (
            str(pack.get("countryCode") or "").upper(),
            str(pack.get("regionCode") or "").upper(),
        )
        not in replacements
    ]
    combined = retained + [
        pack
        for pack in generated.get("packs") or []
        if isinstance(pack, dict)
    ]
    combined.sort(
        key=lambda pack: (
            str(pack.get("countryCode") or ""),
            str(pack.get("regionCode") or ""),
            str(pack.get("id") or ""),
        )
    )
    return {
        "schemaVersion": 1,
        "updatedAt": generated.get("updatedAt"),
        "packs": combined,
    }


def publishing_instructions(
    repository: str,
    release_tag: str,
    output: pathlib.Path,
    pack_names: list[str],
    quality_notes: list[str],
) -> str:
    uploads = " ".join(
        f'"{(output / "packs" / name).resolve()}"'
        for name in pack_names
    )
    publish_index = (output / "index.publish.json").resolve()
    notes = (
        "\n".join(f"- {note}" for note in quality_notes)
        if quality_notes
        else "- No airport omissions or quality warnings."
    )
    return f"""# Publish TaxiNow regional map packs

The local quality gate passed. Publish in this order so clients never see an
index entry before its ZIP exists.

## Recorded quality notes

{notes}

Airport omissions listed here are intentional source-data exceptions. TaxiNow
can still acquire those airports individually through its normal source
fallback instead of invalidating the complete regional package.

## 1. Upload immutable ZIP files to the release

Confirm that `{release_tag}` exists in
`https://github.com/{repository}/releases`.

```powershell
gh release view "{release_tag}" --repo "{repository}"
gh release upload "{release_tag}" {uploads} --repo "{repository}"
```

Do not use `--clobber` for a published pack version. If bytes change, generate
a new version and filename so cached SHA-256 metadata remains valid.

## 2. Publish the merged client index

The generated file below retains unrelated packs already present in the public
index and replaces only the country/subdivision built in this run:

`{publish_index}`

Clone or update `https://github.com/{repository}`, replace
`map-packs/index.json` with `index.publish.json`, review the diff, then commit
and push directly to `main`:

```powershell
Copy-Item -LiteralPath "{publish_index}" `
  -Destination ".\\map-packs\\index.json"
git diff --check
git diff -- map-packs/index.json
git add map-packs/index.json
git commit -m "Publish TaxiNow regional map packs {release_tag}"
git push origin main
```

## 3. Verify publication

Open:

- `https://github.com/{repository}/releases/tag/{release_tag}`
- `https://raw.githubusercontent.com/{repository}/main/map-packs/index.json`

Verify every uploaded ZIP name appears in the public index. TaxiNow refreshes
the public index periodically and then downloads these checksum-verified ZIPs.
"""


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True, type=pathlib.Path)
    parser.add_argument("--output", required=True, type=pathlib.Path)
    parser.add_argument("--only", action="append")
    parser.add_argument("--release-tag", required=True)
    parser.add_argument(
        "--release-repository",
        default=DEFAULT_RELEASE_REPOSITORY,
    )
    parser.add_argument(
        "--public-index-url",
        default=DEFAULT_PUBLIC_INDEX_URL,
    )
    parser.add_argument("--max-rejected-airports", type=int, default=0)
    parser.add_argument("--max-rejected-percent", type=float, default=0.0)
    parser.add_argument("--allow-quality-warnings", action="store_true")
    return parser.parse_args()


def collect_quality_notes(
    plan: dict[str, Any],
    output: pathlib.Path,
    only: set[str],
) -> list[str]:
    notes: list[str] = []
    for region in selected_regions(plan, only):
        selector = str(
            region.get("regionCode") or region.get("countryCode") or ""
        )
        report_path = output / "quality" / f"{region_identifier(region)}.json"
        try:
            report = load_json(report_path)
        except (OSError, json.JSONDecodeError):
            continue
        rejected = [
            airport for airport in report.get("airports") or []
            if isinstance(airport, dict)
            and airport.get("status") == "rejected"
        ]
        for airport in rejected:
            reasons = "; ".join(
                str(value) for value in airport.get("errors") or []
            ) or "source geometry was not publishable"
            notes.append(
                f"{selector} omits {airport.get('icao')}: {reasons}"
            )
        warning_count = int(
            (report.get("summary") or {}).get("withWarnings") or 0
        )
        if warning_count:
            notes.append(
                f"{selector} includes {warning_count} usable airport map(s) "
                "with non-blocking source-data quality warnings; see "
                f"quality/{report_path.name}."
            )
    return notes


def main() -> int:
    args = parse_arguments()
    only = {
        value.strip().upper()
        for value in args.only or []
        if value.strip()
    }
    errors, generated = validate_build(
        args.plan,
        args.output,
        only,
        args.max_rejected_airports,
        args.max_rejected_percent,
        args.allow_quality_warnings,
    )
    failed_path = args.output / "VALIDATION-FAILED.txt"
    if errors or generated is None:
        failed_path.write_text(
            "Map packs are NOT ready to publish.\n\n"
            + "\n".join(f"- {error}" for error in errors)
            + "\n",
            encoding="utf-8",
        )
        print(failed_path.read_text(encoding="utf-8"))
        return 2

    failed_path.unlink(missing_ok=True)
    current = read_public_index(args.public_index_url)
    plan = load_json(args.plan)
    quality_notes = collect_quality_notes(plan, args.output, only)
    merged = merge_indexes(current, generated)
    publish_index_path = args.output / "index.publish.json"
    publish_index_path.write_text(
        json.dumps(merged, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    pack_names = [
        pathlib.Path(str(pack.get("url") or "")).name
        or str(pack.get("fileName") or "")
        for pack in generated.get("packs") or []
    ]
    instructions_path = args.output / "PUBLISHING.md"
    instructions_path.write_text(
        publishing_instructions(
            args.release_repository,
            args.release_tag,
            args.output,
            pack_names,
            quality_notes,
        ),
        encoding="utf-8",
    )
    print("Map packs passed the controlled local publication gate.")
    for note in quality_notes:
        print(f"QUALITY NOTE: {note}")
    print(f"Merged index: {publish_index_path}")
    print(f"Instructions: {instructions_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
