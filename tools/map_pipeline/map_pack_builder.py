#!/usr/bin/env python3
"""Build verified TaxiNow regional map packs.

The normal release workflow builds schema-v2 airport JSON files from a local
OSM extract, then packages them with ``from-maps``. ``from-geofabrik`` uses the
external ``osmium`` command to filter a Geofabrik PBF locally; it never sends
per-airport requests to a public Overpass instance.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile
from datetime import datetime, timezone

import skycharts_airport_map as skycharts
import taxinow_map_pipeline as pipeline


PACK_SCHEMA_VERSION = 1
PACK_SOURCE_REVISION = 1


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def read_schema_v2_maps(
    roots: list[pathlib.Path],
    country_code: str,
    region_code: str | None,
) -> list[tuple[str, bytes]]:
    selected: dict[str, bytes] = {}
    for root in roots:
        paths = [root] if root.is_file() else sorted(root.glob("*.json"))
        for path in paths:
            payload = path.read_bytes()
            value = json.loads(payload.decode("utf-8"))
            airport = value.get("airport") or {}
            icao = str(airport.get("icao") or "").strip().upper()
            if (
                int(value.get("schemaVersion") or 0) != 2
                or len(icao) != 4
                or str(airport.get("countryCode") or "").upper()
                != country_code.upper()
                or (
                    region_code
                    and str(airport.get("regionCode") or "").upper()
                    != region_code.upper()
                )
            ):
                continue
            selected[icao] = payload
    return sorted(selected.items())


def build_pack(
    maps: list[tuple[str, bytes]],
    output: pathlib.Path,
    pack_id: str,
    version: str,
    country_code: str,
    region_code: str | None,
    source_note: str,
) -> dict:
    if not maps:
        raise RuntimeError("No matching schema-v2 airport maps were found.")
    generated = iso_now()
    manifest = {
        "schemaVersion": PACK_SCHEMA_VERSION,
        "id": pack_id,
        "version": version,
        "countryCode": country_code.upper(),
        "regionCode": region_code.upper() if region_code else None,
        "generatedAt": generated,
        "sourceRevision": PACK_SOURCE_REVISION,
        "sourceNote": source_note,
        "maps": [
            {
                "icao": icao,
                "path": f"maps/{icao}.json",
                "sha256": sha256_bytes(payload),
                "sizeBytes": len(payload),
            }
            for icao, payload in maps
        ],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{output.name}.",
        suffix=".tmp",
        dir=output.parent,
    )
    os.close(descriptor)
    temporary = pathlib.Path(temporary_name)
    try:
        with zipfile.ZipFile(
            temporary,
            "w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=9,
        ) as archive:
            archive.writestr(
                "manifest.json",
                json.dumps(
                    manifest,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ).encode("utf-8"),
            )
            for icao, payload in maps:
                archive.writestr(f"maps/{icao}.json", payload)
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)
    return {
        "id": pack_id,
        "version": version,
        "countryCode": country_code.upper(),
        "regionCode": region_code.upper() if region_code else None,
        "airportCount": len(maps),
        "icaos": [icao for icao, _ in maps],
        "sizeBytes": output.stat().st_size,
        "sha256": pipeline.sha256_file(output),
        "fileName": output.name,
        "generatedAt": generated,
    }


def download_resumable(url: str, destination: pathlib.Path) -> pathlib.Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".part")
    offset = partial.stat().st_size if partial.exists() else 0
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": pipeline.USER_AGENT,
            **({"Range": f"bytes={offset}-"} if offset else {}),
        },
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        append = offset > 0 and getattr(
            response,
            "status",
            response.getcode(),
        ) == 206
        with partial.open("ab" if append else "wb") as stream:
            shutil.copyfileobj(response, stream, length=1024 * 1024)
    os.replace(partial, destination)
    return destination


def run_osmium(arguments: list[str]) -> None:
    executable = shutil.which("osmium")
    if not executable:
        raise RuntimeError(
            "The osmium command is required for from-geofabrik. "
            "Install osmium-tool in the maintainer build environment."
        )
    subprocess.run([executable, *arguments], check=True)


def geojson_geometry_elements(feature: dict, index: int) -> list[dict]:
    properties = dict(feature.get("properties") or {})
    geometry = feature.get("geometry") or {}
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates") or []
    tags = {
        key: value for key, value in properties.items()
        if not str(key).startswith("@") and value not in (None, "")
    }
    identity = properties.get("@id") or feature.get("id") or index
    if geometry_type == "Point":
        return [{
            "type": "node",
            "id": f"osmium-{identity}",
            "tags": tags,
            "lon": coordinates[0],
            "lat": coordinates[1],
        }]
    if geometry_type == "LineString":
        geometries = [coordinates]
    elif geometry_type == "Polygon":
        geometries = coordinates[:1]
    elif geometry_type == "MultiPolygon":
        geometries = [polygon[0] for polygon in coordinates if polygon]
    else:
        return []
    return [
        {
            "type": "way",
            "id": f"osmium-{identity}-{part}",
            "tags": tags,
            "geometry": [
                {"lon": point[0], "lat": point[1]}
                for point in values
                if len(point) >= 2
            ],
        }
        for part, values in enumerate(geometries)
    ]


def read_geojson_sequence(path: pathlib.Path) -> list[dict]:
    elements = []
    with path.open(encoding="utf-8") as stream:
        for index, line in enumerate(stream):
            line = line.strip()
            if line:
                elements.extend(
                    geojson_geometry_elements(json.loads(line), index)
                )
    return elements


def read_overture_buildings(path: pathlib.Path) -> list[dict]:
    collection = json.loads(path.read_text(encoding="utf-8"))
    elements = []
    for index, feature in enumerate(collection.get("features") or []):
        converted = geojson_geometry_elements(feature, index)
        names = (feature.get("properties") or {}).get("names") or {}
        for element in converted:
            tags = dict(element.get("tags") or {})
            tags["building"] = "yes"
            primary_name = (
                names.get("primary")
                if isinstance(names, dict)
                else None
            )
            if primary_name:
                tags["name"] = primary_name
            tags["taxinow:source"] = "Overture Maps"
            element["tags"] = tags
            elements.append(element)
    return elements


def download_overture_buildings(
    bounds: tuple[float, float, float, float],
    output: pathlib.Path,
) -> list[dict]:
    executable = shutil.which("overturemaps")
    if not executable:
        raise RuntimeError(
            "The overturemaps command is required with --with-overture."
        )
    south, west, north, east = bounds
    subprocess.run(
        [
            executable,
            "download",
            "--bbox",
            f"{west},{south},{east},{north}",
            "-f",
            "geojson",
            "--type",
            "building",
            "-o",
            str(output),
        ],
        check=True,
    )
    return read_overture_buildings(output)


def bundled_catalog_path(name: str, work: pathlib.Path) -> pathlib.Path:
    target = work / name
    bundled = pathlib.Path(__file__).resolve().parent / "data" / f"{name}.gz"
    if not bundled.exists():
        raise RuntimeError(f"Bundled catalog is missing: {bundled}")
    target.write_bytes(gzip.decompress(bundled.read_bytes()))
    return target


def build_maps_from_geofabrik(
    pbf: pathlib.Path,
    maps_directory: pathlib.Path,
    country_code: str,
    region_code: str | None,
    with_overture: bool = False,
) -> None:
    maps_directory.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="taxinow-pack-") as temporary:
        work = pathlib.Path(temporary)
        airports_csv = bundled_catalog_path("airports.csv", work)
        runways_csv = bundled_catalog_path("runways.csv", work)
        cache = pipeline.SourceCache(work / "catalog-cache")
        catalog = pipeline.load_airports(cache)
        selected = [
            airport for airport in catalog
            if airport.country_code == country_code.upper()
            and (
                not region_code
                or airport.region_code == region_code.upper()
            )
        ]
        filtered = work / "airport-features.osm.pbf"
        run_osmium([
            "tags-filter",
            str(pbf),
            "nwr/aeroway",
            "nwr/building",
            "-o",
            str(filtered),
            "--overwrite",
        ])
        skycharts.ROOT = work
        skycharts_work = work / "work"
        skycharts_work.mkdir(parents=True, exist_ok=True)
        shutil.copy2(
            airports_csv,
            skycharts_work / "ourairports-airports.csv",
        )
        shutil.copy2(
            runways_csv,
            skycharts_work / "ourairports-runways.csv",
        )
        for airport in selected:
            airport_record = {
                "ident": airport.icao,
                "name": airport.name,
                "latitude": airport.latitude,
                "longitude": airport.longitude,
                "country_code": airport.country_code,
            }
            runway_raw = skycharts.ourairports_runway_raw(
                airport.icao,
                airport_record,
            )
            south, west, north, east = skycharts.airport_query_bounds(
                airport_record,
                runway_raw,
            )
            extract = work / f"{airport.icao}.osm.pbf"
            sequence = work / f"{airport.icao}.geojsonseq"
            run_osmium([
                "extract",
                "--bbox",
                f"{west},{south},{east},{north}",
                str(filtered),
                "-o",
                str(extract),
                "--overwrite",
            ])
            run_osmium([
                "export",
                str(extract),
                "-f",
                "geojsonseq",
                "-o",
                str(sequence),
                "--overwrite",
            ])
            elements = read_geojson_sequence(sequence)
            if runway_raw.get("elements"):
                elements = skycharts.merge_osm_elements(
                    elements,
                    runway_raw["elements"],
                )
            try:
                normalized = skycharts.normalize(
                    {"elements": elements},
                    airport_record,
                    source="OpenStreetMap regional extract + OurAirports",
                )
            except skycharts.AirportMapError:
                continue
            promoted = skycharts.promote_osm_terminal_buildings(
                elements,
                normalized,
            )
            if promoted:
                elements = skycharts.merge_osm_elements(elements, promoted)
                normalized = skycharts.normalize(
                    {"elements": elements},
                    airport_record,
                    source="OpenStreetMap regional extract + OurAirports",
                )
            if airport.country_code == "US":
                counts = normalized.get("counts") or {}
                faa_kinds = []
                if skycharts.needs_terminal_supplement(normalized):
                    faa_kinds.append("building")
                if (
                    counts.get("taxiway", 0)
                    + counts.get("taxilane", 0)
                    == 0
                ):
                    faa_kinds.append("taxiway")
                if counts.get("apron", 0) == 0:
                    faa_kinds.append("apron")
                if faa_kinds:
                    try:
                        faa = skycharts.faa_airport_mapping_elements(
                            airport.icao,
                            tuple(faa_kinds),
                        )
                        faa_terminals = skycharts.gateway_terminal_supplements(
                            elements,
                            faa,
                            overlap_distance=20,
                        )
                        faa_other = [
                            element for element in faa
                            if skycharts.feature_kind(
                                element.get("tags") or {}
                            ) != "terminal"
                        ]
                        faa = faa_terminals + faa_other
                        if faa:
                            elements = skycharts.merge_osm_elements(
                                elements,
                                faa,
                            )
                            normalized = skycharts.normalize(
                                {"elements": elements},
                                airport_record,
                                source=(
                                    "OpenStreetMap regional extract + "
                                    "OurAirports + FAA Airport Mapping"
                                ),
                                source_url=skycharts.FAA_AM_SOURCE_URL,
                            )
                    except skycharts.AirportMapError:
                        pass
            if (
                with_overture
                and skycharts.needs_terminal_supplement(normalized)
            ):
                overture_path = work / f"{airport.icao}-overture.geojson"
                overture_elements = download_overture_buildings(
                    (south, west, north, east),
                    overture_path,
                )
                overture_promoted = skycharts.promote_osm_terminal_buildings(
                    elements + overture_elements,
                    normalized,
                )
                overture_promoted = [
                    element for element in overture_promoted
                    if (element.get("tags") or {}).get("taxinow:source")
                    == "Overture Maps"
                ]
                if overture_promoted:
                    elements = skycharts.merge_osm_elements(
                        elements,
                        overture_promoted,
                    )
                    normalized = skycharts.normalize(
                        {"elements": elements},
                        airport_record,
                        source=(
                            "OpenStreetMap regional extract + OurAirports "
                            "+ Overture Maps"
                        ),
                    )
            counts = normalized.get("counts") or {}
            if (
                counts.get("taxiway", 0) + counts.get("taxilane", 0) == 0
                or counts.get("parking_position", 0)
                + counts.get("gate", 0)
                == 0
            ):
                try:
                    gateway = skycharts.xplane_gateway_raw(airport.icao)
                    gateway_operational = [
                        element for element in gateway.get("elements", [])
                        if skycharts.feature_kind(
                            element.get("tags") or {}
                        ) not in {"terminal", "hangar"}
                    ]
                    if gateway_operational:
                        elements = skycharts.merge_osm_elements(
                            gateway_operational,
                            [
                                element for element in elements
                                if skycharts.feature_kind(
                                    element.get("tags") or {}
                                ) in {
                                    "terminal", "hangar", "apron", "pavement"
                                }
                            ],
                        )
                        if runway_raw.get("elements"):
                            elements = skycharts.merge_osm_elements(
                                elements,
                                runway_raw["elements"],
                            )
                        normalized = skycharts.normalize(
                            {"elements": elements},
                            airport_record,
                            source=(
                                "OpenStreetMap regional extract + OurAirports "
                                "+ X-Plane Scenery Gateway operational detail"
                            ),
                        )
                except skycharts.AirportMapError:
                    pass
            quality_errors, quality_warnings = skycharts.airport_map_quality(
                normalized
            )
            if quality_errors:
                print(
                    f"Skipping {airport.icao}: "
                    + "; ".join(quality_errors)
                )
                continue
            if quality_warnings:
                normalized["qualityWarnings"] = quality_warnings
            upgraded = pipeline.upgrade_skycharts_data(
                normalized,
                airport.country_code,
                airport.region_code,
                airport.municipality,
            )
            pipeline.atomic_write(
                maps_directory / f"{airport.icao}.json",
                json.dumps(
                    upgraded,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ).encode("utf-8"),
            )


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "mode",
        choices=("from-maps", "from-geofabrik"),
    )
    parser.add_argument("--input", action="append", type=pathlib.Path)
    parser.add_argument("--pbf", type=pathlib.Path)
    parser.add_argument("--pbf-url")
    parser.add_argument("--maps-directory", type=pathlib.Path)
    parser.add_argument("--with-overture", action="store_true")
    parser.add_argument("--output", required=True, type=pathlib.Path)
    parser.add_argument("--metadata-output", type=pathlib.Path)
    parser.add_argument("--id", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--country", required=True)
    parser.add_argument("--region")
    parser.add_argument(
        "--source-note",
        default=(
            "OpenStreetMap contributors (ODbL), OurAirports, and "
            "approved feature-level supplements"
        ),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_arguments()
    roots = args.input or []
    if args.mode == "from-geofabrik":
        pbf = args.pbf
        if pbf is None:
            if not args.pbf_url:
                raise RuntimeError("--pbf or --pbf-url is required.")
            pbf = args.output.parent / pathlib.Path(
                args.pbf_url.split("?", 1)[0]
            ).name
            download_resumable(args.pbf_url, pbf)
        maps_directory = (
            args.maps_directory
            or args.output.parent / f"{args.id}-maps"
        )
        build_maps_from_geofabrik(
            pbf,
            maps_directory,
            args.country,
            args.region,
            args.with_overture,
        )
        roots = [maps_directory]
    if not roots:
        raise RuntimeError("At least one --input map file/directory is required.")
    maps = read_schema_v2_maps(
        roots,
        args.country,
        args.region,
    )
    metadata = build_pack(
        maps,
        args.output,
        args.id,
        args.version,
        args.country,
        args.region,
        args.source_note,
    )
    rendered = json.dumps(metadata, ensure_ascii=False, indent=2)
    if args.metadata_output:
        args.metadata_output.parent.mkdir(parents=True, exist_ok=True)
        args.metadata_output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)


if __name__ == "__main__":
    main()
