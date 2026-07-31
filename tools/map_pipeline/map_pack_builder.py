#!/usr/bin/env python3
"""Build verified TaxiNow regional map packs.

The normal release workflow builds schema-v2 airport JSON files from a local
OSM extract, then packages them with ``from-maps``. ``from-geofabrik`` uses the
external ``osmium`` command to filter a Geofabrik PBF locally; it never sends
per-airport requests to a public Overpass instance.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
import os
import pathlib
import shutil
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone

import skycharts_airport_map as skycharts
import taxinow_map_pipeline as pipeline


PACK_SCHEMA_VERSION = 1
PACK_SOURCE_REVISION = 2
MAP_BUILD_PIPELINE_REVISION = 2
MICROSOFT_BUILDING_INDEX_URL = (
    "https://bfppub.blob.core.windows.net/$web/2026-07-24/"
    "dataset-links.csv"
)
MICROSOFT_BUILDING_INDEX_URLS = (
    MICROSOFT_BUILDING_INDEX_URL,
    (
        "https://minedbuildings.z5.web.core.windows.net/"
        "global-buildings/dataset-links.csv"
    ),
)
GEOFABRIK_INDEX_URL = "https://download.geofabrik.de/index-v1.json"


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
    generated_at: str | None = None,
) -> dict:
    if not maps:
        raise RuntimeError("No matching schema-v2 airport maps were found.")
    generated = generated_at or iso_now()
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
        "sourceRevision": PACK_SOURCE_REVISION,
    }


def partition_maps(
    maps: list[tuple[str, bytes]],
    maximum_airports: int,
    maximum_uncompressed_bytes: int,
) -> list[list[tuple[str, bytes]]]:
    partitions = []
    current = []
    current_bytes = 0
    for item in maps:
        payload_size = len(item[1])
        if (
            current
            and (
                len(current) >= maximum_airports
                or current_bytes + payload_size
                > maximum_uncompressed_bytes
            )
        ):
            partitions.append(current)
            current = []
            current_bytes = 0
        current.append(item)
        current_bytes += payload_size
    if current:
        partitions.append(current)
    return partitions


def build_sharded_packs(
    maps: list[tuple[str, bytes]],
    output: pathlib.Path,
    pack_id: str,
    version: str,
    country_code: str,
    region_code: str | None,
    source_note: str,
    maximum_airports: int = 250,
    maximum_uncompressed_bytes: int = 250 * 1024 * 1024,
) -> list[dict]:
    partitions = partition_maps(
        maps,
        max(1, maximum_airports),
        max(1024 * 1024, maximum_uncompressed_bytes),
    )
    metadata = []
    generated_at = iso_now()
    for index, partition in enumerate(partitions, 1):
        if len(partitions) == 1:
            shard_output = output
            shard_id = pack_id
        else:
            shard_output = output.with_name(
                f"{output.stem}-part-{index:03d}{output.suffix}"
            )
            shard_id = f"{pack_id}-part-{index:03d}"
        entry = build_pack(
            partition,
            shard_output,
            shard_id,
            version,
            country_code,
            region_code,
            source_note,
            generated_at,
        )
        entry["shard"] = index
        entry["shardCount"] = len(partitions)
        metadata.append(entry)
    return metadata


def map_pack_index(
    entries: list[dict],
    base_url: str,
) -> dict:
    normalized_url = base_url.rstrip("/")
    packs = []
    for entry in entries:
        value = dict(entry)
        file_name = value.pop("fileName")
        value["url"] = (
            f"{normalized_url}/{urllib.parse.quote(file_name)}"
        )
        packs.append(value)
    return {
        "schemaVersion": PACK_SCHEMA_VERSION,
        "updatedAt": iso_now(),
        "packs": packs,
    }


def download_resumable(url: str, destination: pathlib.Path) -> pathlib.Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".part")
    for attempt in range(4):
        offset = partial.stat().st_size if partial.exists() else 0
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": pipeline.USER_AGENT,
                **({"Range": f"bytes={offset}-"} if offset else {}),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                append = offset > 0 and getattr(
                    response,
                    "status",
                    response.getcode(),
                ) == 206
                with partial.open("ab" if append else "wb") as stream:
                    shutil.copyfileobj(
                        response,
                        stream,
                        length=1024 * 1024,
                    )
            os.replace(partial, destination)
            return destination
        except (OSError, TimeoutError):
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)
    raise AssertionError("unreachable")


def run_osmium(
    arguments: list[str],
    *,
    operation: str | None = None,
) -> None:
    # On Windows, shutil.which("osmium") can return a path ending in
    # "osmium.EXE". osmium-tool 1.19 interprets that upper-case argv[0]
    # basename as a subcommand and exits with code 2. Asking for the complete
    # lower-case file name preserves the argv[0] spelling expected by osmium.
    executable = shutil.which("osmium.exe")
    if not executable:
        raise RuntimeError(
            "The osmium command is required for from-geofabrik. "
            "Install osmium-tool in the maintainer build environment."
        )
    label = operation or " ".join(arguments[:2])
    print(f"OSM processing: {label}", flush=True)
    try:
        subprocess.run([executable, *arguments], check=True)
    except subprocess.CalledProcessError as error:
        raise RuntimeError(
            f"OSM processing failed during {label} "
            f"(osmium exit code {error.returncode})."
        ) from error


def osmium_file_is_readable(path: pathlib.Path) -> bool:
    executable = shutil.which("osmium.exe")
    if not executable or not path.is_file() or path.stat().st_size == 0:
        return False
    result = subprocess.run(
        [executable, "fileinfo", str(path)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.returncode == 0


def osmium_cache_is_current(
    source: pathlib.Path,
    cache: pathlib.Path,
) -> bool:
    return (
        osmium_file_is_readable(cache)
        and cache.stat().st_mtime_ns >= source.stat().st_mtime_ns
    )


def geojson_geometry_elements(
    feature: dict,
    index: int,
    *,
    identity_prefix: str = "osmium",
) -> list[dict]:
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
            "id": f"{identity_prefix}-{identity}",
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
            "id": f"{identity_prefix}-{identity}-{part}",
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


def read_geojson_features(path: pathlib.Path) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    try:
        value = json.loads(text)
        if isinstance(value, dict):
            return list(value.get("features") or [])
        if isinstance(value, list):
            return value
    except json.JSONDecodeError:
        pass
    return [
        json.loads(line)
        for line in text.splitlines()
        if line.strip()
    ]


def read_overture_buildings(
    path: pathlib.Path,
    feature_type: str = "building",
) -> list[dict]:
    features = read_geojson_features(path)
    elements = []
    for index, feature in enumerate(features):
        converted = geojson_geometry_elements(
            feature,
            index,
            identity_prefix=f"overture-{feature_type}",
        )
        names = (feature.get("properties") or {}).get("names") or {}
        for element in converted:
            tags = dict(element.get("tags") or {})
            tags["building"] = "yes"
            tags["taxinow:building_type"] = feature_type
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


def run_overture_download(
    executable: str,
    bounds: tuple[float, float, float, float],
    output: pathlib.Path,
    feature_type: str,
) -> list[dict]:
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
            feature_type,
            "-o",
            str(output),
        ],
        check=True,
    )
    return read_overture_buildings(output, feature_type)


def download_overture_buildings(
    bounds: tuple[float, float, float, float],
    output_directory: pathlib.Path,
) -> list[dict]:
    executable = shutil.which("overturemaps")
    if not executable:
        raise RuntimeError(
            "The overturemaps command is required with --with-overture."
        )
    output_directory.mkdir(parents=True, exist_ok=True)
    elements = []
    for feature_type in ("building", "building_part"):
        output = output_directory / f"{feature_type}.geojson"
        elements.extend(
            run_overture_download(
                executable,
                bounds,
                output,
                feature_type,
            )
        )
    return elements


def longitude_to_tile_x(longitude: float, zoom: int) -> int:
    size = 1 << zoom
    return max(
        0,
        min(size - 1, int((longitude + 180.0) / 360.0 * size)),
    )


def latitude_to_tile_y(latitude: float, zoom: int) -> int:
    latitude = max(-85.05112878, min(85.05112878, latitude))
    radians = math.radians(latitude)
    size = 1 << zoom
    value = (
        1.0
        - math.asinh(math.tan(radians)) / math.pi
    ) / 2.0 * size
    return max(0, min(size - 1, int(value)))


def tile_quadkey(tile_x: int, tile_y: int, zoom: int) -> str:
    digits = []
    for level in range(zoom, 0, -1):
        mask = 1 << (level - 1)
        digit = 0
        if tile_x & mask:
            digit += 1
        if tile_y & mask:
            digit += 2
        digits.append(str(digit))
    return "".join(digits)


def quadkeys_for_bounds(
    bounds: tuple[float, float, float, float],
    zoom: int = 9,
) -> set[str]:
    south, west, north, east = bounds
    minimum_x = longitude_to_tile_x(west, zoom)
    maximum_x = longitude_to_tile_x(east, zoom)
    minimum_y = latitude_to_tile_y(north, zoom)
    maximum_y = latitude_to_tile_y(south, zoom)
    return {
        tile_quadkey(tile_x, tile_y, zoom)
        for tile_x in range(minimum_x, maximum_x + 1)
        for tile_y in range(minimum_y, maximum_y + 1)
    }


class MicrosoftBuildingIndex:
    def __init__(self, cache_directory: pathlib.Path):
        self.cache_directory = cache_directory
        self.cache_directory.mkdir(parents=True, exist_ok=True)
        index_path = self.cache_directory / "dataset-links.csv"
        if not index_path.exists():
            errors = []
            for url in MICROSOFT_BUILDING_INDEX_URLS:
                try:
                    download_resumable(url, index_path)
                    break
                except (OSError, TimeoutError) as error:
                    errors.append(str(error))
                    index_path.with_suffix(".csv.part").unlink(
                        missing_ok=True
                    )
            if not index_path.exists():
                raise RuntimeError(
                    "Microsoft building index download failed: "
                    + "; ".join(errors)
                )
        self.by_quadkey: dict[str, list[str]] = {}
        with index_path.open(encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                quadkey = str(row.get("QuadKey") or "").strip()
                url = str(row.get("Url") or "").strip()
                if quadkey and url:
                    self.by_quadkey.setdefault(quadkey, []).append(url)

    def buildings(
        self,
        bounds: tuple[float, float, float, float],
    ) -> list[dict]:
        south, west, north, east = bounds
        elements = []
        serial = 0
        for quadkey in sorted(quadkeys_for_bounds(bounds)):
            for url in self.by_quadkey.get(quadkey, []):
                digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
                path = self.cache_directory / f"{quadkey}-{digest}.csv.gz"
                if not path.exists():
                    download_resumable(url, path)
                with gzip.open(path, "rt", encoding="utf-8") as stream:
                    for line in stream:
                        if not line.strip():
                            continue
                        feature = json.loads(line)
                        geometry = feature.get("geometry") or {}
                        points = [
                            point
                            for ring in skycharts.geojson_polygon_rings(
                                geometry
                            )
                            for point in ring
                            if len(point) >= 2
                        ]
                        if not points:
                            continue
                        longitudes = [point[0] for point in points]
                        latitudes = [point[1] for point in points]
                        if (
                            max(longitudes) < west
                            or min(longitudes) > east
                            or max(latitudes) < south
                            or min(latitudes) > north
                        ):
                            continue
                        converted = geojson_geometry_elements(
                            feature,
                            serial,
                            identity_prefix="microsoft-building",
                        )
                        serial += 1
                        for element in converted:
                            tags = dict(element.get("tags") or {})
                            tags["building"] = "yes"
                            tags["taxinow:source"] = (
                                "Microsoft Global ML Building Footprints"
                            )
                            element["tags"] = tags
                            elements.append(element)
        return elements


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
    with_microsoft: bool = False,
    force_airports: bool = False,
) -> dict:
    maps_directory.mkdir(parents=True, exist_ok=True)
    quality_records = []
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
        microsoft_index = (
            MicrosoftBuildingIndex(
                maps_directory.parent / "microsoft-building-cache"
            )
            if with_microsoft
            else None
        )
        # This is the expensive country-wide pass. Keep the result beside the
        # downloaded Geofabrik extract so an interrupted build can resume
        # without scanning every building in the country again.
        filtered = pbf.with_name(
            f"{pbf.stem}.taxinow-airport-features.osm.pbf"
        )
        if osmium_cache_is_current(pbf, filtered):
            print(
                f"Reusing verified OSM airport-feature cache: {filtered}",
                flush=True,
            )
        else:
            filtered.unlink(missing_ok=True)
            run_osmium(
                [
                    "tags-filter",
                    str(pbf),
                    "nwr/aeroway",
                    "nwr/building",
                    "nwr/building:part",
                    "-o",
                    str(filtered),
                    "--overwrite",
                ],
                operation=(
                    f"country-wide airport feature index for "
                    f"{country_code.upper()}"
                ),
            )
            if not osmium_file_is_readable(filtered):
                filtered.unlink(missing_ok=True)
                raise RuntimeError(
                    "OSM processing produced an unreadable country-wide "
                    "airport-feature cache."
                )
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
            map_path = maps_directory / f"{airport.icao}.json"
            if map_path.is_file() and not force_airports:
                try:
                    existing = json.loads(map_path.read_text(encoding="utf-8"))
                    existing_airport = existing.get("airport") or {}
                    existing_features = existing.get("features") or []
                    existing_counts = existing.get("counts") or {}
                    invalid_polygons = [
                        feature for feature in existing_features
                        if feature.get("kind") in skycharts.POLYGON_KINDS
                        and len(feature.get("points") or []) > 1
                        and (
                            len(feature.get("points") or []) < 4
                            or feature["points"][0] != feature["points"][-1]
                        )
                    ]
                    if (
                        int(existing.get("schemaVersion") or 0) != 2
                        or str(existing_airport.get("icao") or "").upper()
                        != airport.icao
                        or int(existing_counts.get("runways") or 0) == 0
                        or invalid_polygons
                    ):
                        raise ValueError("cached airport map failed validation")
                    quality_records.append({
                        "icao": airport.icao,
                        "status": "built",
                        "errors": [],
                        "warnings": list(
                            existing.get("qualityWarnings") or []
                        ),
                        "terminalCompleteness": (
                            skycharts.terminal_completeness_metrics(
                                {"features": existing_features}
                            )
                        ),
                        "sources": [
                            str(source.get("name") or "Unknown")
                            for source in existing.get("sources") or []
                            if isinstance(source, dict)
                        ],
                    })
                    print(
                        f"Reusing completed airport map for {airport.icao}",
                        flush=True,
                    )
                    continue
                except (OSError, TypeError, ValueError, json.JSONDecodeError):
                    map_path.unlink(missing_ok=True)
            source_names = [
                "OpenStreetMap regional extract",
                "OurAirports",
            ]
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
            try:
                run_osmium(
                    [
                        "extract",
                        "--bbox",
                        f"{west},{south},{east},{north}",
                        str(filtered),
                        "-o",
                        str(extract),
                        "--overwrite",
                    ],
                    operation=f"airport extraction for {airport.icao}",
                )
                run_osmium(
                    [
                        "export",
                        str(extract),
                        "-f",
                        "geojsonseq",
                        "-o",
                        str(sequence),
                        "--overwrite",
                    ],
                    operation=f"airport geometry export for {airport.icao}",
                )
            except RuntimeError as error:
                message = str(error)
                print(f"Skipping {airport.icao}: {message}", flush=True)
                quality_records.append({
                    "icao": airport.icao,
                    "status": "rejected",
                    "errors": [message],
                    "warnings": [],
                    "terminalCompleteness": {},
                    "sources": source_names,
                })
                continue
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
                    source=" + ".join(source_names),
                )
            except skycharts.AirportMapError as error:
                message = f"Airport normalization failed: {error}"
                print(f"Skipping {airport.icao}: {message}", flush=True)
                quality_records.append({
                    "icao": airport.icao,
                    "status": "rejected",
                    "errors": [message],
                    "warnings": [],
                    "terminalCompleteness": {},
                    "sources": source_names,
                })
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
                    source=" + ".join(source_names),
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
                            if "FAA Airport Mapping" not in source_names:
                                source_names.append("FAA Airport Mapping")
                            normalized = skycharts.normalize(
                                {"elements": elements},
                                airport_record,
                                source=" + ".join(source_names),
                            )
                    except skycharts.AirportMapError:
                        pass
            terminal_incomplete = (
                skycharts.needs_terminal_supplement(normalized)
                or bool(
                    skycharts.uncovered_terminal_label_points(normalized)
                )
            )
            if with_overture and terminal_incomplete:
                try:
                    overture_elements = download_overture_buildings(
                        (south, west, north, east),
                        work / f"{airport.icao}-overture",
                    )
                    # Prefer Overture's complete parent-building footprint.
                    # building_part geometry is considered only when the
                    # parent footprint still leaves terminal labels/gates
                    # uncovered.
                    for building_type in ("building", "building_part"):
                        candidates = [
                            element for element in overture_elements
                            if (
                                (element.get("tags") or {}).get(
                                    "taxinow:building_type"
                                )
                                == building_type
                            )
                        ]
                        promoted = skycharts.promote_terminal_buildings(
                            elements + candidates,
                            normalized,
                            source_name="Overture Maps",
                        )
                        if promoted:
                            elements = skycharts.merge_osm_elements(
                                elements,
                                promoted,
                            )
                            if "Overture Maps" not in source_names:
                                source_names.append("Overture Maps")
                            normalized = skycharts.normalize(
                                {"elements": elements},
                                airport_record,
                                source=" + ".join(source_names),
                            )
                        terminal_incomplete = (
                            skycharts.needs_terminal_supplement(normalized)
                            or bool(
                                skycharts.uncovered_terminal_label_points(
                                    normalized
                                )
                            )
                        )
                        if not terminal_incomplete:
                            break
                except (OSError, RuntimeError, subprocess.SubprocessError):
                    pass
            if microsoft_index is not None and terminal_incomplete:
                try:
                    microsoft_elements = microsoft_index.buildings(
                        (south, west, north, east)
                    )
                    promoted = skycharts.promote_terminal_buildings(
                        elements + microsoft_elements,
                        normalized,
                        source_name=(
                            "Microsoft Global ML Building Footprints"
                        ),
                    )
                    if promoted:
                        elements = skycharts.merge_osm_elements(
                            elements,
                            promoted,
                        )
                        source_names.append(
                            "Microsoft Global ML Building Footprints"
                        )
                        normalized = skycharts.normalize(
                            {"elements": elements},
                            airport_record,
                            source=" + ".join(source_names),
                        )
                except (OSError, RuntimeError, ValueError):
                    pass
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
                        if (
                            "X-Plane Scenery Gateway operational detail"
                            not in source_names
                        ):
                            source_names.append(
                                "X-Plane Scenery Gateway operational detail"
                            )
                        normalized = skycharts.normalize(
                            {"elements": elements},
                            airport_record,
                            source=" + ".join(source_names),
                        )
                except skycharts.AirportMapError:
                    pass
            quality_errors, quality_warnings = skycharts.airport_map_quality(
                normalized
            )
            completeness = skycharts.terminal_completeness_metrics(
                normalized
            )
            if quality_errors:
                print(
                    f"Skipping {airport.icao}: "
                    + "; ".join(quality_errors)
                )
                quality_records.append({
                    "icao": airport.icao,
                    "status": "rejected",
                    "errors": quality_errors,
                    "warnings": quality_warnings,
                    "terminalCompleteness": completeness,
                    "sources": source_names,
                })
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
            quality_records.append({
                "icao": airport.icao,
                "status": "built",
                "errors": [],
                "warnings": quality_warnings,
                "terminalCompleteness": completeness,
                "sources": source_names,
            })
    return {
        "schemaVersion": 1,
        "pipelineRevision": MAP_BUILD_PIPELINE_REVISION,
        "generatedAt": iso_now(),
        "countryCode": country_code.upper(),
        "regionCode": region_code.upper() if region_code else None,
        "airports": quality_records,
        "summary": {
            "selected": len(quality_records),
            "built": sum(
                record["status"] == "built"
                for record in quality_records
            ),
            "rejected": sum(
                record["status"] == "rejected"
                for record in quality_records
            ),
            "withWarnings": sum(
                bool(record["warnings"])
                for record in quality_records
            ),
        },
    }


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
    parser.add_argument("--with-microsoft", action="store_true")
    parser.add_argument("--force-airports", action="store_true")
    parser.add_argument("--output", required=True, type=pathlib.Path)
    parser.add_argument("--metadata-output", type=pathlib.Path)
    parser.add_argument("--quality-report", type=pathlib.Path)
    parser.add_argument("--index-output", type=pathlib.Path)
    parser.add_argument("--base-url")
    parser.add_argument(
        "--max-airports-per-pack",
        type=int,
        default=250,
    )
    parser.add_argument(
        "--max-uncompressed-mb",
        type=int,
        default=250,
    )
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
    quality_report = None
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
        quality_report = build_maps_from_geofabrik(
            pbf,
            maps_directory,
            args.country,
            args.region,
            args.with_overture,
            args.with_microsoft,
            args.force_airports,
        )
        roots = [maps_directory]
    if not roots:
        raise RuntimeError("At least one --input map file/directory is required.")
    maps = read_schema_v2_maps(
        roots,
        args.country,
        args.region,
    )
    metadata = build_sharded_packs(
        maps,
        args.output,
        args.id,
        args.version,
        args.country,
        args.region,
        args.source_note,
        args.max_airports_per_pack,
        args.max_uncompressed_mb * 1024 * 1024,
    )
    rendered = json.dumps(metadata, ensure_ascii=False, indent=2)
    if args.metadata_output:
        args.metadata_output.parent.mkdir(parents=True, exist_ok=True)
        args.metadata_output.write_text(rendered + "\n", encoding="utf-8")
    if args.quality_report and quality_report is not None:
        args.quality_report.parent.mkdir(parents=True, exist_ok=True)
        args.quality_report.write_text(
            json.dumps(
                quality_report,
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    if args.index_output:
        if not args.base_url:
            raise RuntimeError(
                "--base-url is required with --index-output."
            )
        args.index_output.parent.mkdir(parents=True, exist_ok=True)
        args.index_output.write_text(
            json.dumps(
                map_pack_index(metadata, args.base_url),
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    print(rendered)


if __name__ == "__main__":
    main()
