#!/usr/bin/env python3
"""TaxiNow airport acquisition and schema-v2 normalization pipeline."""

from __future__ import annotations

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
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

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
    ) -> None:
        elapsed = time.monotonic() - self.started
        percentage = 100.0 if total == 0 else completed * 100.0 / total
        remaining = None
        if completed > 0 and completed < total:
            remaining = elapsed / completed * (total - completed)
        self.emit(
            "progress",
            phase=phase,
            airportsCompleted=completed,
            airportsTotal=total,
            bytesWritten=bytes_written,
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
                return response.read()
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt + 1 == attempts:
                raise PipelineError(f"Source request failed: {error}") from error
            time.sleep(delay + random.random() * 0.25)
            delay = min(delay * 2, 8)
    raise AssertionError("unreachable")


def load_airports(cache: SourceCache) -> list[Airport]:
    key = SourceCache.key("ourairports", "airports.csv")
    raw = cache.read_bytes(key, timedelta(days=7))
    if raw is None:
        raw = request_bytes(OURAIRPORTS_URL)
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
) -> tuple[pathlib.Path, int]:
    overpass = fetch_overpass(airport, cache)
    normalized = normalize(airport, overpass)
    encoded = json.dumps(
        normalized, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")
    output_directory.mkdir(parents=True, exist_ok=True)
    path = output_directory / f"{airport.icao}.json"
    atomic_write(path, encoded)
    return path, len(encoded)


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
        matches = [airport for airport in catalog if airport.country_code == country]
        preferred = sorted(
            matches,
            key=lambda airport: (
                airport.airport_type not in {"large_airport", "medium_airport"},
                airport.icao,
            ),
        )
        maximum = request.get("maximumCount")
        return preferred if maximum is None else preferred[: max(0, int(maximum))]
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
    catalog = load_airports(cache)
    selected = select_airports(request, catalog)
    total = len(selected)
    completed = 0
    bytes_written = 0
    warnings: list[str] = []
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
            path, written = download_airport(airport, output, cache)
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
    if len(sys.argv) != 2 or sys.argv[1] != "serve":
        print("usage: taxinow_map_pipeline.py serve", file=sys.stderr)
        return 2
    return serve()


if __name__ == "__main__":
    raise SystemExit(main())
