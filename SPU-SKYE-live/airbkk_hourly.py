"""Collect AirBKK hourly PM2.5 and predict the next six hours."""
import json
import logging
import math
from datetime import datetime, timedelta
from functools import lru_cache
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from live_data import BKK_TZ
from station_forecast import ROOT, database

TRAINING_STATION = "BKP102T"
STATIONS = json.loads((ROOT / "airbkk_hourly_stations.json").read_text(encoding="utf-8"))
URL = "https://official.airbkk.com/airbkk/Report/getData"
AQM_URL = "https://aqmthai.pcd.go.th/pcd/Ajaxs/getStationHistory"
AQM_STATIONS = {
    "02T": (67, "1BKK1002"), "03T": (114, "1BKK1003"), "05T": (122, "1BKK1004"),
    "12T": (68, "1BKK1008"), "50T": (88, "1BKK1009"), "52T": (126, "1BKK1010"),
    "53T": (110, "1BKK1011"), "54T": (161, "1BKK1012"), "59T": (116, "1BKK1001"),
    "61T": (104, "1BKK1005"), "O10": (54, "1BKK1006"),
}
HOUR = timedelta(hours=1)
logger = logging.getLogger(__name__)


def sync_batch(now, station_by_index, targets=None):
    start = min(min(stamps) for stamps in targets.values()) if targets else now - timedelta(days=2)
    end = max(max(stamps) for stamps in targets.values()) if targets else now
    fields = [
        ("groupid", "all"), ("parameterTags[]", "PM2.5"), ("data_type", "hourly"),
        ("date_s", start.strftime("%d/%m/%Y")),
        ("date_e", (end + timedelta(days=1)).strftime("%d/%m/%Y")),
        ("display_type", "table"),
        *[("MeasIndex[]", index) for index in station_by_index],
    ]
    request = Request(URL, data=urlencode(fields).encode("ascii"), headers={
        "Cookie": "seen_welcome=yes", "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "SPU-SKYE data report",
    })
    with urlopen(request, timeout=25) as response:
        report = json.load(response)
    if report.get("status") != "success":
        raise RuntimeError("AirBKK hourly report unavailable")
    columns = {
        item["Alias"]: station_by_index[str(item["MeasIndex"])]
        for item in report["arrParameter"]
        if str(item["MeasIndex"]) in station_by_index and item["ShortName"] == "PM2.5"
    }
    rows = {}
    for entry in report["arrData"]:
        try:
            day, clock = entry["Date_Time"].split()
            d, m, y = map(int, day.split("/"))
            h, minute = map(int, clock.split(":"))
            stamp = datetime(y - 543 if y >= 2400 else y, m, d, h, minute, tzinfo=BKK_TZ)

        except (KeyError, TypeError, ValueError):
            continue
        if stamp > now or minute:
            continue
        for alias, station in columns.items():
            if targets is not None and stamp not in targets.get(station, ()):
                continue
            try:
                value = float(entry.get(alias))
            except (TypeError, ValueError):
                continue
            if math.isfinite(value) and value >= 0:
                rows[station, stamp.isoformat()] = (value, now.isoformat())
    return store_rows(rows)


def store_rows(rows):
    with database() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS airbkk_hourly (
            station_id TEXT NOT NULL, observed_at TEXT NOT NULL, pm25 REAL NOT NULL,
            fetched_at TEXT NOT NULL, PRIMARY KEY (station_id, observed_at))""")
        conn.executemany("""INSERT INTO airbkk_hourly VALUES (?, ?, ?, ?)
            ON CONFLICT(station_id, observed_at) DO UPDATE SET
            pm25=excluded.pm25, fetched_at=excluded.fetched_at
            WHERE excluded.fetched_at >= airbkk_hourly.fetched_at""",
            [(*key, *row) for key, row in rows.items()])
    return len(rows)


def sync_aqm(now, station, serial, code, targets=None):
    start = min(targets[station]) if targets else now - timedelta(days=2)
    end = max(targets[station]) if targets else now
    query = urlencode({
        "serial": serial, "timeframe": "hourly",
        "sdate": start.date(), "edate": end.date(),
        "stime": 0, "etime": 23,
    })
    with urlopen(AQM_URL + "?" + query, timeout=15) as response:
        report = json.load(response)
    if report.get("timeframe") != "hourly" or report.get("station", {}).get("name_en") != code:
        raise ValueError("Unexpected AQMThai station or reporting period")
    rows = {}
    for entry in report["rows"]:
        try:
            stamp = datetime.fromisoformat(entry["t"])
            stamp = stamp.replace(tzinfo=BKK_TZ) if stamp.tzinfo is None else stamp.astimezone(BKK_TZ)
            value = float(entry["pm25"])
        except (KeyError, TypeError, ValueError):
            continue
        if targets is not None and stamp not in targets[station]:
            continue
        if stamp <= now and stamp == stamp.replace(minute=0, second=0, microsecond=0):
            if math.isfinite(value) and value >= 0:
                rows[station, stamp.isoformat()] = (value, now.isoformat())
    return store_rows(rows)


def sync_hourly(now, stop=None):
    stations = list(STATIONS.items())
    total = 0
    for offset in range(0, len(stations), 8):
        if stop is not None and stop.is_set():
            break
        batch = {index: station for station, index in stations[offset:offset + 8]}
        try:
            total += sync_batch(now, batch)
        except Exception:
            logger.exception("AirBKK hourly batch unsuccessful for %s", list(batch.values()))
    for station, (serial, code) in AQM_STATIONS.items():
        if stop is not None and stop.is_set():
            break
        try:
            total += sync_aqm(now, station, serial, code)
        except Exception:
            logger.exception("AQMThai hourly sync unsuccessful for %s", station)
    return total


def missing_hours(now, lags):
    cutoff = now.replace(minute=0, second=0, microsecond=0) - max(lags) * HOUR - 2 * HOUR
    with database() as conn:
        table = conn.execute("SELECT 1 FROM sqlite_master WHERE name='airbkk_hourly'").fetchone()
        if not table:
            return {}
        rows = conn.execute("""SELECT station_id, observed_at FROM airbkk_hourly
            WHERE observed_at BETWEEN ? AND ?""", (cutoff.isoformat(), now.isoformat())).fetchall()
    history = {}
    for station, stamp in rows:
        history.setdefault(station, set()).add(datetime.fromisoformat(stamp))
    gaps = {}
    for station in (*STATIONS, *AQM_STATIONS):
        stamps = history.get(station)
        if not stamps:
            continue
        base = max(stamps)
        if now - base >= 2 * HOUR:
            continue
        missing = {base - lag * HOUR for lag in lags} - stamps
        if missing:
            gaps[station] = missing
    return gaps


def backfill_missing_hours(now, stop):
    gaps = missing_hours(now, load_model()["lags"])
    airbkk = [(STATIONS[station], station) for station in gaps if station in STATIONS]
    total = 0
    for offset in range(0, len(airbkk), 8):
        if stop.is_set():
            return total
        batch = dict(airbkk[offset:offset + 8])
        targets = {station: gaps[station] for station in batch.values()}
        try:
            total += sync_batch(now, batch, targets)
        except Exception:
            logger.exception("AirBKK hourly backfill unsuccessful for %s", list(batch.values()))
    for station, stamps in gaps.items():
        if stop.is_set():
            break
        if station in AQM_STATIONS and station not in STATIONS:
            try:
                total += sync_aqm(now, station, *AQM_STATIONS[station], targets={station: stamps})
            except Exception:
                logger.exception("AQMThai hourly backfill unsuccessful for %s", station)
    return total


def run_hourly(stop):
    while not stop.is_set():
        try:
            now = datetime.now(BKK_TZ)
            logger.info("Hourly collection: %s valid rows", sync_hourly(now, stop))
            if not stop.is_set():
                logger.info("Hourly backfill: %s valid rows", backfill_missing_hours(datetime.now(BKK_TZ), stop))
        except Exception:
            logger.exception("AirBKK hourly sync unsuccessful")
        stop.wait(15 * 60)


@lru_cache(maxsize=1)
def load_model():
    import joblib
    import sklearn

    bundle = joblib.load(ROOT / "models/BKP102T-hourly-extra-trees.joblib")
    if (bundle["station_id"] != TRAINING_STATION or set(bundle["models"]) != set(range(1, 7))
            or bundle["sklearn_version"] != sklearn.__version__):
        raise ValueError("Incompatible AirBKK hourly model")
    return bundle


def hourly_forecast(station_id, now):
    station_id = station_id.upper()
    if station_id not in STATIONS and station_id not in AQM_STATIONS:
        return {"reason": "station_not_supported", "points": []}
    import pandas as pd

    with database() as conn:
        table = conn.execute("SELECT 1 FROM sqlite_master WHERE name='airbkk_hourly'").fetchone()
        rows = conn.execute("""SELECT observed_at, pm25 FROM airbkk_hourly
            WHERE station_id=? AND observed_at<=? ORDER BY observed_at DESC LIMIT 25""",
            (station_id, now.isoformat())).fetchall() if table else []
    history = {datetime.fromisoformat(stamp): value for stamp, value in rows}
    if not history:
        return {"reason": "no_observations", "points": []}
    base = max(history)
    result = {"observedAt": base.isoformat(), "source": "AirBKK" if station_id in STATIONS else "AQMThai", "points": [],
              "experimental": station_id != TRAINING_STATION,
              "latestObservation": {"observedAt": base.isoformat(), "pm25": history[base]}}
    if now - base >= 2 * HOUR:
        return {**result, "reason": "stale_observations"}
    bundle = load_model()
    needed = {lag: base - lag * HOUR for lag in bundle["lags"]}
    missing = sorted(stamp.isoformat() for stamp in needed.values() if stamp not in history)
    if missing:
        return {**result, "reason": "missing_hourly_observations", "missingHours": missing}
    features = {f"lag{lag}": history[stamp] for lag, stamp in needed.items()}
    angle = base.hour * math.pi / 12
    features.update(sin=math.sin(angle), cos=math.cos(angle))
    frame = pd.DataFrame([features], columns=bundle["features"])
    return {**result, "points": [
        {"hoursAhead": h, "targetAt": (base + h * HOUR).isoformat(),
         "predictedPM25": round(float(bundle["models"][h].predict(frame)[0]), 2)}
        for h in range(1, 7)
    ]}
