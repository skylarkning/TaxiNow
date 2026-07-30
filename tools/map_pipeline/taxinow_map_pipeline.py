#!/usr/bin/env python3
"""TaxiNow airport acquisition and schema-v2 normalization pipeline."""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import math
import os
import pathlib
import random
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

import skycharts_airport_map as skycharts_map

PROTOCOL_VERSION = "1"
OURAIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"
RUNWAYS_URL = "https://davidmegginson.github.io/ourairports-data/runways.csv"
OVERPASS_URLS = (
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
)
USER_AGENT = "TaxiNow-map-pipeline/0.1 (flight simulation airport map downloader)"
POLYGON_KINDS = {"apron", "terminal", "hangar", "pavement"}
SUPPORTED_KINDS = {
    "runway",
    "taxiway",
    "taxilane",
    "apron",
    "parking_position",
    "gate",
    "holding_position",
    "terminal",
    "hangar",
    "jetway",
    "pavement",
}


@dataclass(frozen=True)
class Airport:
    icao: str
    name: str
    country_code: str
    region_code: str | None
    municipality: str | None
    latitude: float
    longitude: float
    airport_type: str


class PipelineError(RuntimeError):
    pass


class Protocol:
    def __init__(self, request: dict[str, Any]) -> None:
        self.request = request
        self.request_id = str(request.get("requestId", ""))
        self.started = time.monotonic()

    def emit(self, event: str, **payload: Any) -> None:
        value = {
            "protocolVersion": PROTOCOL_VERSION,
            "requestId": self.request_id,
            "event": event,
            **payload,
        }
        print(json.dumps(value, separators=(",", ":")), flush=True)

    def progress(
        self,
        phase: str,
        completed: int,
        total: int,
        current_icao: str | None,
        source: str | None,
        bytes_written: int = 0,
        warnings: list[str] | None = None,
        stage_percentage: float | None = None,
        estimated_remaining_seconds: float | None = None,
        bytes_downloaded: int = 0,
        download_bytes_total: int | None = None,
        download_bytes_per_second: float | None = None,
    ) -> None:
        elapsed = time.monotonic() - self.started
        if total == 0:
            percentage = stage_percentage or 0.0
        elif stage_percentage is None:
            percentage = completed * 100.0 / total
        else:
            percentage = (
                completed + max(0.0, min(stage_percentage, 100.0)) / 100.0
            ) * 100.0 / total
        remaining = estimated_remaining_seconds
        if remaining is None and completed > 0 and completed < total:
            remaining = elapsed / completed * (total - completed)
        self.emit(
            "progress",
            phase=phase,
            airportsCompleted=completed,
            airportsTotal=total,
            bytesWritten=bytes_written,
            bytesDownloaded=bytes_downloaded,
            downloadBytesTotal=download_bytes_total,
            downloadBytesPerSecond=(
                None
                if download_bytes_per_second is None
                else round(download_bytes_per_second, 2)
            ),
            currentIcao=current_icao,
            percentage=round(percentage, 2),
            elapsedSeconds=round(elapsed, 3),
            estimatedRemainingSeconds=None if remaining is None else round(remaining, 3),
            currentSource=source,
            warnings=warnings or [],
        )


class SourceCache:
    def __init__(self, root: pathlib.Path) -> None:
        self.root = root
        self.positive = root / "positive"
        self.negative = root / "negative"
        self.positive.mkdir(parents=True, exist_ok=True)
        self.negative.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def key(namespace: str, value: str) -> str:
        digest = hashlib.sha256(f"{namespace}:{value}".encode("utf-8")).hexdigest()
        return f"{namespace}-{digest}"

    def read_bytes(self, key: str, maximum_age: timedelta) -> bytes | None:
        path = self.positive / key
        if not path.exists():
            return None
        modified = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
        if datetime.now(timezone.utc) - modified > maximum_age:
            return None
        return path.read_bytes()

    def write_bytes(self, key: str, data: bytes) -> None:
        atomic_write(self.positive / key, data)

    def read_negative(self, key: str) -> dict[str, Any] | None:
        path = self.negative / f"{key}.json"
        if not path.exists():
            return None
        value = json.loads(path.read_text(encoding="utf-8"))
        retry_after = datetime.fromisoformat(value["retryAfter"])
        return value if retry_after > datetime.now(timezone.utc) else None

    def write_negative(self, key: str, reason: str, transient: bool) -> None:
        retry = datetime.now(timezone.utc) + (
            timedelta(minutes=15) if transient else timedelta(days=7)
        )
        value = {
            "reason": reason,
            "transient": transient,
            "attemptedAt": iso_now(),
            "retryAfter": retry.isoformat(),
        }
        atomic_write(
            self.negative / f"{key}.json",
            json.dumps(value, separators=(",", ":")).encode("utf-8"),
        )


def request_bytes(
    url: str,
    *,
    data: bytes | None = None,
    timeout: int = 90,
    attempts: int = 3,
    progress_callback=None,
) -> bytes:
    delay = 1.0
    for attempt in range(attempts):
        request = urllib.request.Request(
            url,
            data=data,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/json,text/csv,*/*",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            method="POST" if data is not None else "GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                total_header = response.headers.get("Content-Length")
                try:
                    total = int(total_header) if total_header else None
                except (TypeError, ValueError):
                    total = None
                chunks = []
                downloaded = 0
                started = time.monotonic()
                while True:
                    chunk = response.read(64 * 1024)
                    if not chunk:
                        break
                    chunks.append(chunk)
                    downloaded += len(chunk)
                    elapsed = max(time.monotonic() - started, 0.001)
                    speed = downloaded / elapsed
                    if progress_callback:
                        progress_callback(
                            downloaded,
                            total,
                            speed,
                            (total - downloaded) / speed
                            if total and speed > 0
                            else None,
                        )
                return b"".join(chunks)
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt + 1 == attempts:
                raise PipelineError(f"Source request failed: {error}") from error
            time.sleep(delay + random.random() * 0.25)
            delay = min(delay * 2, 8)
    raise AssertionError("unreachable")


def load_airports(cache: SourceCache, progress_callback=None) -> list[Airport]:
    key = SourceCache.key("ourairports", "airports.csv")
    raw = cache.read_bytes(key, timedelta(days=7))
    if raw is None:
        raw = request_bytes(
            OURAIRPORTS_URL,
            progress_callback=progress_callback,
        )
        cache.write_bytes(key, raw)
    text = raw.decode("utf-8-sig")
    airports: list[Airport] = []
    for row in csv.DictReader(io.StringIO(text)):
        ident = (row.get("ident") or "").strip().upper()
        try:
            latitude = float(row["latitude_deg"])
            longitude = float(row["longitude_deg"])
        except (KeyError, TypeError, ValueError):
            continue
        if (
            len(ident) < 3
            or not math.isfinite(latitude)
            or not math.isfinite(longitude)
        ):
            continue
        airports.append(
            Airport(
                ident,
                (row.get("name") or ident).strip(),
                (row.get("iso_country") or "ZZ").strip().upper(),
                (row.get("iso_region") or "").strip() or None,
                (row.get("municipality") or "").strip() or None,
                latitude,
                longitude,
                (row.get("type") or "").strip(),
            )
        )
    return airports


def fetch_overpass(airport: Airport, cache: SourceCache) -> dict[str, Any]:
    key = SourceCache.key("overpass", airport.icao)
    negative = cache.read_negative(key)
    if negative is not None:
        raise PipelineError(f"Negative cache: {negative['reason']}")
    cached = cache.read_bytes(key, timedelta(days=30))
    if cached is not None:
        return json.loads(gzip.decompress(cached))

    query = f"""
[out:json][timeout:75];
(
  nwr(around:6500,{airport.latitude:.7f},{airport.longitude:.7f})["aeroway"];
  nwr(around:6500,{airport.latitude:.7f},{airport.longitude:.7f})["building"~"^(terminal|hangar)$"];
);
out tags geom;
""".strip()
    errors: list[str] = []
    raw = None
    parsed = None
    for endpoint in OVERPASS_URLS:
        try:
            raw = request_bytes(
                endpoint,
                data=urllib.parse.urlencode({"data": query}).encode("ascii"),
                timeout=35,
                attempts=1,
            )
            parsed = json.loads(raw)
            break
        except (PipelineError, json.JSONDecodeError) as error:
            errors.append(f"{urllib.parse.urlparse(endpoint).netloc}: {error}")
    if raw is None or parsed is None:
        message = "All Overpass endpoints failed: " + "; ".join(errors)
        cache.write_negative(key, message, transient=True)
        raise PipelineError(message)
    cache.write_bytes(key, gzip.compress(raw, compresslevel=6))
    return parsed


def load_runway_fallback(
    airport: Airport,
    cache: SourceCache,
) -> dict[str, Any]:
    key = SourceCache.key("ourairports", "runways.csv")
    raw = cache.read_bytes(key, timedelta(days=7))
    if raw is None:
        raw = request_bytes(RUNWAYS_URL)
        cache.write_bytes(key, raw)
    features: list[dict[str, Any]] = []
    points: list[list[float]] = []
    for row in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
        if (row.get("airport_ident") or "").strip().upper() != airport.icao:
            continue
        try:
            start = [
                float(row["le_longitude_deg"]),
                float(row["le_latitude_deg"]),
            ]
            end = [
                float(row["he_longitude_deg"]),
                float(row["he_latitude_deg"]),
            ]
        except (KeyError, TypeError, ValueError):
            continue
        if not all(
            math.isfinite(value) for coordinate in (start, end) for value in coordinate
        ):
            continue
        width = None
        try:
            width = float(row.get("width_ft") or "") * 0.3048
        except ValueError:
            pass
        reference = "/".join(
            value
            for value in (
                (row.get("le_ident") or "").strip().upper(),
                (row.get("he_ident") or "").strip().upper(),
            )
            if value
        ) or None
        features.append(
            {
                "id": f"ourairports-runway-{row.get('id') or len(features)}",
                "kind": "runway",
                "points": [start, end],
                "ref": reference,
                "name": None,
                "surface": (row.get("surface") or "").strip() or None,
                "widthMeters": width,
                "headingDegrees": None,
                "closed": (row.get("closed") or "0") == "1",
                "source": "OurAirports",
            }
        )
        points.extend((start, end))
    if not features:
        raise PipelineError("OurAirports has no positioned runway fallback.")
    now = iso_now()
    return {
        "schemaVersion": 2,
        "airport": {
            "icao": airport.icao,
            "name": airport.name,
            "countryCode": airport.country_code,
            "regionCode": airport.region_code,
            "municipality": airport.municipality,
            "center": [airport.longitude, airport.latitude],
            "bounds": calculate_bounds(points, airport),
        },
        "generatedAt": now,
        "sources": [
            {
                "name": "OurAirports",
                "url": "https://ourairports.com/data/",
                "license": "Public domain",
                "retrievedAt": now,
                "revision": None,
            }
        ],
        "counts": {
            "runways": len(features),
            "taxiways": 0,
            "stands": 0,
            "terminals": 0,
        },
        "features": features,
    }


def feature_kind(tags: dict[str, str]) -> str | None:
    value = tags.get("aeroway", "").strip().lower()
    aliases = {
        "parking": "parking_position",
        "parking_position": "parking_position",
        "holding_position": "holding_position",
        "taxi_lane": "taxilane",
    }
    value = aliases.get(value, value)
    if value in SUPPORTED_KINDS:
        return value
    building = tags.get("building", "").strip().lower()
    return building if building in {"terminal", "hangar"} else None


def element_points(element: dict[str, Any]) -> list[list[float]]:
    geometry = element.get("geometry")
    if isinstance(geometry, list):
        points = [
            [float(point["lon"]), float(point["lat"])]
            for point in geometry
            if isinstance(point, dict) and "lon" in point and "lat" in point
        ]
    elif "lon" in element and "lat" in element:
        points = [[float(element["lon"]), float(element["lat"])]]
    else:
        points = []
    return [
        point
        for point in points
        if -180 <= point[0] <= 180 and -90 <= point[1] <= 90
    ]


def parse_width(value: str | None) -> float | None:
    if not value:
        return None
    normalized = value.lower().replace("meters", "").replace("meter", "").strip()
    if normalized.endswith("m"):
        normalized = normalized[:-1].strip()
    try:
        width = float(normalized)
    except ValueError:
        return None
    return width if 0 <= width <= 500 else None


def normalize(airport: Airport, overpass: dict[str, Any]) -> dict[str, Any]:
    features: list[dict[str, Any]] = []
    all_points: list[list[float]] = []
    for element in overpass.get("elements", []):
        if not isinstance(element, dict):
            continue
        tags = element.get("tags") or {}
        kind = feature_kind(tags)
        if kind is None:
            continue
        points = element_points(element)
        if not points:
            continue
        if kind in POLYGON_KINDS and len(points) >= 3 and points[0] != points[-1]:
            points.append(points[0])
        all_points.extend(points)
        ref = tags.get("ref") or tags.get("parking_position")
        features.append(
            {
                "id": f"osm-{element.get('type', 'element')}-{element.get('id', len(features))}",
                "kind": kind,
                "points": points,
                "ref": ref,
                "name": tags.get("name"),
                "surface": tags.get("surface"),
                "widthMeters": parse_width(tags.get("width")),
                "headingDegrees": None,
                "closed": tags.get("access") == "no" or tags.get("closed") == "yes",
                "source": "OpenStreetMap",
            }
        )

    features = merge_runway_features(features)
    if not features:
        raise PipelineError("OpenStreetMap returned no supported airport features.")
    bounds = calculate_bounds(all_points, airport)
    counts = {
        "runways": sum(feature["kind"] == "runway" for feature in features),
        "taxiways": sum(
            feature["kind"] in {"taxiway", "taxilane"} for feature in features
        ),
        "stands": sum(
            feature["kind"] in {"parking_position", "gate"} for feature in features
        ),
        "terminals": sum(feature["kind"] == "terminal" for feature in features),
    }
    return {
        "schemaVersion": 2,
        "airport": {
            "icao": airport.icao,
            "name": airport.name,
            "countryCode": airport.country_code,
            "regionCode": airport.region_code,
            "municipality": airport.municipality,
            "center": [airport.longitude, airport.latitude],
            "bounds": bounds,
        },
        "generatedAt": iso_now(),
        "sources": [
            {
                "name": "OpenStreetMap",
                "url": "https://www.openstreetmap.org/",
                "license": "ODbL 1.0",
                "retrievedAt": iso_now(),
                "revision": overpass.get("osm3s", {}).get("timestamp_osm_base"),
            },
            {
                "name": "OurAirports",
                "url": "https://ourairports.com/data/",
                "license": "Public domain",
                "retrievedAt": iso_now(),
                "revision": None,
            },
        ],
        "counts": counts,
        "features": features,
    }


def merge_runway_features(
    features: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    result = [
        feature for feature in features if feature.get("kind") != "runway"
    ]
    anonymous = 0
    for feature in features:
        if feature.get("kind") != "runway":
            continue
        reference = str(feature.get("ref") or "").replace(" ", "").upper()
        if not reference:
            anonymous += 1
            reference = f"RUNWAY-{anonymous}"
        groups.setdefault(reference, []).append(feature)

    for reference, members in groups.items():
        points = [
            point
            for feature in members
            for point in feature.get("points") or []
        ]
        if len(points) < 2:
            continue
        mean_latitude = sum(point[1] for point in points) / len(points)
        longitude_scale = math.cos(math.radians(mean_latitude))
        start, end = max(
            (
                (left, right)
                for index, left in enumerate(points)
                for right in points[index + 1 :]
            ),
            key=lambda pair: (
                (pair[1][0] - pair[0][0]) * longitude_scale
            ) ** 2 + (pair[1][1] - pair[0][1]) ** 2,
        )
        widths = [
            float(feature["widthMeters"])
            for feature in members
            if feature.get("widthMeters") is not None
        ]
        result.append(
            {
                "id": f"runway-{reference.lower().replace('/', '-')}",
                "kind": "runway",
                "points": [start, end],
                "ref": None if reference.startswith("RUNWAY-") else reference,
                "name": next(
                    (feature.get("name") for feature in members if feature.get("name")),
                    None,
                ),
                "surface": next(
                    (
                        feature.get("surface")
                        for feature in members
                        if feature.get("surface")
                    ),
                    None,
                ),
                "widthMeters": max(widths) if widths else None,
                "headingDegrees": None,
                "closed": any(bool(feature.get("closed")) for feature in members),
                "source": next(
                    (
                        str(feature.get("source"))
                        for feature in members
                        if feature.get("source")
                    ),
                    "Unknown",
                ),
            }
        )
    return result


def calculate_bounds(
    points: Iterable[list[float]], airport: Airport
) -> dict[str, float]:
    values = list(points)
    if not values:
        return {
            "minLon": airport.longitude - 0.02,
            "maxLon": airport.longitude + 0.02,
            "minLat": airport.latitude - 0.02,
            "maxLat": airport.latitude + 0.02,
        }
    return {
        "minLon": min(point[0] for point in values),
        "maxLon": max(point[0] for point in values),
        "minLat": min(point[1] for point in values),
        "maxLat": max(point[1] for point in values),
    }


def download_airport(
    airport: Airport,
    output_directory: pathlib.Path,
    cache: SourceCache,
    progress_callback=None,
) -> tuple[pathlib.Path, int]:
    # Reuse SkyCharts' mature source coordination and normalization. It issues
    # smaller OSM requests, reconstructs relations, and can fall back to the
    # X-Plane Scenery Gateway before TaxiNow's runway-only last resort.
    skycharts_map.ROOT = cache.root
    try:
        source, _ = skycharts_map.build_airport_map(
            airport.icao,
            cache_dir=cache.root / "airport-map-cache",
            progress=progress_callback,
        )
    except skycharts_map.AirportMapError as error:
        raise PipelineError(str(error)) from error
    normalized = upgrade_skycharts_data(
        source,
        airport.country_code,
        airport.region_code,
        airport.municipality,
    )
    encoded = json.dumps(
        normalized, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")
    output_directory.mkdir(parents=True, exist_ok=True)
    path = output_directory / f"{airport.icao}.json"
    atomic_write(path, encoded)
    return path, len(encoded)


def download_airport_with_progress(
    protocol: Protocol,
    airport: Airport,
    output_directory: pathlib.Path,
    cache: SourceCache,
    completed: int,
    total: int,
    bytes_written: int,
    warnings: list[str],
) -> tuple[pathlib.Path, int]:
    state: dict[str, Any] = {
        "phase": "acquiring",
        "percentage": 0.0,
        "source": "OpenStreetMap",
        "bytes_downloaded": 0,
        "download_bytes_total": None,
        "download_bytes_per_second": 0.0,
        "estimated_remaining_seconds": None,
    }
    state_lock = threading.Lock()
    outcome: dict[str, Any] = {}

    def update_progress(**values: Any) -> None:
        with state_lock:
            state.update(values)

    def acquire() -> None:
        try:
            outcome["result"] = download_airport(
                airport,
                output_directory,
                cache,
                update_progress,
            )
        except BaseException as error:
            outcome["error"] = error

    worker = threading.Thread(
        target=acquire,
        name=f"TaxiNow-map-{airport.icao}",
        daemon=True,
    )
    airport_started = time.monotonic()
    worker.start()
    while worker.is_alive():
        worker.join(timeout=0.25)
        with state_lock:
            snapshot = dict(state)
        airport_elapsed = time.monotonic() - airport_started
        eta = snapshot.get("estimated_remaining_seconds")
        if eta is None:
            # Source APIs do not publish their server-side progress. Use a
            # conservative rolling estimate until response bytes begin flowing.
            eta = max(5.0, 55.0 - airport_elapsed)
        stage_percentage = float(snapshot["percentage"])
        if str(snapshot["phase"]).startswith("waiting_"):
            # Overpass and Gateway expose no server-side completion counter.
            # Move through a bounded estimated waiting range while keeping the
            # phase explicit, then replace it with byte progress on response.
            stage_percentage = min(
                55.0,
                stage_percentage + airport_elapsed * 0.8,
            )
        protocol.progress(
            str(snapshot["phase"]),
            completed,
            total,
            airport.icao,
            str(snapshot["source"]),
            bytes_written,
            warnings,
            stage_percentage=stage_percentage,
            estimated_remaining_seconds=float(eta),
            bytes_downloaded=int(snapshot["bytes_downloaded"]),
            download_bytes_total=snapshot["download_bytes_total"],
            download_bytes_per_second=snapshot["download_bytes_per_second"],
        )
    if "error" in outcome:
        raise outcome["error"]
    return outcome["result"]


def download_runway_fallback(
    airport: Airport,
    output_directory: pathlib.Path,
    cache: SourceCache,
) -> tuple[pathlib.Path, int]:
    normalized = load_runway_fallback(airport, cache)
    encoded = json.dumps(
        normalized, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")
    output_directory.mkdir(parents=True, exist_ok=True)
    path = output_directory / f"{airport.icao}.json"
    atomic_write(path, encoded)
    return path, len(encoded)


def select_airports(request: dict[str, Any], catalog: list[Airport]) -> list[Airport]:
    command = request.get("command")
    if command == "download_icao":
        icao = str(request.get("icao") or "").strip().upper()
        matches = [airport for airport in catalog if airport.icao == icao]
        if not matches:
            raise PipelineError(f"ICAO '{icao}' is not in the airport catalog.")
        return matches[:1]
    if command == "download_country":
        country = str(request.get("countryCode") or "").strip().upper()
        if len(country) != 2:
            raise PipelineError("Country code must be ISO 3166-1 alpha-2.")
        region = str(request.get("regionCode") or "").strip().upper()
        matches = [airport for airport in catalog if airport.country_code == country]
        if region:
            matches = [
                airport for airport in matches if airport.region_code == region
            ]
        if not matches:
            scope = region or country
            raise PipelineError(
                f"No airports were found for country or region '{scope}'."
            )
        excluded = {
            str(icao).strip().upper()
            for icao in request.get("excludeIcaos") or []
            if str(icao).strip()
        }
        matches = [airport for airport in matches if airport.icao not in excluded]
        preferred = sorted(
            matches,
            key=lambda airport: (
                airport.airport_type not in {"large_airport", "medium_airport"},
                airport.icao,
            ),
        )
        return preferred
    raise PipelineError("Command must be download_icao or download_country.")


def handle(request: dict[str, Any]) -> None:
    protocol = Protocol(request)
    if request.get("protocolVersion") != PROTOCOL_VERSION:
        raise PipelineError("Unsupported protocol version.")
    if not protocol.request_id:
        raise PipelineError("requestId is required.")

    output = pathlib.Path(str(request["outputDirectory"])).resolve()
    cache = SourceCache(pathlib.Path(str(request["cacheDirectory"])).resolve())
    protocol.progress("catalog", 0, 0, None, "OurAirports")

    def catalog_progress(
        downloaded: int,
        total_bytes: int | None,
        speed: float,
        eta: float | None,
    ) -> None:
        percentage = (
            min(7.0, downloaded * 7.0 / total_bytes)
            if total_bytes
            else 2.0
        )
        protocol.progress(
            "downloading_catalog",
            0,
            0,
            None,
            "OurAirports",
            stage_percentage=percentage,
            estimated_remaining_seconds=eta,
            bytes_downloaded=downloaded,
            download_bytes_total=total_bytes,
            download_bytes_per_second=speed,
        )

    catalog = load_airports(cache, catalog_progress)
    selected = select_airports(request, catalog)
    total = len(selected)
    completed = 0
    bytes_written = 0
    warnings: list[str] = []
    if request.get("command") == "download_country":
        country = str(request.get("countryCode") or "").strip().upper()
        region = str(request.get("regionCode") or "").strip().upper()
        excluded = {
            str(icao).strip().upper()
            for icao in request.get("excludeIcaos") or []
            if str(icao).strip()
        }
        skipped = sum(
            1
            for airport in catalog
            if airport.country_code == country
            and (not region or airport.region_code == region)
            and airport.icao in excluded
        )
        if skipped:
            warnings.append(
                f"Skipped {skipped} already installed airport"
                f"{'' if skipped == 1 else 's'}."
            )
    outputs: list[str] = []
    for airport in selected:
        protocol.progress(
            "acquiring",
            completed,
            total,
            airport.icao,
            "OpenStreetMap",
            bytes_written,
            warnings,
        )
        try:
            path, written = download_airport_with_progress(
                protocol,
                airport,
                output,
                cache,
                completed,
                total,
                bytes_written,
                warnings,
            )
            outputs.append(str(path))
            bytes_written += written
        except PipelineError as error:
            warnings.append(f"{airport.icao}: {error}")
            try:
                path, written = download_runway_fallback(airport, output, cache)
                outputs.append(str(path))
                bytes_written += written
                warnings.append(
                    f"{airport.icao}: using runway-only OurAirports fallback."
                )
            except PipelineError as fallback_error:
                warnings.append(f"{airport.icao}: fallback failed: {fallback_error}")
        completed += 1
        protocol.progress(
            "normalizing",
            completed,
            total,
            airport.icao,
            "OpenStreetMap",
            bytes_written,
            warnings,
        )
    protocol.emit(
        "completed",
        phase="completed",
        airportsCompleted=completed,
        airportsTotal=total,
        bytesWritten=bytes_written,
        percentage=100.0,
        elapsedSeconds=round(time.monotonic() - protocol.started, 3),
        outputPath=outputs[0] if len(outputs) == 1 else str(output),
        outputPaths=outputs,
        warnings=warnings,
    )


def atomic_write(path: pathlib.Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = pathlib.Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def upgrade_skycharts_v1(
    source_path: pathlib.Path,
    output_path: pathlib.Path,
    country_code: str,
    region_code: str | None,
    municipality: str | None,
) -> None:
    source = json.loads(source_path.read_text(encoding="utf-8"))
    result = upgrade_skycharts_data(
        source,
        country_code,
        region_code,
        municipality,
    )
    encoded = json.dumps(
        result, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")
    atomic_write(output_path.resolve(), encoded)


def upgrade_skycharts_data(
    source: dict[str, Any],
    country_code: str,
    region_code: str | None,
    municipality: str | None,
) -> dict[str, Any]:
    if int(source.get("schemaVersion", 1)) != 1:
        raise PipelineError("SkyCharts import requires a schema-v1 map.")
    source_name = str(source.get("source") or "SkyCharts schema v1 import")
    features: list[dict[str, Any]] = []
    for index, original in enumerate(source.get("features") or []):
        if not isinstance(original, dict):
            continue
        kind = str(original.get("kind") or "pavement").strip().lower()
        kind = {
            "parking": "parking_position",
            "parkingposition": "parking_position",
            "taxi_lane": "taxilane",
            "holding": "holding_position",
            "hold_short": "holding_position",
        }.get(kind, kind)
        if kind not in SUPPORTED_KINDS:
            continue
        points = original.get("points") or original.get("coordinates") or []
        normalized_points = [
            [float(point[0]), float(point[1])]
            for point in points
            if isinstance(point, list) and len(point) >= 2
        ]
        if not normalized_points:
            continue
        name = original.get("name")
        if kind == "terminal" and not name:
            name = original.get("label")
        features.append(
            {
                "id": f"skycharts-v1-{index:05d}-{kind}",
                "kind": kind,
                "points": normalized_points,
                "ref": original.get("ref"),
                "name": name,
                "surface": original.get("surface"),
                "widthMeters": parse_width(
                    None
                    if original.get("width") is None
                    else str(original.get("width"))
                ),
                "headingDegrees": None,
                "closed": False,
                "source": str(original.get("operator") or source_name),
            }
        )
    features = merge_runway_features(features)
    if not features:
        raise PipelineError("SkyCharts map contained no supported features.")
    all_points = [
        point
        for feature in features
        for point in feature["points"]
    ]
    bounds = source.get("bounds")
    if not isinstance(bounds, dict):
        airport = Airport(
            str(source.get("ident") or source.get("icao") or "UNKNOWN"),
            str(source.get("name") or "Unknown airport"),
            country_code,
            region_code,
            municipality,
            float((source.get("center") or [0, 0])[1]),
            float((source.get("center") or [0, 0])[0]),
            "",
        )
        bounds = calculate_bounds(all_points, airport)
    counts = {
        "runways": sum(feature["kind"] == "runway" for feature in features),
        "taxiways": sum(
            feature["kind"] in {"taxiway", "taxilane"} for feature in features
        ),
        "stands": sum(
            feature["kind"] in {"parking_position", "gate"}
            for feature in features
        ),
        "terminals": sum(feature["kind"] == "terminal" for feature in features),
    }
    generated_at = str(source.get("generatedAt") or iso_now())
    result = {
        "schemaVersion": 2,
        "airport": {
            "icao": str(
                source.get("ident") or source.get("icao") or "UNKNOWN"
            ).upper(),
            "name": str(source.get("name") or "Unknown airport"),
            "countryCode": country_code.upper(),
            "regionCode": region_code,
            "municipality": municipality,
            "center": source.get("center") or [
                sum(point[0] for point in all_points) / len(all_points),
                sum(point[1] for point in all_points) / len(all_points),
            ],
            "bounds": bounds,
        },
        "generatedAt": generated_at,
        "sources": [
            {
                "name": source_name,
                "url": source.get("sourceURL"),
                "license": (
                    "ODbL 1.0"
                    if "openstreetmap" in source_name.lower()
                    else None
                ),
                "retrievedAt": generated_at,
                "revision": source.get("sourceRevision"),
            }
        ],
        "counts": counts,
        "features": features,
    }
    return result


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def serve() -> int:
    for line in sys.stdin:
        if not line.strip():
            continue
        request: dict[str, Any] = {}
        try:
            request = json.loads(line)
            handle(request)
        except Exception as error:  # protocol boundary must always report errors
            protocol = Protocol(request)
            protocol.emit(
                "failed",
                phase="failed",
                error=str(error),
                warnings=[],
            )
            return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="TaxiNow airport acquisition and normalization pipeline"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("serve", help="serve the JSON-lines process protocol")
    converter = subparsers.add_parser(
        "convert-skycharts",
        help="upgrade a SkyCharts schema-v1 map to TaxiNow schema v2",
    )
    converter.add_argument("source", type=pathlib.Path)
    converter.add_argument("output", type=pathlib.Path)
    converter.add_argument("--country-code", required=True)
    converter.add_argument("--region-code")
    converter.add_argument("--municipality")
    args = parser.parse_args()
    if args.command == "serve":
        return serve()
    upgrade_skycharts_v1(
        args.source,
        args.output,
        args.country_code,
        args.region_code,
        args.municipality,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
