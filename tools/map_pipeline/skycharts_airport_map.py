#!/usr/bin/env python3
"""Download and normalize reusable airport geometry.

Refactored from the same-maintainer SkyCharts airport-map generator for
TaxiNow's Windows pipeline. The module remains independent of chart downloads
and uses only public airport-geometry sources.
"""

import argparse
import base64
import csv
import datetime as dt
import io
import json
import math
import os
import pathlib
import re
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
AIRPORTS_CSV = "https://davidmegginson.github.io/ourairports-data/airports.csv"
RUNWAYS_CSV = "https://davidmegginson.github.io/ourairports-data/runways.csv"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_ENDPOINTS = (
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    OVERPASS_URL,
    "https://overpass.private.coffee/api/interpreter",
)
OVERPASS_REQUEST_TIMEOUT = 35
OVERPASS_TOTAL_TIMEOUT = 120
OVERPASS_FAILURE_COOLDOWN = 60
OVERPASS_MAX_FAILURE_COOLDOWN = 15 * 60
OVERPASS_BUSY_WAIT = 120
AIRPORT_QUERY_MARGIN_METRES = 1200
AIRPORT_FEATURE_DISTANCE_METRES = 1200
AIRPORT_FEATURE_CONNECTION_METRES = 90
NON_OSM_CACHE_MAX_AGE_DAYS = 1 / 48
UNAVAILABLE_CACHE_REVISION = 3
OSM_SOURCE_REVISION = 10
XPLANE_SOURCE_REVISION = 4
XPLANE_GATEWAY_AIRPORT_URL = "https://gateway.x-plane.com/apiv1/airport/{ident}"
XPLANE_GATEWAY_SCENERY_URL = "https://gateway.x-plane.com/apiv1/scenery/{scenery_id}"
XPLANE_GATEWAY_SOURCE_URL = "https://gateway.x-plane.com/"
XPLANE_REQUEST_TIMEOUT = 15
XPLANE_FAILURE_COOLDOWN = 120
FAA_AM_SERVICE_ROOT = (
    "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services"
)
FAA_AM_SERVICES = {
    "building": "AM_Building",
    "taxiway": "AM_Taxiway",
    "apron": "AM_Apron",
}
FAA_AM_SOURCE_URL = "https://adds-faa.opendata.arcgis.com/"
FAA_REQUEST_TIMEOUT = 20
TRANSIENT_UNAVAILABLE_SECONDS = 15 * 60
MISSING_DATA_SECONDS = 7 * 24 * 60 * 60
MAP_KINDS = (
    "runway",
    "taxiway",
    "taxilane",
    "apron",
    "parking_position",
    "gate",
    "holding_position",
    "terminal",
    "hangar",
)
POLYGON_KINDS = {"apron", "terminal", "hangar", "pavement"}


class AirportMapError(RuntimeError):
    pass


class OverpassUnavailableError(AirportMapError):
    pass


class XPlaneGatewayUnavailableError(AirportMapError):
    pass


class XPlaneGatewayNoDataError(AirportMapError):
    pass


_DATASET_LOCK = threading.Lock()
_INDEX_LOCK = threading.Lock()
_ENDPOINT_LOCK = threading.Lock()
_ENDPOINT_CONDITION = threading.Condition(_ENDPOINT_LOCK)
_AIRPORT_INDEX = {}
_RUNWAY_INDEX = {}
_ENDPOINT_RETRY_AFTER = {}
_ENDPOINT_IN_FLIGHT = set()
_ENDPOINT_FAILURE_COUNT = {}
_ENDPOINT_LATENCY = {}
_XPLANE_RETRY_AFTER = 0
_OVERPASS_REQUEST_LOCK = threading.Lock()


def report_progress(callback, phase, percentage, source, **metrics):
    if callback:
        metrics.setdefault("bytes_downloaded", 0)
        metrics.setdefault("download_bytes_total", None)
        metrics.setdefault("download_bytes_per_second", 0.0)
        metrics.setdefault("estimated_remaining_seconds", None)
        callback(
            phase=phase,
            percentage=float(percentage),
            source=source,
            **metrics,
        )


def read_response(response, progress, phase, start_percentage, end_percentage, source):
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
        fraction = min(1.0, downloaded / total) if total else 0.0
        percentage = start_percentage + (end_percentage - start_percentage) * fraction
        eta = (total - downloaded) / speed if total and speed > 0 else None
        report_progress(
            progress,
            phase,
            percentage,
            source,
            bytes_downloaded=downloaded,
            download_bytes_total=total,
            download_bytes_per_second=speed,
            estimated_remaining_seconds=eta,
        )
    report_progress(
        progress,
        phase,
        end_percentage,
        source,
        bytes_downloaded=downloaded,
        download_bytes_total=total or downloaded,
        download_bytes_per_second=(
            downloaded / max(time.monotonic() - started, 0.001)
            if downloaded
            else None
        ),
        estimated_remaining_seconds=0,
    )
    return b"".join(chunks)


def ensure_csv_dataset(url, path, progress=None):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file():
        return
    with _DATASET_LOCK:
        if path.is_file():
            return
        request = urllib.request.Request(
            url,
            headers={"User-Agent": "TaxiNow/0.1 airport-map downloader"},
        )
        report_progress(progress, "downloading_catalog", 2, "OurAirports")
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = read_response(
                response, progress, "downloading_catalog", 2, 7, "OurAirports"
            )
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=path.stem + "-", suffix=".csv", dir=str(path.parent)
        )
        os.close(descriptor)
        temporary = pathlib.Path(temporary_name)
        try:
            temporary.write_bytes(payload)
            temporary.replace(path)
        finally:
            if temporary.exists():
                temporary.unlink()


def ensure_airports_csv(path, progress=None):
    ensure_csv_dataset(AIRPORTS_CSV, path, progress)


def ensure_runways_csv(path):
    ensure_csv_dataset(RUNWAYS_CSV, path)


def csv_index(path, cache, keys):
    path = pathlib.Path(path)
    signature = (str(path.resolve()), path.stat().st_mtime_ns, path.stat().st_size)
    with _INDEX_LOCK:
        cached = cache.get("value")
        if cache.get("signature") == signature and cached is not None:
            return cached
        indexed = {}
        with path.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                for key in keys(row):
                    key = (key or "").strip().upper()
                    if key:
                        indexed.setdefault(key, []).append(row)
        cache["signature"] = signature
        cache["value"] = indexed
        return indexed


def airport_record(ident, airports_csv=None, progress=None):
    ident = ident.strip().upper()
    airports_csv = pathlib.Path(airports_csv or ROOT / "work" / "ourairports-airports.csv")
    ensure_airports_csv(airports_csv, progress)
    index = csv_index(airports_csv, _AIRPORT_INDEX, lambda row: (row.get("gps_code"), row.get("ident")))
    for row in index.get(ident, []):
        try:
            latitude = float(row["latitude_deg"])
            longitude = float(row["longitude_deg"])
        except (KeyError, TypeError, ValueError):
            continue
        return {
            "ident": ident,
            "name": row.get("name") or ident,
            "latitude": latitude,
            "longitude": longitude,
            "country_code": (row.get("iso_country") or "").strip().upper(),
        }
    raise AirportMapError("Airport %s was not found in the airport index" % ident)


def overpass_query(latitude, longitude, radius=5500, bounds=None):
    south, west, north, east = (
        bounds if bounds is not None
        else coordinate_bounds(latitude, longitude, radius)
    )
    bbox = "{:.7f},{:.7f},{:.7f},{:.7f}".format(south, west, north, east)
    return """[out:json][timeout:25];
(
  nwr["aeroway"]({bbox});
  nwr["building"~"^(terminal|hangar)$"]({bbox});
  nwr["building"]["name"~"terminal|concourse|satellite",i]({bbox});
);
out body geom;""".format(bbox=bbox)


def overpass_terminal_query(bounds):
    south, west, north, east = bounds
    bbox = "{:.7f},{:.7f},{:.7f},{:.7f}".format(south, west, north, east)
    return """[out:json][timeout:20];
(
  nwr["aeroway"="terminal"]({bbox});
  nwr["building"]({bbox});
);
out body geom;""".format(bbox=bbox)


def coordinate_bounds(latitude, longitude, radius):
    latitude_delta = radius / 111320.0
    longitude_delta = radius / (111320.0 * max(0.2, math.cos(math.radians(latitude))))
    return latitude - latitude_delta, longitude - longitude_delta, latitude + latitude_delta, longitude + longitude_delta


def overpass_kind_query(latitude, longitude, kind, radius=5500):
    south, west, north, east = coordinate_bounds(latitude, longitude, radius)
    bbox = "{:.7f},{:.7f},{:.7f},{:.7f}".format(south, west, north, east)
    selectors = ['way["aeroway"="%s"](%s);' % (kind, bbox)]
    if kind in ("parking_position", "gate", "holding_position"):
        selectors.append('node["aeroway"="%s"](%s);' % (kind, bbox))
    return "[out:json][timeout:45];(%s);out tags geom;" % "".join(selectors)


def short_network_error(error):
    if isinstance(error, urllib.error.HTTPError):
        return "HTTP %s" % error.code
    reason = getattr(error, "reason", error)
    text = str(reason).strip() or error.__class__.__name__
    return text if len(text) <= 72 else text[:69] + "..."


def request_overpass(query, endpoints, timeout=OVERPASS_REQUEST_TIMEOUT, progress=None):
    """Serialize public Overpass work across airport download workers.

    Public instances apply per-user slots and cooldowns. Sending several
    expensive airport queries at once normally reduces aggregate throughput,
    even when the requests are spread across public endpoints.
    """
    with _OVERPASS_REQUEST_LOCK:
        return _request_overpass_unlocked(
            query,
            endpoints,
            timeout=timeout,
            progress=progress,
        )


def _request_overpass_unlocked(
    query,
    endpoints,
    timeout=OVERPASS_REQUEST_TIMEOUT,
    progress=None,
):
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    errors = []
    attempted = set()
    started = time.monotonic()
    request_deadline = started + OVERPASS_TOTAL_TIMEOUT
    busy_deadline = min(
        request_deadline,
        started + OVERPASS_BUSY_WAIT,
    )
    report_progress(progress, "waiting_for_map_source", 8, "OpenStreetMap")
    while True:
        candidate = None
        with _ENDPOINT_CONDITION:
            while candidate is None:
                now = time.monotonic()
                eligible = sorted(
                    [
                    value for value in endpoints if value not in attempted
                    ],
                    key=lambda value: (
                        _ENDPOINT_FAILURE_COUNT.get(value, 0),
                        _ENDPOINT_LATENCY.get(value, float("inf")),
                        endpoints.index(value),
                    ),
                )
                candidate = next(
                    (
                        value
                        for value in eligible
                        if value not in _ENDPOINT_IN_FLIGHT
                        and _ENDPOINT_RETRY_AFTER.get(value, 0) <= now
                    ),
                    None,
                )
                if candidate:
                    _ENDPOINT_IN_FLIGHT.add(candidate)
                    break
                remaining = min(busy_deadline, request_deadline) - now
                if not eligible or remaining <= 0:
                    break
                retry_delays = [
                    _ENDPOINT_RETRY_AFTER.get(value, 0) - now
                    for value in eligible
                    if _ENDPOINT_RETRY_AFTER.get(value, 0) > now
                ]
                busy = any(
                    value in _ENDPOINT_IN_FLIGHT for value in eligible
                )
                if not busy and not retry_delays:
                    break
                wait_for = remaining
                if retry_delays:
                    wait_for = min(wait_for, min(retry_delays))
                _ENDPOINT_CONDITION.wait(timeout=max(0.05, wait_for))
        if not candidate:
            break
        attempted.add(candidate)
        request = urllib.request.Request(candidate, data=body, headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            "User-Agent": "TaxiNow/0.1 airport-map downloader",
        })
        try:
            report_progress(progress, "waiting_for_map_source", 12, "OpenStreetMap")
            attempt_started = time.monotonic()
            remaining = request_deadline - attempt_started
            if remaining <= 0:
                break
            with urllib.request.urlopen(
                request,
                timeout=max(1, min(timeout, remaining)),
            ) as response:
                payload = read_response(
                    response,
                    progress,
                    "downloading_map",
                    12,
                    76,
                    "OpenStreetMap",
                )
                result = json.loads(payload.decode("utf-8"))
            with _ENDPOINT_CONDITION:
                duration = time.monotonic() - attempt_started
                previous_latency = _ENDPOINT_LATENCY.get(candidate)
                _ENDPOINT_LATENCY[candidate] = (
                    duration
                    if previous_latency is None
                    else previous_latency * 0.65 + duration * 0.35
                )
                _ENDPOINT_FAILURE_COUNT[candidate] = 0
                _ENDPOINT_RETRY_AFTER.pop(candidate, None)
                _ENDPOINT_IN_FLIGHT.discard(candidate)
                _ENDPOINT_CONDITION.notify_all()
            return result
        except Exception as error:
            host = urllib.parse.urlparse(candidate).netloc
            errors.append("%s: %s" % (host, short_network_error(error)))
            with _ENDPOINT_CONDITION:
                failures = _ENDPOINT_FAILURE_COUNT.get(candidate, 0) + 1
                _ENDPOINT_FAILURE_COUNT[candidate] = failures
                cooldown = min(
                    OVERPASS_MAX_FAILURE_COOLDOWN,
                    OVERPASS_FAILURE_COOLDOWN * (2 ** (failures - 1)),
                )
                _ENDPOINT_RETRY_AFTER[candidate] = time.monotonic() + cooldown
                _ENDPOINT_IN_FLIGHT.discard(candidate)
                _ENDPOINT_CONDITION.notify_all()
        if time.monotonic() >= request_deadline:
            break
    if errors:
        raise OverpassUnavailableError("all available Overpass services failed (%s)" % "; ".join(errors))
    raise OverpassUnavailableError(
        "OpenStreetMap did not respond within %d seconds"
        % OVERPASS_TOTAL_TIMEOUT
    )


def fetch_overpass(
    latitude,
    longitude,
    radius=5500,
    endpoint=None,
    progress=None,
    bounds=None,
):
    endpoints = (endpoint,) if endpoint else OVERPASS_ENDPOINTS
    return request_overpass(
        overpass_query(latitude, longitude, radius, bounds),
        endpoints,
        progress=progress,
    )


def parse_osm_xml(payload, nodes, ways):
    root = ET.fromstring(payload)
    for element in root:
        if element.tag == "node":
            node_id = element.attrib.get("id")
            tags = {tag.attrib.get("k"): tag.attrib.get("v") for tag in element.findall("tag")}
            nodes[node_id] = {
                "type": "node",
                "id": int(node_id),
                "lat": float(element.attrib["lat"]),
                "lon": float(element.attrib["lon"]),
                "tags": tags,
            }
        elif element.tag == "way":
            way_id = element.attrib.get("id")
            ways[way_id] = {
                "type": "way",
                "id": int(way_id),
                "refs": [node.attrib.get("ref") for node in element.findall("nd")],
                "tags": {tag.attrib.get("k"): tag.attrib.get("v") for tag in element.findall("tag")},
            }


def fetch_osm_api(latitude, longitude, radius=5500):
    south, west, north, east = coordinate_bounds(latitude, longitude, radius)
    middle_latitude = (south + north) / 2
    middle_longitude = (west + east) / 2
    tiles = (
        (south, west, middle_latitude, middle_longitude),
        (south, middle_longitude, middle_latitude, east),
        (middle_latitude, west, north, middle_longitude),
        (middle_latitude, middle_longitude, north, east),
    )
    nodes, ways, errors = {}, {}, []

    def fetch_tile(tile, depth=0):
        tile_south, tile_west, tile_north, tile_east = tile
        url = "https://api.openstreetmap.org/api/0.6/map?bbox={:.7f},{:.7f},{:.7f},{:.7f}".format(tile_west, tile_south, tile_east, tile_north)
        request = urllib.request.Request(
            url,
            headers={"User-Agent": "TaxiNow/0.1 airport-map downloader"},
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                parse_osm_xml(response.read(), nodes, ways)
                return
        except urllib.error.HTTPError as error:
            if error.code == 400 and depth < 2:
                middle_lat = (tile_south + tile_north) / 2
                middle_lon = (tile_west + tile_east) / 2
                for smaller in (
                    (tile_south, tile_west, middle_lat, middle_lon),
                    (tile_south, middle_lon, middle_lat, tile_east),
                    (middle_lat, tile_west, tile_north, middle_lon),
                    (middle_lat, middle_lon, tile_north, tile_east),
                ):
                    fetch_tile(smaller, depth + 1)
                return
            errors.append("HTTP %s for airport tile" % error.code)
        except Exception as error:
            errors.append(str(error))

    for tile in tiles:
        fetch_tile(tile)
    if errors:
        raise AirportMapError("OpenStreetMap map tiles could not be downloaded: %s" % "; ".join(errors))
    elements = []
    point_kinds = ("parking_position", "gate", "holding_position")
    for node in nodes.values():
        if (node.get("tags") or {}).get("aeroway") in point_kinds:
            elements.append(node)
    for way in ways.values():
        if feature_kind(way.get("tags") or {}) not in MAP_KINDS:
            continue
        geometry = [{"lat": nodes[ref]["lat"], "lon": nodes[ref]["lon"]} for ref in way["refs"] if ref in nodes]
        if geometry:
            element = dict(way)
            element.pop("refs", None)
            element["geometry"] = geometry
            elements.append(element)
    return {"elements": elements}


def optional_float(row, key):
    try:
        value = str(row.get(key) or "").strip()
        return float(value) if value else None
    except (TypeError, ValueError):
        return None


def destination_coordinate(latitude, longitude, heading, distance_metres):
    radians = math.radians(heading)
    latitude_delta = math.cos(radians) * distance_metres / 111320.0
    longitude_delta = math.sin(radians) * distance_metres / (111320.0 * max(0.2, math.cos(math.radians(latitude))))
    return latitude + latitude_delta, longitude + longitude_delta


def ourairports_runway_raw(ident, airport, runways_csv=None):
    runways_csv = pathlib.Path(runways_csv or ROOT / "work" / "ourairports-runways.csv")
    ensure_runways_csv(runways_csv)
    index = csv_index(runways_csv, _RUNWAY_INDEX, lambda row: (row.get("airport_ident"),))
    elements = []
    for number, row in enumerate(index.get(ident.strip().upper(), []), 1):
        if str(row.get("closed") or "0").strip() == "1":
            continue
        length_metres = (optional_float(row, "length_ft") or 0) * 0.3048
        width_metres = (optional_float(row, "width_ft") or 0) * 0.3048
        le_latitude, le_longitude = optional_float(row, "le_latitude_deg"), optional_float(row, "le_longitude_deg")
        he_latitude, he_longitude = optional_float(row, "he_latitude_deg"), optional_float(row, "he_longitude_deg")
        le_heading, he_heading = optional_float(row, "le_heading_degT"), optional_float(row, "he_heading_degT")
        if le_latitude is not None and le_longitude is not None and (he_latitude is None or he_longitude is None) and length_metres and le_heading is not None:
            he_latitude, he_longitude = destination_coordinate(le_latitude, le_longitude, le_heading, length_metres)
        elif he_latitude is not None and he_longitude is not None and (le_latitude is None or le_longitude is None) and length_metres:
            reverse_heading = he_heading if he_heading is not None else ((le_heading + 180) % 360 if le_heading is not None else None)
            if reverse_heading is not None:
                le_latitude, le_longitude = destination_coordinate(he_latitude, he_longitude, reverse_heading, length_metres)
        elif (le_latitude is None or le_longitude is None or he_latitude is None or he_longitude is None) and length_metres and le_heading is not None:
            le_latitude, le_longitude = destination_coordinate(airport["latitude"], airport["longitude"], le_heading + 180, length_metres / 2)
            he_latitude, he_longitude = destination_coordinate(airport["latitude"], airport["longitude"], le_heading, length_metres / 2)
        if None in (le_latitude, le_longitude, he_latitude, he_longitude):
            continue
        low = str(row.get("le_ident") or "").strip().upper()
        high = str(row.get("he_ident") or "").strip().upper()
        reference = "/".join(value for value in (low, high) if value) or "RWY%d" % number
        tags = {"aeroway": "runway", "ref": reference, "operator": "OurAirports"}
        surface = str(row.get("surface") or "").strip()
        if surface:
            tags["surface"] = surface
        if width_metres:
            tags["width"] = "%.2f" % width_metres
        elements.append({
            "type": "way",
            "id": "ourairports-%s-%s" % (ident, row.get("id") or number),
            "tags": tags,
            "geometry": [
                {"lat": le_latitude, "lon": le_longitude},
                {"lat": he_latitude, "lon": he_longitude},
            ],
        })
    return {"elements": elements}


def airport_query_bounds(
    airport,
    runway_raw,
    maximum_radius=5500,
    margin_metres=AIRPORT_QUERY_MARGIN_METRES,
):
    """Build a compact airport bbox from known runway endpoints.

    The fixed-radius query remains the safety envelope. Runway data normally
    cuts out nearby heliports and unrelated airport facilities while retaining
    enough room for terminals, aprons, hangars, and connecting taxiways.
    """
    fixed = coordinate_bounds(
        airport["latitude"],
        airport["longitude"],
        maximum_radius,
    )
    points = [
        pair
        for element in (runway_raw or {}).get("elements", [])
        for pair in (
            point_pair(value)
            for value in element.get("geometry", [])
        )
        if pair
    ]
    if not points:
        return fixed
    center_latitude = airport["latitude"]
    latitude_padding = margin_metres / 111320.0
    longitude_padding = margin_metres / (
        111320.0
        * max(0.2, math.cos(math.radians(center_latitude)))
    )
    south = min(point[1] for point in points) - latitude_padding
    west = min(point[0] for point in points) - longitude_padding
    north = max(point[1] for point in points) + latitude_padding
    east = max(point[0] for point in points) + longitude_padding
    fixed_south, fixed_west, fixed_north, fixed_east = fixed
    return (
        max(fixed_south, south),
        max(fixed_west, west),
        min(fixed_north, north),
        min(fixed_east, east),
    )


def fetch_overpass_terminals(bounds, endpoint=None, progress=None):
    endpoints = (endpoint,) if endpoint else OVERPASS_ENDPOINTS
    return request_overpass(
        overpass_terminal_query(bounds),
        endpoints,
        timeout=min(OVERPASS_REQUEST_TIMEOUT, 25),
        progress=progress,
    )


def request_xplane_json(url, progress=None):
    global _XPLANE_RETRY_AFTER
    with _ENDPOINT_LOCK:
        if _XPLANE_RETRY_AFTER > time.monotonic():
            raise XPlaneGatewayUnavailableError("X-Plane Scenery Gateway is in a short retry cooldown")
    request = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "User-Agent": "TaxiNow/0.1 airport-map downloader",
    })
    try:
        report_progress(progress, "waiting_for_fallback_source", 54, "X-Plane Gateway")
        with urllib.request.urlopen(request, timeout=XPLANE_REQUEST_TIMEOUT) as response:
            payload = json.loads(
                read_response(
                    response,
                    progress,
                    "downloading_fallback",
                    54,
                    76,
                    "X-Plane Gateway",
                ).decode("utf-8")
            )
        with _ENDPOINT_LOCK:
            _XPLANE_RETRY_AFTER = 0
        return payload
    except urllib.error.HTTPError as error:
        if error.code == 404:
            raise XPlaneGatewayNoDataError("airport is not present in the X-Plane Scenery Gateway")
        with _ENDPOINT_LOCK:
            _XPLANE_RETRY_AFTER = time.monotonic() + XPLANE_FAILURE_COOLDOWN
        raise XPlaneGatewayUnavailableError("X-Plane Scenery Gateway returned HTTP %s" % error.code)
    except XPlaneGatewayNoDataError:
        raise
    except Exception as error:
        with _ENDPOINT_LOCK:
            _XPLANE_RETRY_AFTER = time.monotonic() + XPLANE_FAILURE_COOLDOWN
        raise XPlaneGatewayUnavailableError("X-Plane Scenery Gateway request failed: %s" % short_network_error(error))


def scenery_identifier(airport):
    recommended = airport.get("recommendedSceneryId") or airport.get("recommended_scenery_id")
    if recommended:
        return str(recommended)
    candidates = airport.get("scenery") or airport.get("sceneries") or []
    if isinstance(candidates, dict):
        candidates = list(candidates.values())
    approved = []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        status = str(candidate.get("status") or candidate.get("Status") or "").lower()
        identifier = candidate.get("sceneryId") or candidate.get("id")
        if identifier and ("approv" in status or "recommend" in status):
            approved.append((str(candidate.get("dateApproved") or candidate.get("date") or ""), str(identifier)))
    return max(approved)[1] if approved else None


def extract_xplane_apt(zip_payload, ident):
    if len(zip_payload) > 40 * 1024 * 1024:
        raise AirportMapError("X-Plane airport scenery archive is unexpectedly large")
    try:
        with zipfile.ZipFile(io.BytesIO(zip_payload)) as archive:
            candidates = [entry for entry in archive.infolist()
                          if not entry.is_dir() and entry.filename.lower().endswith(".dat")
                          and entry.file_size <= 20 * 1024 * 1024]
            preferred = next((entry for entry in candidates
                              if pathlib.PurePosixPath(entry.filename).name.upper() == ident.upper() + ".DAT"), None)
            entry = preferred or (candidates[0] if candidates else None)
            if entry is None:
                raise XPlaneGatewayNoDataError("recommended X-Plane scenery does not contain airport data")
            payload = archive.read(entry)
    except zipfile.BadZipFile:
        raise XPlaneGatewayUnavailableError("X-Plane Scenery Gateway returned an invalid scenery archive")
    try:
        return payload.decode("utf-8-sig"), entry.filename
    except UnicodeDecodeError:
        return payload.decode("latin-1"), entry.filename


def extract_xplane_dsf_text(zip_payload, ident):
    try:
        with zipfile.ZipFile(io.BytesIO(zip_payload)) as archive:
            candidates = [entry for entry in archive.infolist()
                          if not entry.is_dir() and entry.filename.lower().endswith(".txt")
                          and entry.file_size <= 20 * 1024 * 1024]
            preferred = [entry for entry in candidates
                         if pathlib.PurePosixPath(entry.filename).name.upper() == ident.upper() + ".TXT"]
            for entry in preferred + [entry for entry in candidates if entry not in preferred]:
                payload = archive.read(entry)
                try:
                    text = payload.decode("utf-8-sig")
                except UnicodeDecodeError:
                    text = payload.decode("latin-1")
                if "POLYGON_DEF " in text and "BEGIN_POLYGON " in text:
                    return text, entry.filename
    except zipfile.BadZipFile:
        return None, None
    return None, None


def fetch_xplane_gateway_apt(ident, progress=None):
    airport_response = request_xplane_json(
        XPLANE_GATEWAY_AIRPORT_URL.format(ident=urllib.parse.quote(ident)),
        progress,
    )
    airport = airport_response.get("airport") if isinstance(airport_response, dict) else None
    airport = airport if isinstance(airport, dict) else airport_response
    if not isinstance(airport, dict):
        raise XPlaneGatewayUnavailableError("X-Plane Scenery Gateway returned an invalid airport record")
    identifier = scenery_identifier(airport)
    if not identifier:
        raise XPlaneGatewayNoDataError("airport has no approved scenery in the X-Plane Scenery Gateway")
    scenery_response = request_xplane_json(
        XPLANE_GATEWAY_SCENERY_URL.format(scenery_id=urllib.parse.quote(identifier)),
        progress,
    )
    scenery = scenery_response.get("scenery") if isinstance(scenery_response, dict) else None
    scenery = scenery if isinstance(scenery, dict) else scenery_response
    if not isinstance(scenery, dict):
        raise XPlaneGatewayUnavailableError("X-Plane Scenery Gateway returned an invalid scenery record")
    blob = scenery.get("masterZipBlob")
    if not blob:
        raise XPlaneGatewayNoDataError("recommended X-Plane scenery has no downloadable airport data")
    try:
        zip_payload = base64.b64decode(blob)
    except (TypeError, ValueError) as error:
        raise XPlaneGatewayUnavailableError("X-Plane scenery archive could not be decoded: %s" % error)
    apt_text, apt_name = extract_xplane_apt(zip_payload, ident)
    dsf_text, dsf_name = extract_xplane_dsf_text(zip_payload, ident)
    return apt_text, {
        "sceneryId": identifier,
        "aptName": apt_name,
        "dsfName": dsf_name or "",
        "dsfText": dsf_text or "",
        "artist": scenery.get("userName") or scenery.get("artist") or "",
        "approvedAt": scenery.get("dateApproved") or "",
    }


def xplane_surface_name(value):
    return {
        "1": "asphalt", "2": "concrete", "3": "turf/grass", "4": "dirt",
        "5": "gravel", "12": "dry lakebed", "13": "water", "14": "snow/ice",
        "15": "transparent",
    }.get(str(value), str(value))


def xplane_is_apron_pavement(name):
    value = str(name or "").strip().lower()
    return any(word in value for word in ("apron", "ramp", "parking"))


def parse_xplane_apt(text, ident):
    ident = ident.strip().upper()
    elements, taxi_nodes, taxi_edges = [], {}, []
    polygon_name, polygon_surface, polygon_points = None, None, []
    active, found_airport, serial = False, False, 0

    def add_polygon(close=False):
        nonlocal polygon_points, serial
        if len(polygon_points) < 3:
            polygon_points = []
            return
        if not xplane_is_apron_pavement(polygon_name):
            polygon_points = []
            return
        points = list(polygon_points)
        if close and points[0] != points[-1]:
            points.append(dict(points[0]))
        serial += 1
        tags = {"aeroway": "apron", "operator": "X-Plane Scenery Gateway"}
        if polygon_name:
            tags["name"] = polygon_name
        if polygon_surface:
            tags["surface"] = xplane_surface_name(polygon_surface)
        elements.append({"type": "way", "id": "xplane-apron-%d" % serial, "tags": tags, "geometry": points})
        polygon_points = []

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        values = line.split()
        code = values[0]
        if code in ("1", "16", "17") and len(values) >= 5:
            add_polygon()
            airport_ident = values[4].upper()
            if active and airport_ident != ident:
                break
            active = airport_ident == ident
            found_airport = found_airport or active
            continue
        if not active:
            continue
        if code not in ("111", "112", "113", "114"):
            add_polygon()
        try:
            if code == "100" and len(values) >= 20:
                serial += 1
                low, high = values[8].upper(), values[17].upper()
                tags = {
                    "aeroway": "runway",
                    "ref": "/".join(value for value in (low, high) if value),
                    "width": values[1],
                    "surface": xplane_surface_name(values[2]),
                    "operator": "X-Plane Scenery Gateway",
                }
                elements.append({
                    "type": "way", "id": "xplane-runway-%d" % serial, "tags": tags,
                    "geometry": [
                        {"lat": float(values[9]), "lon": float(values[10])},
                        {"lat": float(values[18]), "lon": float(values[19])},
                    ],
                })
            elif code == "110" and len(values) >= 4:
                polygon_surface = values[1]
                polygon_name = " ".join(values[4:]).strip()
                polygon_points = []
            elif code in ("111", "112", "113", "114") and polygon_name is not None and len(values) >= 3:
                polygon_points.append({"lat": float(values[1]), "lon": float(values[2])})
                if code in ("113", "114"):
                    add_polygon(close=True)
            elif code == "1201" and len(values) >= 5:
                taxi_nodes[values[4]] = {"lat": float(values[1]), "lon": float(values[2])}
            elif code == "1202" and len(values) >= 5:
                taxi_edges.append(values)
            elif code == "1300" and len(values) >= 6:
                name = " ".join(values[6:]).strip()
                if not name:
                    continue
                reference = re.sub(r"^(?:gate|stand|parking(?: position)?|ramp)\s*[-#:]?\s*", "", name,
                                   flags=re.IGNORECASE).strip() or name
                serial += 1
                kind = "gate" if values[4].lower() == "gate" else "parking_position"
                elements.append({
                    "type": "node", "id": "xplane-ramp-%d" % serial,
                    "lat": float(values[1]), "lon": float(values[2]),
                    "tags": {"aeroway": kind, "ref": reference, "name": name,
                             "operator": "X-Plane Scenery Gateway"},
                })
        except (IndexError, TypeError, ValueError):
            continue
    add_polygon()
    if not found_airport:
        raise XPlaneGatewayNoDataError("downloaded X-Plane airport data does not contain %s" % ident)
    for edge in taxi_edges:
        start, end = taxi_nodes.get(edge[1]), taxi_nodes.get(edge[2])
        if not start or not end:
            continue
        route_class = edge[4]
        if route_class.lower().startswith("runway"):
            continue
        reference = " ".join(edge[5:]).strip()
        serial += 1
        tags = {"aeroway": "taxiway", "operator": "X-Plane Scenery Gateway"}
        if reference and reference != "_stop":
            tags["ref"] = reference
        elements.append({
            "type": "way", "id": "xplane-taxi-%d" % serial, "tags": tags,
            "geometry": [dict(start), dict(end)],
        })
    return {"elements": elements}


def xplane_polygon_area(points):
    area = 0
    for index, point in enumerate(points):
        following = points[(index + 1) % len(points)]
        area += point["lon"] * following["lat"] - following["lon"] * point["lat"]
    return area / 2


def xplane_terminal_definition(path):
    """Return true only for facade definitions that describe a ground footprint.

    Gateway airports commonly build one terminal from separate ground, upper-level,
    roof, bridge, and detail facades.  Treating every layer as a footprint produces
    the hundreds of overlapping polygons seen at CYVR.  Older Gateway scenery such
    as CYUL instead uses the generic modern/classic airport facades, so those must be
    accepted too.
    """
    value = path.strip().lower()
    return ("/terminal_kit/term_building_ground_" in value
            or "/terminal_kit/term_building_bighall_" in value
            or "/modern_airports/facades/modern" in value
            or "/classic_airports/facades/classic" in value
            or "/buildings/terminals/" in value
            or "/terminal/building" in value)


def xplane_distance_metres(left, right, latitude):
    north = (left["lat"] - right["lat"]) * 111320.0
    east = ((left["lon"] - right["lon"]) * 111320.0
            * max(0.2, math.cos(math.radians(latitude))))
    return math.hypot(east, north)


def xplane_point_to_segment_metres(point, start, end, latitude):
    scale = max(0.2, math.cos(math.radians(latitude)))
    px, py = point["lon"] * scale, point["lat"]
    ax, ay = start["lon"] * scale, start["lat"]
    bx, by = end["lon"] * scale, end["lat"]
    dx, dy = bx - ax, by - ay
    length = dx * dx + dy * dy
    if length <= 1e-20:
        return xplane_distance_metres(point, start, latitude)
    fraction = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length))
    nearest = {"lon": (ax + fraction * dx) / scale, "lat": ay + fraction * dy}
    return xplane_distance_metres(point, nearest, latitude)


def xplane_terminal_distance(points, anchors):
    if not points or not anchors:
        return float("inf")
    latitude = sum(point["lat"] for point in points) / len(points)
    best = float("inf")
    for anchor in anchors:
        for index in range(1, len(points)):
            best = min(best, xplane_point_to_segment_metres(
                anchor, points[index - 1], points[index], latitude))
            if best <= 12:
                return best
    return best


def xplane_polygon_area_metres(points):
    if len(points) < 3:
        return 0
    latitude = sum(point["lat"] for point in points) / len(points)
    return (abs(xplane_polygon_area(points)) * 111320.0 * 111320.0
            * max(0.2, math.cos(math.radians(latitude))))


def parse_xplane_dsf_terminals(text, anchors=None):
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    definitions = [line.split(None, 1)[1] for line in lines
                   if line.startswith("POLYGON_DEF ") and len(line.split(None, 1)) == 2]
    elements, seen = [], set()
    active, rings, winding = False, [], None

    def finish_polygon():
        nonlocal rings, winding
        if winding and len(winding) >= 3:
            rings.append(winding)
        winding = None
        if not rings:
            return
        points = max(rings, key=lambda value: abs(xplane_polygon_area(value)))
        rings = []
        if len(points) < 3:
            return
        if points[0] != points[-1]:
            points = points + [dict(points[0])]
        signature = tuple((round(point["lat"], 6), round(point["lon"], 6)) for point in points)
        if signature in seen:
            return
        seen.add(signature)
        area = xplane_polygon_area_metres(points)
        if area < 60:
            return
        elements.append({
            "type": "way", "id": "xplane-terminal-%d" % (len(elements) + 1),
            "tags": {"building": "terminal", "operator": "X-Plane Scenery Gateway"},
            "geometry": points,
            "xplaneArea": area,
        })

    for line in lines:
        values = line.split()
        code = values[0]
        if code == "BEGIN_POLYGON" and len(values) >= 2:
            finish_polygon()
            try:
                definition = definitions[int(values[1])]
            except (IndexError, TypeError, ValueError):
                definition = ""
            active = xplane_terminal_definition(definition)
        elif code == "BEGIN_WINDING" and active:
            if winding and len(winding) >= 3:
                rings.append(winding)
            winding = []
        elif code == "POLYGON_POINT" and active and winding is not None and len(values) >= 3:
            try:
                winding.append({"lon": float(values[1]), "lat": float(values[2])})
            except ValueError:
                continue
        elif code == "END_WINDING" and active:
            if winding and len(winding) >= 3:
                rings.append(winding)
            winding = None
        elif code == "END_POLYGON":
            if active:
                finish_polygon()
            active, rings, winding = False, [], None
    if active:
        finish_polygon()
    anchors = list(anchors or [])
    if anchors:
        # Passenger terminals border gates and ramp starts.  A generous distance
        # retains long concourses while rejecting unrelated terminal-kit buildings.
        elements = [element for element in elements
                    if xplane_terminal_distance(element["geometry"], anchors) <= 140]
    elif len(elements) > 24:
        # Airports without named ramps cannot be proximity-filtered.  Keep a bounded
        # set of the most substantial footprints instead of shipping every facade.
        elements = sorted(elements, key=lambda value: value.get("xplaneArea", 0), reverse=True)[:24]
    for index, element in enumerate(elements, 1):
        element["id"] = "xplane-terminal-%d" % index
        element.pop("xplaneArea", None)
    return {"elements": elements}


def xplane_gateway_raw(ident, progress=None):
    apt_text, metadata = fetch_xplane_gateway_apt(ident, progress)
    raw = parse_xplane_apt(apt_text, ident)
    dsf_text = metadata.pop("dsfText", "")
    if dsf_text:
        anchors = [element for element in raw["elements"]
                   if feature_kind(element.get("tags") or {}) in ("gate", "parking_position")]
        terminals = parse_xplane_dsf_terminals(dsf_text, anchors=anchors)
        raw["elements"].extend(terminals["elements"])
        metadata["terminalCount"] = len(terminals["elements"])
    raw["gateway"] = metadata
    return raw


def point_pair(point):
    try:
        return [round(float(point["lon"]), 7), round(float(point["lat"]), 7)]
    except (KeyError, TypeError, ValueError):
        return None


def geometry_endpoint(point):
    pair = point_pair(point)
    return tuple(pair) if pair else None


def assemble_relation_rings(members):
    """Join split outer ways from an OSM multipolygon into closed rings."""
    segments = []
    for member in members or []:
        if member.get("type") != "way" or member.get("role") not in (None, "", "outer"):
            continue
        geometry = [point for point in (member.get("geometry") or []) if geometry_endpoint(point)]
        if len(geometry) >= 2:
            segments.append(geometry)
    rings = []
    while segments:
        chain = segments.pop(0)
        joined = True
        while joined and segments:
            joined = False
            first, last = geometry_endpoint(chain[0]), geometry_endpoint(chain[-1])
            for index, segment in enumerate(segments):
                segment_first = geometry_endpoint(segment[0])
                segment_last = geometry_endpoint(segment[-1])
                if last == segment_first:
                    chain.extend(segment[1:])
                elif last == segment_last:
                    chain.extend(reversed(segment[:-1]))
                elif first == segment_last:
                    chain = segment[:-1] + chain
                elif first == segment_first:
                    chain = list(reversed(segment[1:])) + chain
                else:
                    continue
                segments.pop(index)
                joined = True
                break
        if len(chain) >= 4 and geometry_endpoint(chain[0]) == geometry_endpoint(chain[-1]):
            rings.append(chain)
    return rings


def expanded_osm_elements(elements):
    """Yield normal elements and polygon rings represented by OSM relations."""
    for element in elements or []:
        if element.get("type") != "relation":
            yield element
            continue
        geometries = assemble_relation_rings(element.get("members"))
        if not geometries and element.get("geometry"):
            geometry = element.get("geometry")
            if (len(geometry) >= 4
                    and geometry_endpoint(geometry[0]) == geometry_endpoint(geometry[-1])):
                geometries = [geometry]
        for index, geometry in enumerate(geometries, 1):
            yield {
                "type": "way",
                "id": "relation-%s-outer-%d" % (element.get("id"), index),
                "tags": dict(element.get("tags") or {}),
                "geometry": geometry,
            }


def feature_kind(tags):
    taxi_now_kind = tags.get("taxinow:kind")
    if taxi_now_kind in MAP_KINDS or taxi_now_kind == "pavement":
        return taxi_now_kind
    kind = tags.get("aeroway")
    if kind in MAP_KINDS:
        return kind
    building = tags.get("building")
    if building in ("terminal", "hangar"):
        return building
    name = str(tags.get("name") or "")
    excluded_building = re.search(
        r"(?:parking|garage|hotel|station|rental|office)",
        name,
        re.IGNORECASE,
    )
    if (building and not excluded_building
            and re.search(
                r"(?:terminal|concourse|satellite)",
                name,
                re.IGNORECASE,
            )):
        return "terminal"
    return None


def feature_counts(features):
    counts, runway_references = {}, set()
    for feature in features:
        counts[feature["kind"]] = counts.get(feature["kind"], 0) + 1
        if feature["kind"] == "runway":
            runway_references.add(feature.get("ref") or "osm-runway-%d" % len(runway_references))
    if runway_references:
        counts["runway"] = len(runway_references)
    return counts


def discard_incomplete_polygon_features(features):
    """Drop clipped or degenerate area fragments before map publication.

    Regional extracts and fallback scenery can contain an open building or
    apron fragment when geometry crosses an extraction boundary. Rendering
    such a fragment as an area creates holes, spikes, or large closing edges.
    It is safer to omit only that fragment while retaining the rest of the
    airport than to reject the entire airport map.
    """
    return [
        feature
        for feature in features
        if not (
            feature.get("kind") in POLYGON_KINDS
            and len(feature.get("points") or []) > 1
            and (
                len(feature.get("points") or []) < 4
                or feature["points"][0] != feature["points"][-1]
            )
        )
    ]


def map_detail_score(result):
    counts = (result or {}).get("counts") or {}
    taxiways = counts.get("taxiway", 0) + counts.get("taxilane", 0)
    stands = counts.get("parking_position", 0) + counts.get("gate", 0)
    return (counts.get("runway", 0) * 2 + taxiways * 3 + stands * 2
            + counts.get("apron", 0) + counts.get("terminal", 0) * 4
            + counts.get("hangar", 0))


def airport_map_quality(result):
    """Return blocking errors and non-blocking warnings for normalized maps."""
    features = list((result or {}).get("features") or [])
    counts = (result or {}).get("counts") or {}
    errors = []
    warnings = []
    if counts.get("runway", 0) == 0:
        errors.append("no runway geometry")
    invalid_polygons = [
        feature for feature in features
        if feature.get("kind") in {"apron", "terminal", "hangar", "pavement"}
        and len(feature.get("points") or []) > 1
        and (
            len(feature.get("points") or []) < 4
            or feature["points"][0] != feature["points"][-1]
        )
    ]
    if invalid_polygons:
        errors.append(
            "%d invalid polygon%s"
            % (
                len(invalid_polygons),
                "" if len(invalid_polygons) == 1 else "s",
            )
        )
    terminals = [
        feature for feature in features
        if feature.get("kind") == "terminal"
        and len(feature.get("points") or []) >= 4
    ]
    unnamed_terminals = [
        feature for feature in terminals
        if not (
            feature.get("name")
            or feature.get("label")
            or feature.get("ref")
        )
    ]
    if len(unnamed_terminals) >= 8 and len(unnamed_terminals) > len(terminals) * 0.6:
        warnings.append(
            "terminal geometry is highly fragmented and mostly unnamed"
        )
    completeness = terminal_completeness_metrics(result)
    if completeness["namedLabels"] and completeness["coveredLabels"] < completeness["namedLabels"]:
        warnings.append(
            "%d of %d named terminal labels have no nearby footprint"
            % (
                completeness["namedLabels"] - completeness["coveredLabels"],
                completeness["namedLabels"],
            )
        )
    if (
        completeness["gateAnchors"] >= 8
        and completeness["gateCoverage"] < 0.72
    ):
        warnings.append(
            "terminal footprints cover only %.0f%% of gate anchors"
            % (completeness["gateCoverage"] * 100)
        )
    bounds = (result or {}).get("bounds") or {}
    try:
        center_latitude = float((result or {})["center"][1])
        width = (
            float(bounds["maxLon"]) - float(bounds["minLon"])
        ) * 111320.0 * math.cos(math.radians(center_latitude))
        height = (
            float(bounds["maxLat"]) - float(bounds["minLat"])
        ) * 111320.0
        if math.hypot(width, height) > 30000:
            errors.append("airport bounds exceed 30 km")
    except (KeyError, TypeError, ValueError):
        errors.append("invalid airport bounds")
    return errors, warnings


def terminal_label(tags):
    reference = str(tags.get("ref") or "").strip().upper()
    if reference:
        value = reference[1:] if reference.startswith("T") and len(reference) > 1 else reference
        return "Terminal " + value
    name = str(tags.get("name") or "").strip()
    match = re.search(r"(?:terminal|terminl)\s*[-#]?\s*(?:no\.?\s*)?([a-z]|[0-9]{1,3})\b|T\s*([0-9]{1,3}|[A-Z]\b)", name, re.IGNORECASE)
    if not match:
        return None
    value = (match.group(1) or match.group(2) or "").upper()
    value = value[1:] if value.startswith("T") and len(value) > 1 else value
    return "Terminal " + value


def is_passenger_terminal_label(feature):
    """Exclude FBO/company aeroway points from terminal completeness checks."""
    value = str(
        feature.get("label")
        or feature.get("name")
        or feature.get("ref")
        or ""
    ).strip()
    return bool(re.search(
        r"(?:terminal|concourse|satellite|航站楼|候机楼|航站)",
        value,
        re.IGNORECASE,
    ))


def local_xy(point, latitude):
    return (
        point[0] * 111320.0 * math.cos(math.radians(latitude)),
        point[1] * 111320.0,
    )


def point_segment_distance(point, start, end, latitude):
    point_x, point_y = local_xy(point, latitude)
    start_x, start_y = local_xy(start, latitude)
    end_x, end_y = local_xy(end, latitude)
    delta_x, delta_y = end_x - start_x, end_y - start_y
    length_squared = delta_x * delta_x + delta_y * delta_y
    if length_squared <= 0:
        return math.hypot(point_x - start_x, point_y - start_y)
    fraction = max(
        0.0,
        min(
            1.0,
            (
                (point_x - start_x) * delta_x
                + (point_y - start_y) * delta_y
            )
            / length_squared,
        ),
    )
    return math.hypot(
        point_x - (start_x + fraction * delta_x),
        point_y - (start_y + fraction * delta_y),
    )


def filter_isolated_airport_features(
    features,
    airport,
    maximum_distance=AIRPORT_FEATURE_DISTANCE_METRES,
    connection_distance=AIRPORT_FEATURE_CONNECTION_METRES,
):
    """Remove facilities belonging to nearby airports or heliports.

    Airport downloads are centered using a catalog point, so dense cities can
    contain unrelated aeroway features. Keep the runway cluster closest to the
    selected airport and any feature within the configured operational buffer.
    """
    latitude = airport["latitude"]
    center = [airport["longitude"], latitude]
    runways = [feature for feature in features if feature["kind"] == "runway"]
    if not runways:
        return features
    primary_runways = [
        feature
        for feature in runways
        if min(
            math.hypot(
                local_xy(point, latitude)[0] - local_xy(center, latitude)[0],
                local_xy(point, latitude)[1] - local_xy(center, latitude)[1],
            )
            for point in feature["points"]
        )
        <= 5000
    ] or runways
    runway_segments = [
        (start, end)
        for runway in primary_runways
        for start, end in zip(runway["points"], runway["points"][1:])
    ]
    if not runway_segments:
        return features

    selected = []
    primary_ids = {id(feature) for feature in primary_runways}
    for feature in features:
        if id(feature) in primary_ids:
            selected.append(feature)
            continue
        if not feature["points"]:
            continue
        distance = min(
            point_segment_distance(point, start, end, latitude)
            for point in feature["points"]
            for start, end in runway_segments
        )
        if distance <= maximum_distance:
            selected.append(feature)

    # A direct runway buffer is insufficient for large airports such as ZBAA:
    # terminal satellites, remote stands, and their taxiways can extend beyond
    # it while remaining connected to the airport network. Expand from the
    # runway-seeded cluster through nearby feature bounds, but do not admit a
    # detached cluster belonging to another airport or heliport.
    def feature_bounds(feature):
        points = [local_xy(point, latitude) for point in feature["points"]]
        if not points:
            return None
        return (
            min(point[0] for point in points),
            min(point[1] for point in points),
            max(point[0] for point in points),
            max(point[1] for point in points),
        )

    def bounds_distance(left, right):
        delta_x = max(left[0] - right[2], right[0] - left[2], 0)
        delta_y = max(left[1] - right[3], right[1] - left[3], 0)
        return math.hypot(delta_x, delta_y)

    selected_ids = {id(feature) for feature in selected}
    bounds_by_id = {
        id(feature): feature_bounds(feature)
        for feature in features
    }
    changed = True
    while changed:
        changed = False
        selected_bounds = [
            bounds_by_id[identity]
            for identity in selected_ids
            if bounds_by_id.get(identity) is not None
        ]
        for feature in features:
            identity = id(feature)
            bounds = bounds_by_id.get(identity)
            if identity in selected_ids or bounds is None:
                continue
            if any(
                bounds_distance(bounds, candidate) <= connection_distance
                for candidate in selected_bounds
            ):
                selected.append(feature)
                selected_ids.add(identity)
                selected_bounds.append(bounds)
                changed = True
    return [
        feature for feature in features
        if id(feature) in selected_ids
    ]


def point_inside_polygon(point, polygon):
    if len(polygon) < 3:
        return False
    longitude, latitude = point
    inside = False
    previous = polygon[-1]
    for current in polygon:
        current_lon, current_lat = current
        previous_lon, previous_lat = previous
        latitude_delta = previous_lat - current_lat
        crosses = (
            (current_lat > latitude) != (previous_lat > latitude)
            and abs(latitude_delta) > 1e-20
            and longitude
            < (
                (previous_lon - current_lon)
                * (latitude - current_lat)
                / latitude_delta
                + current_lon
            )
        )
        if crosses:
            inside = not inside
        previous = current
    return inside


def needs_terminal_supplement(result, maximum_gate_distance=180):
    """Detect gate clusters that are not represented by OSM terminals."""
    features = list((result or {}).get("features") or [])
    terminals = [
        feature for feature in features
        if feature.get("kind") == "terminal"
        and len(feature.get("points") or []) >= 3
    ]
    gates = [
        feature for feature in features
        if feature.get("kind") == "gate"
        and feature.get("points")
    ]
    anchors = gates
    if len(anchors) < 8:
        anchors = [
            feature for feature in features
            if feature.get("kind") == "parking_position"
            and feature.get("points")
        ]
    if len(anchors) < 8:
        return False
    if not terminals:
        return True

    latitude = float(result["center"][1])
    anchor_coverage = []
    for anchor in anchors:
        point = anchor["points"][0]
        anchor_coverage.append(any(
            point_inside_polygon(point, terminal["points"])
            or min(
                point_segment_distance(point, start, end, latitude)
                for start, end in zip(
                    terminal["points"],
                    terminal["points"][1:],
                )
            )
            <= maximum_gate_distance
            for terminal in terminals
        ))
    if sum(anchor_coverage) / len(anchors) < 0.72:
        return True

    # A large, well-covered terminal can otherwise hide a completely missing
    # smaller terminal. Detect local gate groups independently.
    unassigned = set(range(len(anchors)))
    while unassigned:
        cluster = {unassigned.pop()}
        pending = list(cluster)
        while pending:
            current = pending.pop()
            current_point = anchors[current]["points"][0]
            neighbours = {
                index for index in unassigned
                if math.hypot(
                    local_xy(anchors[index]["points"][0], latitude)[0]
                    - local_xy(current_point, latitude)[0],
                    local_xy(anchors[index]["points"][0], latitude)[1]
                    - local_xy(current_point, latitude)[1],
                )
                <= 300
            }
            unassigned.difference_update(neighbours)
            cluster.update(neighbours)
            pending.extend(neighbours)
        if (
            len(cluster) >= 4
            and sum(anchor_coverage[index] for index in cluster) / len(cluster)
            < 0.60
        ):
            return True
    return False


def uncovered_terminal_label_points(result, maximum_distance=180):
    """Return named terminal points that have no terminal footprint nearby."""
    features = list((result or {}).get("features") or [])
    polygons = [
        feature for feature in features
        if feature.get("kind") == "terminal"
        and len(feature.get("points") or []) >= 3
    ]
    labels = [
        feature for feature in features
        if feature.get("kind") == "terminal"
        and len(feature.get("points") or []) == 1
        and is_passenger_terminal_label(feature)
    ]
    latitude = float((result or {}).get("center", [0, 0])[1])
    uncovered = []
    for label in labels:
        point = label["points"][0]
        if not any(
            point_inside_polygon(point, polygon["points"])
            or min(
                point_segment_distance(point, start, end, latitude)
                for start, end in zip(
                    polygon["points"],
                    polygon["points"][1:],
                )
            )
            <= maximum_distance
            for polygon in polygons
        ):
            uncovered.append(label)
    return uncovered


def terminal_completeness_metrics(result):
    """Return auditable terminal label and gate-footprint coverage metrics."""
    features = list((result or {}).get("features") or [])
    polygons = [
        feature for feature in features
        if feature.get("kind") == "terminal"
        and len(feature.get("points") or []) >= 3
    ]
    labels = [
        feature for feature in features
        if feature.get("kind") == "terminal"
        and len(feature.get("points") or []) == 1
        and is_passenger_terminal_label(feature)
    ]
    gates = [
        feature for feature in features
        if feature.get("kind") == "gate"
        and feature.get("points")
    ]
    if len(gates) < 8:
        gates = [
            feature for feature in features
            if feature.get("kind") == "parking_position"
            and feature.get("points")
        ]
    latitude = float((result or {}).get("center", [0, 0])[1])

    def covered(point, maximum_distance):
        return any(
            point_inside_polygon(point, polygon["points"])
            or min(
                point_segment_distance(point, start, end, latitude)
                for start, end in zip(
                    polygon["points"],
                    polygon["points"][1:],
                )
            )
            <= maximum_distance
            for polygon in polygons
        )

    covered_labels = sum(
        covered(label["points"][0], 180)
        for label in labels
    )
    covered_gates = sum(
        covered(gate["points"][0], 180)
        for gate in gates
    )
    return {
        "terminalPolygons": len(polygons),
        "namedLabels": len(labels),
        "coveredLabels": covered_labels,
        "gateAnchors": len(gates),
        "coveredGateAnchors": covered_gates,
        "gateCoverage": (
            covered_gates / len(gates)
            if gates
            else 1.0
        ),
    }


def propagate_terminal_names(result, maximum_distance=260):
    """Copy reliable terminal/concourse point names onto nearby footprints."""
    features = list((result or {}).get("features") or [])
    labels = [
        feature for feature in features
        if feature.get("kind") == "terminal"
        and len(feature.get("points") or []) == 1
        and is_passenger_terminal_label(feature)
    ]
    polygons = [
        feature for feature in features
        if feature.get("kind") == "terminal"
        and len(feature.get("points") or []) >= 3
    ]
    latitude = float((result or {}).get("center", [0, 0])[1])
    for polygon in polygons:
        if polygon.get("label") or polygon.get("name") or polygon.get("ref"):
            continue
        matches = []
        for label in labels:
            point = label["points"][0]
            distance = point_polygon_distance(
                point,
                polygon["points"],
                latitude,
            )
            if distance <= maximum_distance:
                matches.append((distance, terminal_anchor_name(label)))
        if not matches:
            continue
        name = min(matches, key=lambda value: value[0])[1]
        polygon["name"] = name
        label = terminal_label({"name": name})
        if label:
            polygon["label"] = label
    return result


def merge_osm_elements(primary, supplements):
    merged = list(primary or [])
    seen = {
        (element.get("type"), str(element.get("id")))
        for element in merged
    }
    for element in supplements or []:
        identity = (element.get("type"), str(element.get("id")))
        if identity in seen:
            continue
        seen.add(identity)
        merged.append(element)
    return merged


def geometry_pairs(element):
    return [
        pair for pair in (
            point_pair(value) for value in element.get("geometry", [])
        )
        if pair
    ]


def point_polygon_distance(point, polygon, latitude):
    if point_inside_polygon(point, polygon):
        return 0.0
    return min(
        point_segment_distance(point, start, end, latitude)
        for start, end in zip(polygon, polygon[1:])
    )


def polygon_distance(left, right, latitude):
    return min(
        min(point_polygon_distance(point, right, latitude) for point in left),
        min(point_polygon_distance(point, left, latitude) for point in right),
    )


def polygons_overlap_or_contain(left, right):
    """Return true when either footprint contains a vertex of the other."""
    return any(point_inside_polygon(point, right) for point in left[:-1]) or any(
        point_inside_polygon(point, left) for point in right[:-1]
    )


def terminal_anchor_name(feature):
    value = str(
        feature.get("label")
        or feature.get("name")
        or feature.get("ref")
        or ""
    ).strip()
    return value or None


def promote_terminal_buildings(
    elements,
    result,
    *,
    source_name=None,
    label_distance=190,
    gate_distance=95,
    connection_distance=35,
):
    """Promote spatially supported open building footprints to terminals.

    Some airports model a terminal as one outer ``building=yes`` footprint
    plus named concourse/building parts. Overture and Microsoft ML Buildings
    also supply useful outer footprints without aviation semantics. A generic
    building is accepted only when supported by a terminal/concourse label,
    multiple gate anchors, or a short connection to an accepted terminal.
    """
    latitude = float(result["center"][1])
    features = list(result.get("features") or [])
    labels = [
        feature for feature in features
        if feature.get("kind") == "terminal"
        and len(feature.get("points") or []) == 1
        and is_passenger_terminal_label(feature)
    ]
    gates = [
        feature["points"][0]
        for feature in features
        if feature.get("kind") == "gate" and feature.get("points")
    ]
    accepted = [
        geometry_pairs(element)
        for element in expanded_osm_elements(elements)
        if feature_kind(element.get("tags") or {}) == "terminal"
        and len(geometry_pairs(element)) >= 3
    ]
    candidates = []
    for element in expanded_osm_elements(elements):
        tags = dict(element.get("tags") or {})
        element_source = str(tags.get("taxinow:source") or "")
        if source_name and element_source != source_name:
            continue
        building = str(tags.get("building") or "").lower()
        if not building or feature_kind(tags):
            continue
        name = str(tags.get("name") or "")
        if (
            building in {
                "hangar", "garage", "garages", "parking", "industrial",
                "warehouse", "office", "hotel", "train_station", "service",
                "transportation",
            }
            or re.search(
                r"(?:parking|garage|hotel|station|rental|office|hangar|cargo|freight)",
                name,
                re.IGNORECASE,
            )
        ):
            continue
        polygon = geometry_pairs(element)
        if len(polygon) < 4 or polygon[0] != polygon[-1]:
            continue
        is_building_part = (
            str(tags.get("taxinow:building_type") or "").lower()
            == "building_part"
            or str(tags.get("building:part") or "").lower()
            in {"yes", "1", "true"}
        )
        # A building part is useful only when no continuous parent footprint
        # was accepted. Rendering both recreates the fragmented terminal
        # appearance that the fusion pipeline is intended to remove.
        if is_building_part and any(
            polygons_overlap_or_contain(polygon, terminal)
            for terminal in accepted
        ):
            continue
        candidates.append((element, tags, polygon))

    supplements = []
    remaining = list(candidates)
    changed = True
    while changed:
        changed = False
        next_remaining = []
        for element, tags, polygon in remaining:
            is_building_part = (
                str(tags.get("taxinow:building_type") or "").lower()
                == "building_part"
                or str(tags.get("building:part") or "").lower()
                in {"yes", "1", "true"}
            )
            if is_building_part and any(
                polygons_overlap_or_contain(polygon, terminal)
                for terminal in accepted
            ):
                continue
            matching_label = next(
                (
                    label for label in labels
                    if point_polygon_distance(
                        label["points"][0],
                        polygon,
                        latitude,
                    )
                    <= label_distance
                ),
                None,
            )
            nearby_gates = sum(
                point_polygon_distance(gate, polygon, latitude)
                <= gate_distance
                for gate in gates
            )
            connected = any(
                polygon_distance(polygon, terminal, latitude)
                <= connection_distance
                for terminal in accepted
            )
            if matching_label or nearby_gates >= 2 or connected:
                promoted = dict(element)
                promoted_tags = dict(tags)
                promoted_tags["building"] = "terminal"
                promoted_tags["aeroway"] = "terminal"
                promoted_tags["taxinow:source"] = (
                    element_source or source_name or "OpenStreetMap"
                )
                promoted_tags["operator"] = promoted_tags["taxinow:source"]
                if matching_label:
                    promoted_tags["name"] = terminal_anchor_name(
                        matching_label
                    )
                promoted["tags"] = promoted_tags
                supplements.append(promoted)
                accepted.append(polygon)
                changed = True
            else:
                next_remaining.append((element, tags, polygon))
        remaining = next_remaining
    return supplements


def promote_osm_terminal_buildings(osm_elements, result):
    """Compatibility wrapper for the OSM-focused interactive pipeline."""
    return promote_terminal_buildings(
        osm_elements,
        result,
        source_name=None,
        label_distance=150,
        gate_distance=70,
        connection_distance=25,
    )


def faa_designator_name(designator):
    value = re.sub(r"\s+", " ", str(designator or "").strip())
    match = re.search(r"\bTERMINAL\s+([A-Z0-9]+)\b", value, re.IGNORECASE)
    if match:
        return "Terminal " + match.group(1).upper()
    if re.search(r"\bGENERAL AVIATION TERMINAL\b", value, re.IGNORECASE):
        return "General Aviation Terminal"
    return value.title() if value else None


def geojson_polygon_rings(geometry):
    geometry_type = str((geometry or {}).get("type") or "")
    coordinates = (geometry or {}).get("coordinates") or []
    if geometry_type == "Polygon":
        return coordinates[:1]
    if geometry_type == "MultiPolygon":
        return [
            polygon[0]
            for polygon in coordinates
            if polygon
        ]
    return []


def faa_airport_mapping_elements(ident, kinds=("building",), progress=None):
    elements = []
    for kind in kinds:
        service = FAA_AM_SERVICES[kind]
        where = urllib.parse.quote("ICAO_ID='%s'" % ident.upper())
        url = (
            "%s/%s/FeatureServer/0/query?"
            "where=%s&outFields=*&returnGeometry=true&outSR=4326&f=geojson"
            % (FAA_AM_SERVICE_ROOT, service, where)
        )
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/geo+json,application/json",
                "User-Agent": "TaxiNow/1.0 airport-map downloader",
            },
        )
        try:
            with urllib.request.urlopen(
                request,
                timeout=FAA_REQUEST_TIMEOUT,
            ) as response:
                payload = response.read()
            collection = json.loads(payload.decode("utf-8"))
        except (
            urllib.error.URLError,
            TimeoutError,
            OSError,
            UnicodeDecodeError,
            json.JSONDecodeError,
        ) as error:
            raise AirportMapError(
                "FAA Airport Mapping data is unavailable: %s"
                % short_network_error(error)
            ) from error
        for feature_index, feature in enumerate(
            collection.get("features") or []
        ):
            properties = feature.get("properties") or {}
            designator = str(properties.get("DESIGNATOR") or "").strip()
            if kind == "building":
                if not re.search(
                    r"\b(?:TERMINAL|CONCOURSE)\b",
                    designator,
                    re.IGNORECASE,
                ):
                    continue
                tags = {
                    "building": "terminal",
                    "aeroway": "terminal",
                    "name": faa_designator_name(designator),
                    "operator": "Federal Aviation Administration",
                    "taxinow:source": "FAA Airport Mapping",
                }
            elif kind == "taxiway":
                tags = {
                    "taxinow:kind": "pavement",
                    "ref": designator,
                    "surface": properties.get("SURFACE"),
                    "operator": "Federal Aviation Administration",
                    "taxinow:source": "FAA Airport Mapping",
                }
            else:
                tags = {
                    "aeroway": "apron",
                    "name": designator,
                    "surface": properties.get("SURFACE"),
                    "operator": "Federal Aviation Administration",
                    "taxinow:source": "FAA Airport Mapping",
                }
            for ring_index, ring in enumerate(
                geojson_polygon_rings(feature.get("geometry"))
            ):
                geometry = [
                    {"lon": float(point[0]), "lat": float(point[1])}
                    for point in ring
                    if isinstance(point, list) and len(point) >= 2
                ]
                if len(geometry) < 4:
                    continue
                elements.append({
                    "type": "way",
                    "id": "faa-%s-%s-%s" % (
                        kind,
                        properties.get("OBJECTID", feature_index),
                        ring_index,
                    ),
                    "tags": {
                        key: value for key, value in tags.items()
                        if value not in (None, "")
                    },
                    "geometry": geometry,
                })
    if elements:
        report_progress(
            progress,
            "downloading_fallback",
            84,
            "FAA Airport Mapping",
        )
    return elements


def raw_point_inside_polygon(point, geometry):
    pairs = [
        pair for pair in (point_pair(value) for value in geometry)
        if pair
    ]
    pair = point_pair(point)
    return bool(pair and point_inside_polygon(pair, pairs))


def gateway_terminal_supplements(
    osm_elements,
    gateway_elements,
    overlap_distance=40,
):
    """Return X-Plane terminal footprints not already covered by OSM."""
    osm_terminals = [
        element for element in expanded_osm_elements(osm_elements)
        if feature_kind(element.get("tags") or {}) == "terminal"
        and len(element.get("geometry") or []) >= 3
    ]
    supplements = []
    for element in gateway_elements:
        if feature_kind(element.get("tags") or {}) != "terminal":
            continue
        geometry = list(element.get("geometry") or [])
        points = [value for value in geometry if point_pair(value)]
        if len(points) < 3:
            continue
        centroid = {
            "lon": sum(float(value["lon"]) for value in points) / len(points),
            "lat": sum(float(value["lat"]) for value in points) / len(points),
        }
        covered = False
        for terminal in osm_terminals:
            terminal_geometry = list(terminal.get("geometry") or [])
            if raw_point_inside_polygon(centroid, terminal_geometry):
                covered = True
                break
            if len(terminal_geometry) < 2:
                continue
            latitude = float(centroid["lat"])
            distance = min(
                xplane_point_to_segment_metres(
                    centroid,
                    start,
                    end,
                    latitude,
                )
                for start, end in zip(
                    terminal_geometry,
                    terminal_geometry[1:],
                )
            )
            if distance <= overlap_distance:
                covered = True
                break
        if not covered:
            supplements.append(element)
    return supplements


def normalize(raw, airport, source="OpenStreetMap contributors", source_url="https://www.openstreetmap.org/copyright"):
    features = []
    all_points = []
    seen = set()
    for element in expanded_osm_elements(raw.get("elements", [])):
        tags = element.get("tags") or {}
        kind = feature_kind(tags)
        if not kind:
            continue
        identity = (element.get("type"), element.get("id"), kind)
        if identity in seen:
            continue
        seen.add(identity)
        geometry = [pair for pair in (point_pair(value) for value in element.get("geometry", [])) if pair]
        if not geometry and element.get("type") == "node":
            pair = point_pair(element)
            if pair:
                geometry = [pair]
        if not geometry:
            continue
        feature = {
            "kind": kind,
            "points": geometry,
        }
        for key in ("ref", "name", "surface", "width", "operator"):
            value = tags.get(key)
            if value:
                feature[key] = str(value)
        if kind == "terminal":
            label = terminal_label(tags)
            if label:
                feature["label"] = label
        if len(geometry) > 2 and geometry[0] == geometry[-1]:
            feature["closed"] = True
        features.append(feature)
    if not features:
        raise AirportMapError("No runway, taxiway, apron, or stand geometry was found for %s" % airport["ident"])
    features = discard_incomplete_polygon_features(features)
    features = filter_isolated_airport_features(features, airport)
    all_points = [
        point
        for feature in features
        for point in feature["points"]
    ]
    if not all_points:
        raise AirportMapError(
            "No airport geometry remained after filtering isolated features for %s"
            % airport["ident"]
        )
    minimum_lon = min(point[0] for point in all_points)
    maximum_lon = max(point[0] for point in all_points)
    minimum_lat = min(point[1] for point in all_points)
    maximum_lat = max(point[1] for point in all_points)
    latitude_padding = max((maximum_lat - minimum_lat) * 0.035, 0.0005)
    longitude_padding = max((maximum_lon - minimum_lon) * 0.035, 0.0005)
    bounds = {
        "minLon": minimum_lon - longitude_padding,
        "maxLon": maximum_lon + longitude_padding,
        "minLat": minimum_lat - latitude_padding,
        "maxLat": maximum_lat + latitude_padding,
    }
    normalized = {
        "schemaVersion": 1,
        "ident": airport["ident"],
        "name": airport["name"],
        "center": [airport["longitude"], airport["latitude"]],
        "bounds": bounds,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source": source,
        "sourceURL": source_url,
        "features": features,
    }
    propagate_terminal_names(normalized)
    counts = feature_counts(features)
    normalized["counts"] = counts
    return normalized


def cache_is_fresh(path, maximum_age_days):
    if not path.is_file():
        return False
    age = dt.datetime.now().timestamp() - path.stat().st_mtime
    return age < maximum_age_days * 86400


def cached_unavailable_reason(path):
    if not path.is_file():
        return None
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
        if int(record.get("cacheRevision") or 0) != UNAVAILABLE_CACHE_REVISION:
            return None
        if float(record.get("retryAfter") or 0) > time.time():
            return record.get("reason") or "airport-map sources are temporarily unavailable"
    except (OSError, TypeError, ValueError):
        return None
    return None


def write_unavailable_marker(path, reason, retry_seconds):
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=path.stem + "-", suffix=".json", dir=str(path.parent)
    )
    os.close(descriptor)
    temporary = pathlib.Path(temporary_name)
    try:
        temporary.write_text(json.dumps({
            "cacheRevision": UNAVAILABLE_CACHE_REVISION,
            "reason": reason,
            "checkedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "retryAfter": time.time() + retry_seconds,
        }, separators=(",", ":")), encoding="utf-8")
        temporary.replace(path)
    finally:
        if temporary.exists():
            temporary.unlink()


def build_airport_map(
    ident,
    cache_dir=None,
    refresh=False,
    radius=5500,
    maximum_age_days=30,
    progress=None,
):
    ident = ident.strip().upper()
    if len(ident) != 4 or not ident.isalnum():
        raise AirportMapError("Enter a four-character ICAO airport code")
    cache_dir = pathlib.Path(cache_dir or ROOT / "work" / "airport-map-cache")
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / (ident + ".json")
    unavailable_path = cache_dir / (ident + ".unavailable.json")
    if not refresh and cache_path.is_file():
        cached = json.loads(cache_path.read_text(encoding="utf-8"))
        source = str(cached.get("source") or "")
        cache_days = (
            maximum_age_days
            if "OpenStreetMap" in source
            else min(maximum_age_days, NON_OSM_CACHE_MAX_AGE_DAYS)
        )
        try:
            gateway_revision = int(cached.get("sourceRevision") or 0)
        except (TypeError, ValueError):
            gateway_revision = 0
        try:
            osm_revision = int(cached.get("osmRevision") or 0)
        except (TypeError, ValueError):
            osm_revision = 0
        gateway_outdated = ("X-Plane Scenery Gateway" in source
                            and gateway_revision < XPLANE_SOURCE_REVISION)
        osm_outdated = ("OpenStreetMap" in source and osm_revision < OSM_SOURCE_REVISION)
        if not gateway_outdated and not osm_outdated and cache_is_fresh(cache_path, cache_days):
            cached["counts"] = feature_counts(cached.get("features", []))
            report_progress(progress, "reading_cache", 88, source or "Map cache")
            return cached, True
    if not refresh:
        unavailable_reason = cached_unavailable_reason(unavailable_path)
        if unavailable_reason:
            raise AirportMapError(unavailable_reason + " (recent result reused)")
    report_progress(progress, "catalog", 1, "OurAirports")
    airport = airport_record(ident, progress=progress)
    raw, result, overpass_error, gateway_error, gateway_missing, gateway_raw = (
        None,
        None,
        None,
        None,
        None,
        None,
    )
    osm_elements = []
    try:
        runway_raw = ourairports_runway_raw(ident, airport)
    except Exception:
        runway_raw = {"elements": []}
    query_bounds = airport_query_bounds(
        airport,
        runway_raw,
        maximum_radius=radius,
    )
    try:
        raw = fetch_overpass(
            airport["latitude"],
            airport["longitude"],
            radius,
            progress=progress,
            bounds=query_bounds,
        )
    except OverpassUnavailableError as error:
        overpass_error = error
    if raw is not None:
        report_progress(progress, "normalizing_map", 80, "OpenStreetMap")
        osm_elements = list(raw.get("elements", []))
        if osm_elements:
            has_runway = any(feature_kind((element.get("tags") or {})) == "runway" for element in osm_elements)
            if not has_runway:
                if runway_raw.get("elements"):
                    osm_elements.extend(runway_raw["elements"])
            try:
                source = "OpenStreetMap contributors + OurAirports" if runway_raw and runway_raw.get("elements") else "OpenStreetMap contributors"
                result = normalize({"elements": osm_elements}, airport, source=source)
                result["osmRevision"] = OSM_SOURCE_REVISION
            except AirportMapError:
                result = None
    terminal_detail_needed = (
        result is not None
        and (
            uncovered_terminal_label_points(result)
            or needs_terminal_supplement(result)
        )
    )
    if terminal_detail_needed:
        # Broad airport queries can be expensive on a busy Overpass instance.
        # Retry terminal anchors plus all building footprints in the compact
        # runway-derived bounds, then promote only strictly spatially matched
        # buildings. This reconstructs terminals made from building parts
        # without importing unrelated urban buildings.
        try:
            report_progress(
                progress,
                "waiting_for_map_source",
                81,
                "OpenStreetMap terminal detail",
            )
            terminal_raw = fetch_overpass_terminals(
                query_bounds,
                progress=None,
            )
            terminal_elements = list(terminal_raw.get("elements", []))
            if terminal_elements:
                osm_elements = merge_osm_elements(
                    osm_elements,
                    terminal_elements,
                )
                preliminary = normalize(
                    {"elements": osm_elements},
                    airport,
                    source="OpenStreetMap contributors",
                )
                promoted = promote_osm_terminal_buildings(
                    osm_elements,
                    preliminary,
                )
                osm_elements = merge_osm_elements(osm_elements, promoted)
                source = (
                    "OpenStreetMap contributors + OurAirports"
                    if runway_raw.get("elements")
                    else "OpenStreetMap contributors"
                )
                result = normalize(
                    {"elements": osm_elements},
                    airport,
                    source=source,
                )
                result["osmRevision"] = OSM_SOURCE_REVISION
        except (OverpassUnavailableError, AirportMapError):
            # The original map is still usable; the Gateway supplement below
            # remains available if the focused OSM request also fails.
            pass

    faa_elements = []
    result_counts = (result or {}).get("counts") or {}
    faa_kinds = []
    if (
        result is not None
        and airport.get("country_code") == "US"
    ):
        if needs_terminal_supplement(result):
            faa_kinds.append("building")
        if (
            result_counts.get("taxiway", 0)
            + result_counts.get("taxilane", 0)
            == 0
        ):
            faa_kinds.append("taxiway")
        if result_counts.get("apron", 0) == 0:
            faa_kinds.append("apron")
    if faa_kinds:
        try:
            faa_raw_elements = faa_airport_mapping_elements(
                ident,
                tuple(faa_kinds),
                progress,
            )
            terminal_supplements = gateway_terminal_supplements(
                osm_elements,
                faa_raw_elements,
                overlap_distance=20,
            )
            non_terminal_faa = [
                element for element in faa_raw_elements
                if feature_kind(element.get("tags") or {}) != "terminal"
            ]
            faa_elements = terminal_supplements + non_terminal_faa
            if faa_elements:
                osm_elements = merge_osm_elements(
                    osm_elements,
                    faa_elements,
                )
                source_parts = ["OpenStreetMap contributors"]
                if runway_raw.get("elements"):
                    source_parts.append("OurAirports")
                source_parts.append("FAA Airport Mapping")
                result = normalize(
                    {"elements": osm_elements},
                    airport,
                    source=" + ".join(source_parts),
                    source_url=FAA_AM_SOURCE_URL,
                )
                result["osmRevision"] = OSM_SOURCE_REVISION
        except AirportMapError:
            pass

    authoritative_terminals = [
        feature for feature in (result or {}).get("features", [])
        if feature.get("kind") == "terminal"
        and len(feature.get("points") or []) >= 3
    ]
    if (
        result is not None
        and needs_terminal_supplement(result)
        and not authoritative_terminals
    ):
        try:
            report_progress(
                progress,
                "waiting_for_fallback_source",
                82,
                "X-Plane Scenery Gateway",
            )
            gateway_raw = xplane_gateway_raw(ident, progress)
            supplements = gateway_terminal_supplements(
                osm_elements,
                gateway_raw.get("elements", []),
            )
            if supplements:
                source_parts = ["OpenStreetMap contributors"]
                if runway_raw.get("elements"):
                    source_parts.append("OurAirports")
                source_parts.append("X-Plane Scenery Gateway")
                result = normalize(
                    {"elements": osm_elements + supplements},
                    airport,
                    source=" + ".join(source_parts),
                )
                result["osmRevision"] = OSM_SOURCE_REVISION
                result["sourceRevision"] = XPLANE_SOURCE_REVISION
        except XPlaneGatewayNoDataError as error:
            gateway_missing = error
        except XPlaneGatewayUnavailableError as error:
            gateway_error = error
        except AirportMapError as error:
            gateway_missing = error
    result_counts = (result or {}).get("counts") or {}
    needs_gateway_detail = (result is None
                            or result_counts.get("taxiway", 0) + result_counts.get("taxilane", 0) == 0
                            or result_counts.get("parking_position", 0) + result_counts.get("gate", 0) == 0)
    if needs_gateway_detail:
        try:
            gateway_raw = gateway_raw or xplane_gateway_raw(ident, progress)
            authoritative_terminals = [
                element for element in osm_elements
                if feature_kind(element.get("tags") or {}) == "terminal"
            ]
            gateway_elements = [
                element for element in gateway_raw.get("elements", [])
                if (
                    feature_kind(element.get("tags") or {}) not in {
                        "terminal", "hangar"
                    }
                    or not authoritative_terminals
                )
            ]
            gateway_augmented = False
            authoritative_features = [
                element for element in osm_elements
                if feature_kind(element.get("tags") or {}) in {
                    "terminal", "hangar", "apron", "pavement"
                }
            ]
            if authoritative_features:
                gateway_elements = merge_osm_elements(
                    gateway_elements,
                    authoritative_features,
                )
            if not any(feature_kind((element.get("tags") or {})) == "runway" for element in gateway_elements):
                if runway_raw.get("elements"):
                    gateway_elements.extend(runway_raw["elements"])
                    gateway_augmented = True
            sources = ["X-Plane Scenery Gateway"]
            if gateway_augmented:
                sources.append("OurAirports")
            if authoritative_features:
                sources.insert(0, "OpenStreetMap contributors")
            if faa_elements:
                sources.insert(1, "FAA Airport Mapping")
            source = " + ".join(sources)
            gateway_result = normalize({"elements": gateway_elements}, airport, source=source,
                                       source_url=XPLANE_GATEWAY_SOURCE_URL)
            gateway_result["sourceRevision"] = XPLANE_SOURCE_REVISION
            if authoritative_features:
                gateway_result["osmRevision"] = OSM_SOURCE_REVISION
            if result is None or map_detail_score(gateway_result) > map_detail_score(result):
                result = gateway_result
        except XPlaneGatewayNoDataError as error:
            gateway_missing = error
        except XPlaneGatewayUnavailableError as error:
            gateway_error = error
        except AirportMapError as error:
            gateway_missing = error
    if result is None:
        if runway_raw.get("elements"):
            result = normalize(runway_raw, airport, source="OurAirports", source_url="https://ourairports.com/data/")
    if result is None:
        if overpass_error is not None or gateway_error is not None:
            unavailable = []
            if overpass_error is not None:
                unavailable.append("OpenStreetMap: %s" % overpass_error)
            if gateway_error is not None:
                unavailable.append("X-Plane Gateway: %s" % gateway_error)
            reason = "airport-map services are temporarily unavailable for %s (%s)" % (ident, "; ".join(unavailable))
            retry_seconds = TRANSIENT_UNAVAILABLE_SECONDS
        else:
            detail = ": %s" % gateway_missing if gateway_missing else ""
            reason = "no airport-map geometry was found in OpenStreetMap, X-Plane Gateway, or OurAirports for %s%s" % (ident, detail)
            retry_seconds = MISSING_DATA_SECONDS
        write_unavailable_marker(unavailable_path, reason, retry_seconds)
        raise AirportMapError(reason)
    quality_errors, quality_warnings = airport_map_quality(result)
    if quality_errors:
        raise AirportMapError(
            "Airport map failed geometry quality checks for %s: %s"
            % (ident, "; ".join(quality_errors))
        )
    if quality_warnings:
        result["qualityWarnings"] = quality_warnings
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=ident + "-", suffix=".json", dir=str(cache_dir)
    )
    os.close(descriptor)
    temporary = pathlib.Path(temporary_name)
    try:
        temporary.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
        temporary.replace(cache_path)
    finally:
        if temporary.exists():
            temporary.unlink()
    if unavailable_path.exists():
        unavailable_path.unlink()
    report_progress(progress, "finalizing_map", 96, result.get("source") or "Map source")
    return result, False


def main():
    parser = argparse.ArgumentParser(description="Download an offline SkyCharts airport vector map")
    parser.add_argument("ident", help="four-character ICAO code")
    parser.add_argument("--output", type=pathlib.Path)
    parser.add_argument("--cache-dir", type=pathlib.Path, default=ROOT / "work" / "airport-map-cache")
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--radius", type=int, default=5500, help="OSM search radius in metres")
    args = parser.parse_args()
    result, cached = build_airport_map(args.ident, args.cache_dir, args.refresh, args.radius)
    output = args.output or ROOT / "outputs" / (args.ident.upper() + "-airport-map.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    counts = result.get("counts", {})
    print("%s %s airport map: %d runways, %d taxiways, %d parking positions" % (
        "Reused" if cached else "Downloaded",
        result["ident"],
        counts.get("runway", 0),
        counts.get("taxiway", 0) + counts.get("taxilane", 0),
        counts.get("parking_position", 0),
    ))
    print("Saved %s" % output)


if __name__ == "__main__":
    main()
