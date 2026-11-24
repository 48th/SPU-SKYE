"""Air4Thai Bangkok station observations; Open-Meteo weather on demand.
No invented station PM values or model-grid PM history.
main.py must consume station IDs and handle missing values explicitly.
"""
from datetime import datetime, timedelta, timezone
import json
import logging
import math
import os
import re
import ssl
import threading
import time
import urllib.parse
import urllib.request

logger = logging.getLogger("pm25_api.live_data")
BKK_TZ = timezone(timedelta(hours=7))
CACHE_TTL_SECONDS = 900
AIR4THAI_URL = "https://air4thai.pcd.go.th/services/getNewAQI_JSON.php"
OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

# Mutated in place so existing imports retain references.
# These are populated only after a successful station fetch.
STATION_METADATA = []
STATION_META_BY_ID = {}
_cache_lock = threading.Lock()
_refresh_lock = threading.Lock()
_live_cache = {"expires_at": 0.0, "snapshot": None}


def _safe_float(value, default=None):
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except (TypeError, ValueError):
        return default


def _nonnegative(value):
    number = _safe_float(value)
    return number if number is not None and number >= 0 else None


def _compute_wind_components(speed_kmh, direction_deg):
    radians = math.radians(direction_deg)
    speed_ms = speed_kmh / 3.6
    return (
        round(-speed_ms * math.sin(radians), 4),
        round(-speed_ms * math.cos(radians), 4),
    )


def _fetch_json(base_url, params=None, timeout=30):
    url = base_url
    if params:
        url += "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(
        url, headers={"User-Agent": "BangkokPM25/1.0"}
    )
    # Verification is enabled by default. Supply a trusted CA file if needed.
    context = ssl.create_default_context(
        cafile=os.environ.get("AIR4THAI_CA_BUNDLE") or None
    )
    # Temporary public-data troubleshooting only, restricted to Air4Thai.
    if base_url == AIR4THAI_URL and os.environ.get(
        "AIR4THAI_ALLOW_INSECURE", "0"
    ) == "1":
        logger.warning("Air4Thai TLS verification disabled explicitly")
        context = ssl._create_unverified_context()
    with urllib.request.urlopen(
        request, timeout=timeout, context=context
    ) as response:
        return json.loads(response.read().decode("utf-8-sig"))


def _district_from_area(area):
    match = re.search(r"เขต\s*([^,\s]+)", area)
    return match.group(1) if match else None


def _timestamp(date_value, time_value):
    if not date_value or not time_value:
        return None
    try:
        return datetime.fromisoformat(
            str(date_value) + "T" + str(time_value)
        ).replace(tzinfo=BKK_TZ)
    except ValueError:
        return None


def _pollutant(latest, key):
    block = latest.get(key)
    return _nonnegative(block.get("value")) if isinstance(block, dict) else None


def _fetch_live_snapshot():
    payload = _fetch_json(AIR4THAI_URL)
    raw_stations = payload.get("stations")
    if not isinstance(raw_stations, list):
        raise ValueError("Air4Thai response has no stations list")

    now = datetime.now(BKK_TZ)
    stations = {}
    metadata = []

    for raw in raw_stations:
        area = str(raw.get("areaTH") or "")
        station_id = str(raw.get("stationID") or "").strip().lower()
        district = _district_from_area(area)
        # Some Bangkok-operated stations report only a subdistrict and district.
        is_bangkok_station = re.fullmatch(r"bkp\d+t", station_id) and district is not None
        if not is_bangkok_station and not any(word in area for word in ("กรุงเทพ", "กทม.")):
            continue

        lat = _safe_float(raw.get("lat"))
        lon = _safe_float(raw.get("long"))
        if not station_id or lat is None or lon is None:
            logger.warning("Skipping station without ID/coordinates")
            continue
        if station_id in stations:
            raise ValueError("Duplicate station ID: " + station_id)

        latest = raw.get("AQILast") or raw.get("LastUpdate") or {}
        if not isinstance(latest, dict):
            latest = {}

        measured = _timestamp(latest.get("date"), latest.get("time"))
        age_minutes = (
            (now - measured).total_seconds() / 60
            if measured is not None else None
        )

        meta = {
            "id": station_id,
            "station_id": station_id,
            "name": str(raw.get("nameTH") or station_id).strip(),
            "name_en": str(raw.get("nameEN") or "").strip(),
            "district": district,
            "area": area,
            "lat": lat,
            "lon": lon,
            "is_roadside": 1.0 if "ริมถนน" in area else 0.0,
        }
        pm25 = _pollutant(latest, "PM25")
        pm10 = _pollutant(latest, "PM10")
        aqi = latest.get("AQI") or {}
        thai_aqi = _nonnegative(aqi.get("aqi")) if isinstance(aqi, dict) else None

        metadata.append(meta)
        stations[station_id] = {
            "meta": meta,
            "station_id": station_id,
            "name": meta["name"],
            "district": meta["district"],
            "area": area,
            "current_pm25": pm25,
            "current_pm10": pm10,
            "current_thai_aqi": thai_aqi,
            # Thai AQI is not US AQI; do not relabel it.
            "current_us_aqi": None,
            "observed_at": measured.isoformat() if measured else None,
            "reported_date": latest.get("date"),
            "reported_time": latest.get("time"),
            "age_minutes": round(age_minutes, 1) if age_minutes is not None else None,
            "is_stale": (
                age_minutes is None or age_minutes > 120 or age_minutes < -5
            ),
            "source": "air4thai",
            "averaging_period": "not_verified",
            "current_temp_c": None,
            "current_wind_ms": None,
            "current_wind_deg": None,
            # Latest observations do not establish a daily historical series.
            "aq_daily": {},
            "aq_hourly": {},
            "wx_daily": {},
            "wx_hourly": {},
            "prediction_ready": False,
            "prediction_unavailable_reason": (
                "Verified station daily history and matching weather required"
            ),
        }

    if not stations:
        raise ValueError("No Bangkok stations returned; keep prior cache")

    STATION_METADATA[:] = metadata
    STATION_META_BY_ID.clear()
    STATION_META_BY_ID.update({m["id"]: m for m in metadata})
    return {
        "fetched_at": now.isoformat(),
        "source": "air4thai",
        "station_count": len(stations),
        "district_count": len({m["district"] for m in metadata if m["district"]}),
        "cache_stale": False,
        "stations": stations,
    }


def get_live_snapshot(force_refresh=False):
    with _refresh_lock:
        with _cache_lock:
            cached = _live_cache["snapshot"]
            if (
                not force_refresh and cached is not None
                and time.time() < _live_cache["expires_at"]
            ):
                return cached
        try:
            fresh = _fetch_live_snapshot()
            with _cache_lock:
                _live_cache["snapshot"] = fresh
                _live_cache["expires_at"] = time.time() + CACHE_TTL_SECONDS
            return fresh
        except Exception:
            logger.exception("Air4Thai unavailable")
            with _cache_lock:
                cached = _live_cache["snapshot"]
            if cached is None:
                return None
            # Explicitly label cached readings; never replace them with defaults.
            fallback = dict(cached)
            fallback["cache_stale"] = True
            fallback["stations"] = {
                key: dict(value, is_stale=True)
                for key, value in cached["stations"].items()
            }
            return fallback


def list_stations(district=None):
    snapshot = get_live_snapshot()
    if snapshot is None:
        return []
    result = []
    for station in snapshot["stations"].values():
        if district and station["district"] != district:
            continue
        result.append({
            **station["meta"],
            "pm25": station["current_pm25"],
            "observed_at": station["observed_at"],
            "is_stale": station["is_stale"] or snapshot["cache_stale"],
        })
    return sorted(result, key=lambda s: (s["district"] or "", s["name"]))


def get_station_weather(station_id):
    """Fetch model weather separately. This does not provide station PM history."""
    snapshot = get_live_snapshot()
    if snapshot is None or station_id not in snapshot["stations"]:
        raise KeyError("Station unavailable: " + station_id)
    meta = snapshot["stations"][station_id]["meta"]
    return _fetch_json(OPEN_METEO_FORECAST_URL, {
        "latitude": meta["lat"],
        "longitude": meta["lon"],
        "timezone": "Asia/Bangkok",
        "current": "temperature_2m,wind_speed_10m,wind_direction_10m",
        "hourly": (
            "temperature_2m,relative_humidity_2m,rain,wind_speed_10m,"
            "wind_direction_10m,cloud_cover,surface_pressure,pressure_msl,weather_code"
        ),
        "past_days": 15,
        "forecast_days": 7,
    })


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    snapshot = get_live_snapshot(force_refresh=True)
    if snapshot is None:
        raise SystemExit("Unable to fetch station observations")
    print(json.dumps({
        "source": snapshot["source"],
        "station_count": snapshot["station_count"],
        "district_count": snapshot["district_count"],
        "stations": list_stations(),
    }, ensure_ascii=False, indent=2))
