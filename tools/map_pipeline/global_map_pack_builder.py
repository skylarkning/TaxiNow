#!/usr/bin/env python3
"""Plan and run TaxiNow's global regional-map preprocessing pipeline.

The planner combines the Geofabrik extract index with TaxiNow's bundled
OurAirports catalog. Large countries are split by ISO 3166-2 subdivision only
when Geofabrik provides complete matching subdivision coverage; other
countries use one country extract. The builder is resumable at region level
and produces a merged client index for release publication.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import sys
import urllib.request

import map_pack_builder
import taxinow_map_pipeline as pipeline


def download_json(url: str, path: pathlib.Path) -> dict:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(
            url,
            headers={"User-Agent": pipeline.USER_AGENT},
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            pipeline.atomic_write(path, response.read())
    return json.loads(path.read_text(encoding="utf-8"))


def property_codes(value) -> list[str]:
    if isinstance(value, list):
        return [str(item).upper() for item in value if item]
    if value:
        return [str(value).upper()]
    return []


def geofabrik_records(index: dict) -> list[dict]:
    records = []
    for feature in index.get("features") or []:
        properties = feature.get("properties") or {}
        pbf_url = (properties.get("urls") or {}).get("pbf")
        if not pbf_url:
            continue
        records.append({
            "id": str(properties.get("id") or ""),
            "name": str(properties.get("name") or ""),
            "countries": property_codes(
                properties.get("iso3166-1:alpha2")
            ),
            "regions": property_codes(
                properties.get("iso3166-2")
            ),
            "pbfUrl": str(pbf_url),
        })
    return records


def create_plan(
    records: list[dict],
    airports: list[pipeline.Airport],
    countries: set[str] | None = None,
    split_threshold: int = 400,
) -> dict:
    by_country: dict[str, list[pipeline.Airport]] = {}
    for airport in airports:
        if countries and airport.country_code not in countries:
            continue
        by_country.setdefault(airport.country_code, []).append(airport)

    planned = []
    unavailable = []
    for country_code, country_airports in sorted(by_country.items()):
        country_extracts = [
            record for record in records
            if country_code in record["countries"]
        ]
        country_extract = (
            min(
                country_extracts,
                key=lambda value: (
                    value["id"].count("/"),
                    len(value["id"]),
                ),
            )
            if country_extracts
            else None
        )
        subdivisions = {
            region: record
            for record in records
            for region in record["regions"]
            if region.startswith(country_code + "-")
        }
        used_regions = {
            airport.region_code
            for airport in country_airports
            if airport.region_code
        }
        covered_regions = used_regions.intersection(subdivisions)
        can_split = (
            len(country_airports) > split_threshold
            and used_regions
            and country_extract is not None
            and len(covered_regions) / len(used_regions) >= 0.75
        )
        if can_split:
            for region_code in sorted(used_regions):
                region_airports = [
                    airport for airport in country_airports
                    if airport.region_code == region_code
                ]
                record = subdivisions.get(region_code) or country_extract
                planned.append({
                    "id": region_code.lower(),
                    "name": record["name"] or region_code,
                    "countryCode": country_code,
                    "regionCode": region_code,
                    "airportCount": len(region_airports),
                    "pbfUrl": record["pbfUrl"],
                    "extractScope": (
                        "subdivision"
                        if region_code in subdivisions
                        else "country-fallback"
                    ),
                })
            continue
        if country_extract is not None:
            record = country_extract
            planned.append({
                "id": country_code.lower(),
                "name": record["name"] or country_code,
                "countryCode": country_code,
                "regionCode": None,
                "airportCount": len(country_airports),
                "pbfUrl": record["pbfUrl"],
                "extractScope": "country",
            })
        else:
            unavailable.append({
                "countryCode": country_code,
                "airportCount": len(country_airports),
                "reason": "No matching Geofabrik PBF extract",
            })
    return {
        "schemaVersion": 1,
        "generatedAt": map_pack_builder.iso_now(),
        "splitThreshold": split_threshold,
        "regions": planned,
        "unavailable": unavailable,
        "summary": {
            "countries": len(by_country),
            "regions": len(planned),
            "airports": sum(
                region["airportCount"] for region in planned
            ),
            "unavailableCountries": len(unavailable),
        },
    }


def safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-")


def build_region(
    region: dict,
    *,
    source_root: pathlib.Path,
    maps_root: pathlib.Path,
    packs_root: pathlib.Path,
    metadata_root: pathlib.Path,
    reports_root: pathlib.Path,
    version: str,
    with_overture: bool,
    with_microsoft: bool,
    maximum_airports: int,
    force_airports: bool,
) -> list[dict]:
    selector = str(
        region["regionCode"] or region["countryCode"]
    ).upper()
    identifier = safe_name(str(region["id"]).lower())
    metadata_path = metadata_root / f"{identifier}.json"
    pbf_url = str(region["pbfUrl"])
    pbf_path = source_root / pathlib.Path(
        pbf_url.split("?", 1)[0]
    ).name
    if not pbf_path.exists():
        map_pack_builder.download_resumable(pbf_url, pbf_path)
    pack_output = packs_root / (
        f"TaxiNow-MapPack-{selector}-{version}.zip"
    )
    arguments = [
        sys.executable,
        str(pathlib.Path(__file__).with_name("map_pack_builder.py")),
        "from-geofabrik",
        "--pbf",
        str(pbf_path),
        "--maps-directory",
        str(maps_root / identifier),
        "--output",
        str(pack_output),
        "--metadata-output",
        str(metadata_path),
        "--quality-report",
        str(reports_root / f"{identifier}.json"),
        "--id",
        f"{identifier}-{version}",
        "--version",
        version,
        "--country",
        str(region["countryCode"]),
        "--max-airports-per-pack",
        str(maximum_airports),
    ]
    if region.get("regionCode"):
        arguments.extend(["--region", str(region["regionCode"])])
    if with_overture:
        arguments.append("--with-overture")
    if with_microsoft:
        arguments.append("--with-microsoft")
    if force_airports:
        arguments.append("--force-airports")
    subprocess.run(arguments, check=True)
    return json.loads(metadata_path.read_text(encoding="utf-8"))


def completed_region_is_current(
    metadata_path: pathlib.Path,
    quality_path: pathlib.Path,
) -> bool:
    """Return true only for a package produced by the current map pipeline."""
    if not metadata_path.is_file() or not quality_path.is_file():
        return False
    try:
        report = json.loads(quality_path.read_text(encoding="utf-8"))
        return int(report.get("pipelineRevision") or 0) >= (
            map_pack_builder.MAP_BUILD_PIPELINE_REVISION
        )
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        return False


def build_plan(
    plan: dict,
    output: pathlib.Path,
    version: str,
    base_url: str,
    only: set[str],
    with_overture: bool,
    with_microsoft: bool,
    force: bool,
    maximum_airports: int,
) -> dict:
    source_root = output / "source"
    maps_root = output / "maps"
    packs_root = output / "packs"
    metadata_root = output / "metadata"
    reports_root = output / "quality"
    for path in (
        source_root,
        maps_root,
        packs_root,
        metadata_root,
        reports_root,
    ):
        path.mkdir(parents=True, exist_ok=True)

    entries = []
    failures = []
    for region in plan.get("regions") or []:
        selector = str(region["regionCode"] or region["countryCode"]).upper()
        if only and selector not in only:
            continue
        identifier = safe_name(str(region["id"]).lower())
        metadata_path = metadata_root / f"{identifier}.json"
        quality_path = reports_root / f"{identifier}.json"
        if (
            not force
            and completed_region_is_current(metadata_path, quality_path)
        ):
            entries.extend(
                json.loads(metadata_path.read_text(encoding="utf-8"))
            )
            continue
        try:
            entries.extend(
                build_region(
                    region,
                    source_root=source_root,
                    maps_root=maps_root,
                    packs_root=packs_root,
                    metadata_root=metadata_root,
                    reports_root=reports_root,
                    version=version,
                    with_overture=with_overture,
                    with_microsoft=with_microsoft,
                    maximum_airports=maximum_airports,
                    force_airports=force,
                )
            )
        except Exception as error:
            failures.append({
                "id": identifier,
                "countryCode": region["countryCode"],
                "regionCode": region.get("regionCode"),
                "error": str(error),
            })
            print(
                f"Skipping failed preprocessing region {selector}: {error}",
                file=sys.stderr,
            )

    index = map_pack_builder.map_pack_index(entries, base_url)
    index["planGeneratedAt"] = plan.get("generatedAt")
    index["qualityReports"] = "quality/"
    index["failedRegions"] = len(failures)
    (output / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (output / "failures.json").write_text(
        json.dumps(failures, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return index


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    planner = subparsers.add_parser("plan")
    planner.add_argument("--output", required=True, type=pathlib.Path)
    planner.add_argument("--country", action="append")
    planner.add_argument("--split-threshold", type=int, default=400)
    planner.add_argument(
        "--geofabrik-index",
        default=map_pack_builder.GEOFABRIK_INDEX_URL,
    )

    builder = subparsers.add_parser("build")
    builder.add_argument("--plan", required=True, type=pathlib.Path)
    builder.add_argument("--output", required=True, type=pathlib.Path)
    builder.add_argument("--version", required=True)
    builder.add_argument("--base-url", required=True)
    builder.add_argument("--only", action="append")
    builder.add_argument("--skip-overture", action="store_true")
    builder.add_argument("--skip-microsoft", action="store_true")
    builder.add_argument("--force", action="store_true")
    builder.add_argument(
        "--max-airports-per-pack",
        type=int,
        default=250,
    )
    return parser.parse_args()


def main() -> None:
    args = parse_arguments()
    if args.command == "plan":
        cache = pipeline.SourceCache(args.output.parent / "catalog-cache")
        airports = pipeline.load_airports(cache)
        index = download_json(
            args.geofabrik_index,
            args.output.parent / "geofabrik-index.json",
        )
        plan = create_plan(
            geofabrik_records(index),
            airports,
            {
                value.strip().upper()
                for value in args.country or []
                if value.strip()
            }
            or None,
            args.split_threshold,
        )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(plan, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(json.dumps(plan["summary"], indent=2))
        return
    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    index = build_plan(
        plan,
        args.output,
        args.version,
        args.base_url,
        {
            value.strip().upper()
            for value in args.only or []
            if value.strip()
        },
        not args.skip_overture,
        not args.skip_microsoft,
        args.force,
        args.max_airports_per_pack,
    )
    print(json.dumps({
        "packs": len(index["packs"]),
        "airports": sum(
            int(pack.get("airportCount") or 0)
            for pack in index["packs"]
        ),
    }, indent=2))


if __name__ == "__main__":
    main()
