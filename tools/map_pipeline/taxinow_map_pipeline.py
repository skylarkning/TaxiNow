#!/usr/bin/env python3
"""TaxiNow airport acquisition and schema-v2 normalization pipeline."""

from __future__ import annotations

import argparse
import concurrent.futures
import csv
import gzip
import hashlib
import http.client
import io
import json
import math
import os
import pathlib
import random
import re
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

import skycharts_airport_map as skycharts_map

PROTOCOL_VERSION = "1"
OURAIRPORTS_URLS = (
    "https://davidmegginson.github.io/ourairports-data/airports.csv",
    "https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv",
)
RUNWAYS_URLS = (
    "https://davidmegginson.github.io/ourairports-data/runways.csv",
    "https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/runways.csv",
)
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
ALLOWED_PARALLEL_DOWNLOADS = {1, 2, 4, 8, 16}
CATALOG_MAXIMUM_AGE = timedelta(days=7)
CATALOG_REQUEST_TIMEOUT = 30
CATALOG_ATTEMPTS_PER_URL = 2
MAP_PACK_INDEX_URLS = (
    "https://raw.githubusercontent.com/skylarkning/TaxiNow-Release/main/map-packs/index.json",
)
MAP_PACK_INDEX_MAXIMUM_AGE = timedelta(hours=6)
MAP_PACK_REQUEST_TIMEOUT = 90
MAP_PACK_SCHEMA_VERSION = 1


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
        self._emit_lock = threading.Lock()

    def emit(self, event: str, **payload: Any) -> None:
        value = {
            "protocolVersion": PROTOCOL_VERSION,
            "requestId": self.request_id,
            "event": event,
            **payload,
        }
        with self._emit_lock:
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
        overall_percentage: float | None = None,
    ) -> None:
        elapsed = time.monotonic() - self.started
        if overall_percentage is not None:
            percentage = max(0.0, min(overall_percentage, 100.0))
        elif total == 0:
            percentage = stage_percentage or 0.0
        elif stage_percentage is None:
            percentage = completed * 100.0 / total
        else:
            percentage = (
                completed + max(0.0, min(stage_percentage, 100.0)) / 100.0
            ) * 100.0 / total
        remaining = estimated_remaining_seconds
        eta_sample_minimum = min(4, total)
        if (
            remaining is None
            and completed >= eta_sample_minimum
            and completed < total
        ):
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

    def read_bytes_stale(self, key: str) -> bytes | None:
        path = self.positive / key
        return path.read_bytes() if path.exists() else None

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
        except (
            urllib.error.URLError,
            TimeoutError,
            ConnectionResetError,
            ConnectionAbortedError,
            BrokenPipeError,
            http.client.IncompleteRead,
            OSError,
        ) as error:
            if attempt + 1 == attempts:
                raise PipelineError(f"Source request failed: {error}") from error
            time.sleep(delay + random.random() * 0.25)
            delay = min(delay * 2, 8)
    raise AssertionError("unreachable")


def load_map_pack_index(cache: SourceCache) -> dict[str, Any]:
    key = SourceCache.key("taxinow-map-pack-index", "v1")
    raw = cache.read_bytes(key, MAP_PACK_INDEX_MAXIMUM_AGE)
    if raw is None:
        stale = cache.read_bytes_stale(key)
        errors: list[str] = []
        for url in MAP_PACK_INDEX_URLS:
            try:
                raw = request_bytes(
                    url,
                    timeout=30,
                    attempts=2,
                )
                cache.write_bytes(key, raw)
                break
            except PipelineError as error:
                errors.append(str(error))
        if raw is None:
            if stale is None:
                raise PipelineError(
                    "Regional map-pack index is unavailable: "
                    + "; ".join(errors)
                )
            raw = stale
    try:
        index = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PipelineError("Regional map-pack index is invalid.") from error
    if (
        not isinstance(index, dict)
        or int(index.get("schemaVersion") or 0) != MAP_PACK_SCHEMA_VERSION
        or not isinstance(index.get("packs"), list)
    ):
        raise PipelineError("Regional map-pack index schema is unsupported.")
    return index


def select_map_packs(
    index: dict[str, Any],
    country_code: str,
    region_code: str | None,
) -> list[dict[str, Any]]:
    country = country_code.strip().upper()
    region = (region_code or "").strip().upper()
    candidates = [
        pack for pack in index.get("packs", [])
        if isinstance(pack, dict)
        and str(pack.get("countryCode") or "").strip().upper() == country
        and pack.get("url")
        and pack.get("sha256")
    ]
    if region:
        exact = [
            pack for pack in candidates
            if str(pack.get("regionCode") or "").strip().upper() == region
        ]
        if exact:
            return sorted(exact, key=lambda pack: str(pack.get("id") or ""))
        return sorted(
            [
                pack for pack in candidates
                if not str(pack.get("regionCode") or "").strip()
            ],
            key=lambda pack: str(pack.get("id") or ""),
        )
    country_packs = [
        pack for pack in candidates
        if not str(pack.get("regionCode") or "").strip()
    ]
    return sorted(
        country_packs or candidates,
        key=lambda pack: str(pack.get("id") or ""),
    )


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def download_file_resumable(
    url: str,
    destination: pathlib.Path,
    expected_sha256: str,
    expected_size: int | None = None,
    progress_callback=None,
) -> pathlib.Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file():
        digest = sha256_file(destination)
        if digest.lower() == expected_sha256.lower():
            if progress_callback:
                size = destination.stat().st_size
                progress_callback(size, size, 0.0, 0.0)
            return destination
        destination.unlink()

    partial = destination.with_suffix(destination.suffix + ".part")
    delay = 1.0
    for attempt in range(3):
        offset = partial.stat().st_size if partial.exists() else 0
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "application/zip,application/octet-stream,*/*",
        }
        if offset:
            headers["Range"] = f"bytes={offset}-"
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(
                request,
                timeout=MAP_PACK_REQUEST_TIMEOUT,
            ) as response:
                status = getattr(response, "status", response.getcode())
                append = offset > 0 and status == 206
                if offset and not append:
                    offset = 0
                total_header = response.headers.get("Content-Length")
                try:
                    response_size = (
                        int(total_header) if total_header else None
                    )
                except (TypeError, ValueError):
                    response_size = None
                total = expected_size or (
                    offset + response_size if response_size is not None else None
                )
                started = time.monotonic()
                downloaded = offset
                with partial.open("ab" if append else "wb") as stream:
                    while True:
                        chunk = response.read(128 * 1024)
                        if not chunk:
                            break
                        stream.write(chunk)
                        downloaded += len(chunk)
                        elapsed = max(time.monotonic() - started, 0.001)
                        transferred = max(downloaded - offset, 0)
                        speed = transferred / elapsed
                        if progress_callback:
                            progress_callback(
                                downloaded,
                                total,
                                speed,
                                (
                                    (total - downloaded) / speed
                                    if total and speed > 0
                                    else None
                                ),
                            )
                    stream.flush()
                    os.fsync(stream.fileno())
            digest = sha256_file(partial)
            if digest.lower() != expected_sha256.lower():
                partial.unlink(missing_ok=True)
                raise PipelineError(
                    "Regional map-pack checksum verification failed."
                )
            os.replace(partial, destination)
            return destination
        except (
            urllib.error.URLError,
            TimeoutError,
            ConnectionResetError,
            ConnectionAbortedError,
            BrokenPipeError,
            http.client.IncompleteRead,
            OSError,
        ) as error:
            if attempt + 1 == 3:
                raise PipelineError(
                    f"Regional map-pack download failed: {error}"
                ) from error
            time.sleep(delay + random.random() * 0.25)
            delay = min(delay * 2, 8)
    raise AssertionError("unreachable")


def safe_pack_member(name: str) -> pathlib.PurePosixPath:
    member = pathlib.PurePosixPath(name)
    if (
        member.is_absolute()
        or ".." in member.parts
        or not member.parts
    ):
        raise PipelineError("Regional map pack contains an unsafe path.")
    return member


def extract_map_pack(
    archive_path: pathlib.Path,
    output_directory: pathlib.Path,
    allowed_icaos: set[str],
    excluded_icaos: set[str],
) -> tuple[list[str], int]:
    outputs: list[str] = []
    bytes_written = 0
    with zipfile.ZipFile(archive_path) as archive:
        try:
            pack_manifest = json.loads(
                archive.read("manifest.json").decode("utf-8")
            )
        except (KeyError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise PipelineError(
                "Regional map pack does not contain a valid manifest."
            ) from error
        if (
            int(pack_manifest.get("schemaVersion") or 0)
            != MAP_PACK_SCHEMA_VERSION
            or not isinstance(pack_manifest.get("maps"), list)
        ):
            raise PipelineError("Regional map-pack manifest is unsupported.")
        for entry in pack_manifest["maps"]:
            if not isinstance(entry, dict):
                continue
            icao = str(entry.get("icao") or "").strip().upper()
            if (
                icao not in allowed_icaos
                or icao in excluded_icaos
            ):
                continue
            member = safe_pack_member(str(entry.get("path") or ""))
            try:
                payload = archive.read(member.as_posix())
            except KeyError as error:
                raise PipelineError(
                    f"Regional map pack is missing {member.as_posix()}."
                ) from error
            expected = str(entry.get("sha256") or "").lower()
            if expected and hashlib.sha256(payload).hexdigest() != expected:
                raise PipelineError(
                    f"Regional map entry {icao} failed checksum verification."
                )
            map_data: dict[str, Any] = {}
            try:
                map_data = json.loads(payload.decode("utf-8"))
                map_icao = str(
                    (map_data.get("airport") or {}).get("icao") or ""
                ).strip().upper()
            except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
                map_icao = ""
            if (
                int(map_data.get("schemaVersion") or 0) != 2
                or map_icao != icao
            ):
                raise PipelineError(
                    f"Regional map entry {icao} is not a valid schema-v2 map."
                )
            path = output_directory / f"{icao}.json"
            atomic_write(path, payload)
            outputs.append(str(path))
            bytes_written += len(payload)
    return outputs, bytes_written


def acquire_regional_map_packs(
    protocol: Protocol,
    packs: list[dict[str, Any]],
    output_directory: pathlib.Path,
    cache: SourceCache,
    selected_icaos: set[str],
    excluded_icaos: set[str],
    max_parallel: int,
) -> tuple[list[str], int, list[str]]:
    if not packs:
        return [], 0, []
    pack_root = cache.root / "map-packs"
    pack_root.mkdir(parents=True, exist_ok=True)
    states_lock = threading.Lock()
    states: dict[str, dict[str, Any]] = {}
    warnings: list[str] = []

    def acquire(pack: dict[str, Any]):
        pack_id = re.sub(
            r"[^A-Za-z0-9_.-]+",
            "-",
            str(pack.get("id") or "map-pack"),
        )
        version = re.sub(
            r"[^A-Za-z0-9_.-]+",
            "-",
            str(pack.get("version") or "current"),
        )
        state = {
            "downloaded": 0,
            "total": int(pack.get("sizeBytes") or 0) or None,
            "speed": 0.0,
            "eta": None,
        }
        with states_lock:
            states[pack_id] = state

        def progress(downloaded, total, speed, eta):
            with states_lock:
                state.update(
                    downloaded=downloaded,
                    total=total,
                    speed=speed,
                    eta=eta,
                )

        archive_path = pack_root / f"{pack_id}-{version}.zip"
        download_file_resumable(
            str(pack["url"]),
            archive_path,
            str(pack["sha256"]),
            int(pack.get("sizeBytes") or 0) or None,
            progress,
        )
        return extract_map_pack(
            archive_path,
            output_directory,
            selected_icaos,
            excluded_icaos,
        )

    outputs: list[str] = []
    bytes_written = 0
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=max(1, min(max_parallel, len(packs))),
        thread_name_prefix="TaxiNow-pack",
    ) as executor:
        future_packs = {
            executor.submit(acquire, pack): pack
            for pack in packs
        }
        pending = set(future_packs)
        while pending:
            done, remaining = concurrent.futures.wait(
                pending,
                timeout=0.25,
                return_when=concurrent.futures.FIRST_COMPLETED,
            )
            pending = set(remaining)
            for future in done:
                pack = future_packs[future]
                try:
                    pack_outputs, pack_bytes = future.result()
                    outputs.extend(pack_outputs)
                    bytes_written += pack_bytes
                except Exception as error:
                    pack_name = str(
                        (pack or {}).get("id") or "regional pack"
                    )
                    warnings.append(f"{pack_name}: {error}")
            with states_lock:
                snapshots = [dict(value) for value in states.values()]
            downloaded = sum(int(value["downloaded"]) for value in snapshots)
            totals = [
                int(value["total"])
                for value in snapshots
                if value.get("total")
            ]
            speed = sum(float(value["speed"]) for value in snapshots)
            protocol.progress(
                "downloading_map_pack",
                len(outputs),
                max(len(selected_icaos), 1),
                None,
                "TaxiNow Regional Map Pack",
                bytes_written,
                warnings,
                bytes_downloaded=downloaded,
                download_bytes_total=sum(totals) if totals else None,
                download_bytes_per_second=speed,
            )
    return sorted(set(outputs)), bytes_written, warnings


def bundled_catalog(name: str) -> bytes | None:
    base = pathlib.Path(
        getattr(sys, "_MEIPASS", pathlib.Path(__file__).resolve().parent)
    )
    path = base / "data" / f"{name}.gz"
    if not path.exists():
        return None
    try:
        return gzip.decompress(path.read_bytes())
    except (OSError, EOFError):
        return None


def load_catalog_dataset(
    cache: SourceCache,
    name: str,
    urls: tuple[str, ...],
    progress_callback=None,
) -> bytes:
    key = SourceCache.key("ourairports", name)
    fresh = cache.read_bytes(key, CATALOG_MAXIMUM_AGE)
    if fresh is not None:
        raw = fresh
    else:
        stale = cache.read_bytes_stale(key)
        seed = bundled_catalog(name)
        if stale is None and seed is not None:
            raw = seed
        else:
            errors: list[str] = []
            raw = None
            for url in urls:
                try:
                    raw = request_bytes(
                        url,
                        timeout=CATALOG_REQUEST_TIMEOUT,
                        attempts=CATALOG_ATTEMPTS_PER_URL,
                        progress_callback=progress_callback,
                    )
                    break
                except PipelineError as error:
                    errors.append(
                        f"{urllib.parse.urlparse(url).netloc}: {error}"
                    )
            if raw is None:
                raw = stale or seed
            if raw is None:
                raise PipelineError(
                    f"Unable to obtain {name}: " + "; ".join(errors)
                )
        cache.write_bytes(key, raw)

    work_name = f"ourairports-{name}"
    work_path = cache.root / "work" / work_name
    if not work_path.exists() or work_path.stat().st_size != len(raw):
        atomic_write(work_path, raw)
    return raw


def load_airports(cache: SourceCache, progress_callback=None) -> list[Airport]:
    raw = load_catalog_dataset(
        cache,
        "airports.csv",
        OURAIRPORTS_URLS,
        progress_callback,
    )
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
            len(ident) != 4
            or not ident.isalnum()
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
    endpoint_offset = int(
        hashlib.sha256(airport.icao.encode("ascii")).hexdigest()[:8],
        16,
    ) % len(OVERPASS_URLS)
    endpoints = (
        OVERPASS_URLS[endpoint_offset:] + OVERPASS_URLS[:endpoint_offset]
    )
    for endpoint in endpoints:
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
    raw = load_catalog_dataset(
        cache,
        "runways.csv",
        RUNWAYS_URLS,
    )
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


def download_airports_parallel(
    protocol: Protocol,
    airports: list[Airport],
    output_directory: pathlib.Path,
    cache: SourceCache,
    max_parallel: int,
    warnings: list[str],
    initial_completed: int = 0,
    overall_total: int | None = None,
) -> tuple[list[str], int, list[str]]:
    work_total = len(airports)
    total = overall_total or work_total
    if work_total == 0:
        return [], 0, warnings

    worker_count = max(1, min(max_parallel, work_total))
    state_lock = threading.Lock()
    states: dict[str, dict[str, Any]] = {
        airport.icao: {
            "phase": "queued",
            "percentage": 0.0,
            "source": "OpenStreetMap",
            "bytes_downloaded": 0,
            "download_bytes_total": None,
            "download_bytes_per_second": 0.0,
            "estimated_remaining_seconds": None,
        }
        for airport in airports
    }

    def acquire(airport: Airport) -> tuple[pathlib.Path, int, list[str]]:
        local_warnings: list[str] = []

        def update_progress(**values: Any) -> None:
            with state_lock:
                states[airport.icao].update(values)

        update_progress(phase="acquiring", percentage=0.0)
        try:
            path, written = download_airport(
                airport,
                output_directory,
                cache,
                update_progress,
            )
            update_progress(phase="normalizing", percentage=100.0)
            return path, written, local_warnings
        except Exception as error:
            local_warnings.append(f"{airport.icao}: {error}")
            update_progress(
                phase="runway_fallback",
                percentage=70.0,
                source="OurAirports",
                download_bytes_per_second=0.0,
                estimated_remaining_seconds=None,
            )
            try:
                path, written = download_runway_fallback(
                    airport,
                    output_directory,
                    cache,
                )
                local_warnings.append(
                    f"{airport.icao}: using runway-only OurAirports fallback."
                )
                update_progress(phase="normalizing", percentage=100.0)
                return path, written, local_warnings
            except Exception as fallback_error:
                local_warnings.append(
                    f"{airport.icao}: fallback failed: {fallback_error}"
                )
                update_progress(phase="failed", percentage=100.0)
                return pathlib.Path(), 0, local_warnings

    outputs: list[str] = []
    bytes_written = 0
    completed = 0
    batch_started = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=worker_count,
        thread_name_prefix="TaxiNow-map",
    ) as executor:
        future_airports = {
            executor.submit(acquire, airport): airport
            for airport in airports
        }
        pending = set(future_airports)
        while pending:
            done, pending = concurrent.futures.wait(
                pending,
                timeout=0.25,
                return_when=concurrent.futures.FIRST_COMPLETED,
            )
            for future in done:
                path, written, local_warnings = future.result()
                if written > 0:
                    outputs.append(str(path))
                    bytes_written += written
                warnings.extend(local_warnings)
                completed += 1

            with state_lock:
                snapshots = {
                    icao: dict(state)
                    for icao, state in states.items()
                }
            pending_icaos = {
                future_airports[future].icao
                for future in pending
            }
            active = [
                (icao, snapshots[icao])
                for icao in sorted(pending_icaos)
                if snapshots[icao]["phase"] != "queued"
            ]
            partial = sum(
                max(0.0, min(float(state["percentage"]), 100.0)) / 100.0
                for _, state in active
            )
            aggregate_percentage = (
                (initial_completed + completed + partial) * 100.0 / total
            )
            active_names = [icao for icao, _ in active]
            current_icao = ", ".join(active_names[:3])
            if len(active_names) > 3:
                current_icao += f" +{len(active_names) - 3}"
            speed = sum(
                float(state.get("download_bytes_per_second") or 0.0)
                for _, state in active
            )
            downloaded = sum(
                int(state.get("bytes_downloaded") or 0)
                for state in snapshots.values()
            )
            known_totals = [
                int(state["download_bytes_total"])
                for state in snapshots.values()
                if state.get("download_bytes_total") is not None
            ]
            elapsed = max(time.monotonic() - batch_started, 0.001)
            eta_sample_minimum = min(4, work_total)
            if (
                completed >= eta_sample_minimum
                and completed < work_total
            ):
                eta = elapsed / completed * (work_total - completed)
            else:
                eta = None
            phases = {str(state["phase"]) for _, state in active}
            phase = (
                "waiting_sources"
                if any(value.startswith("waiting_") for value in phases)
                else "acquiring_parallel"
            )
            sources = sorted(
                {str(state["source"]) for _, state in active if state.get("source")}
            )
            protocol.progress(
                phase,
                initial_completed + completed,
                total,
                current_icao or None,
                " + ".join(sources) or "OpenStreetMap",
                bytes_written,
                warnings,
                estimated_remaining_seconds=eta,
                bytes_downloaded=downloaded,
                download_bytes_total=sum(known_totals) if known_totals else None,
                download_bytes_per_second=speed,
                overall_percentage=aggregate_percentage,
            )

    return sorted(outputs), bytes_written, warnings


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
        matches = [
            airport
            for airport in catalog
            if airport.country_code == country
            and len(airport.icao) == 4
            and airport.icao.isalnum()
        ]
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
    # Seed the shared SkyCharts-compatible work cache before any parallel
    # workers start. This avoids duplicate catalog downloads and gives every
    # airport a runway-derived OSM query boundary.
    load_catalog_dataset(cache, "runways.csv", RUNWAYS_URLS)
    selected = select_airports(request, catalog)
    total = len(selected)
    completed = 0
    bytes_written = 0
    warnings: list[str] = []
    outputs: list[str] = []
    excluded: set[str] = set()
    requested_parallel = int(request.get("maxParallel") or 1)
    if requested_parallel not in ALLOWED_PARALLEL_DOWNLOADS:
        raise PipelineError(
            "maxParallel must be 1, 2, 4, 8, or 16."
        )
    max_parallel = (
        requested_parallel
        if request.get("command") == "download_country"
        else 1
    )
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

        if selected:
            try:
                pack_index = load_map_pack_index(cache)
                packs = select_map_packs(
                    pack_index,
                    country,
                    region or None,
                )
                if packs:
                    pack_outputs, pack_bytes, pack_warnings = (
                        acquire_regional_map_packs(
                            protocol,
                            packs,
                            output,
                            cache,
                            {airport.icao for airport in selected},
                            excluded,
                            max_parallel,
                        )
                    )
                    outputs.extend(pack_outputs)
                    bytes_written += pack_bytes
                    warnings.extend(pack_warnings)
                    packed_icaos = {
                        pathlib.Path(path).stem.upper()
                        for path in pack_outputs
                    }
                    if packed_icaos:
                        selected = [
                            airport for airport in selected
                            if airport.icao not in packed_icaos
                        ]
                        completed = len(packed_icaos)
                        warnings.append(
                            f"Installed {len(packed_icaos)} airport"
                            f"{'' if len(packed_icaos) == 1 else 's'} "
                            "from verified regional map packs."
                        )
            except Exception as error:
                warnings.append(
                    "Regional map packs unavailable; continuing with "
                    f"on-demand sources ({error})."
                )

    if max_parallel > 1 and selected:
        acquired, acquired_bytes, warnings = download_airports_parallel(
            protocol,
            selected,
            output,
            cache,
            max_parallel,
            warnings,
            initial_completed=completed,
            overall_total=total,
        )
        outputs.extend(acquired)
        bytes_written += acquired_bytes
        completed = total
    else:
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
            except Exception as error:
                warnings.append(f"{airport.icao}: {error}")
                try:
                    path, written = download_runway_fallback(
                        airport,
                        output,
                        cache,
                    )
                    outputs.append(str(path))
                    bytes_written += written
                    warnings.append(
                        f"{airport.icao}: using runway-only OurAirports fallback."
                    )
                except Exception as fallback_error:
                    warnings.append(
                        f"{airport.icao}: fallback failed: {fallback_error}"
                    )
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
    source_revision = source.get("sourceRevision")
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
                "revision": (
                    None
                    if source_revision is None
                    else str(source_revision)
                ),
            }
        ],
        "counts": counts,
        "features": features,
    }
    if source.get("qualityWarnings"):
        result["qualityWarnings"] = list(source["qualityWarnings"])
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
