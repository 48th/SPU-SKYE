"""Collect AirBKK hourly PM2.5 and predict the next six hours."""
import json
import logging
import math
import os
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


def fetch_report(period, start, end, station_by_index):
    fields = [
        ("groupid", "all"), ("parameterTags[]", "PM2.5"), ("data_type", period),
        ("date_s", start.strftime("%d/%m/%Y")),
        ("date_e", end.strftime("%d/%m/%Y")),
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
        raise RuntimeError(f"AirBKK {period} report unavailable")
    return report


def report_columns(report, station_by_index):
    return {
        item["Alias"]: station_by_index[str(item["MeasIndex"])]
        for item in report["arrParameter"]
        if str(item["MeasIndex"]) in station_by_index and item["ShortName"] == "PM2.5"
    }


def sync_daily_batch(now, station_by_index):
    end = now.date() - timedelta(days=1)
    start = now.date() - timedelta(days=14)
    report = fetch_report("daily", start, end, station_by_index)
    columns = report_columns(report, station_by_index)
    rows = {}
    for entry in report["arrData"]:
        try:
            d, m, y = map(int, entry["Date_Time"].strip().split("/"))
            day = datetime(y - 543 if y >= 2400 else y, m, d).date()
        except (AttributeError, KeyError, TypeError, ValueError):
            continue
        if not start <= day <= end:
            continue
        for alias, station in columns.items():
            try:
                value = float(entry.get(alias))
            except (TypeError, ValueError):
                continue
            if math.isfinite(value) and value >= 0:
                rows[station, day.isoformat()] = (value, now.isoformat(), "AirBKK official daily report")
    with database() as conn:
        result = conn.executemany(
            "INSERT OR IGNORE INTO station_daily VALUES (?, ?, ?, ?, ?)",
            [(*key, *row) for key, row in rows.items()],
        )
        return result.rowcount


def run_airbkk_daily(stop):
    mapping = list(STATIONS.items())
    while not stop.is_set():
        inserted = 0
        for offset in range(0, len(mapping), 8):
            if stop.is_set():
                return
            batch = {index: station for station, index in mapping[offset:offset + 8]}
            try:
                inserted += sync_daily_batch(datetime.now(BKK_TZ), batch)
            except Exception:
                logger.exception("AirBKK daily report unavailable for %s", list(batch.values()))
        logger.info("AirBKK daily report: %s new station-days", inserted)
        stop.wait(6 * 3600)


def sync_batch(now, station_by_index, targets=None):
    start = min(min(stamps) for stamps in targets.values()) if targets else now - timedelta(days=2)
    end = max(max(stamps) for stamps in targets.values()) if targets else now
    report = fetch_report("hourly", start, end + timedelta(days=1), station_by_index)
    columns = report_columns(report, station_by_index)
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
            if not stop.is_set():
                logger.info("Hourly forecasts issued: %s new station-hours", record_hourly_issuance(stop))
        except Exception:
            logger.exception("AirBKK hourly sync unsuccessful")
        stop.wait(15 * 60)


def hourly_model_path():
    return os.environ.get("PM25_HOURLY_MODEL_PATH") or str(ROOT / "models/hourly_hgb_9.joblib")


@lru_cache(maxsize=1)
def load_model():
    import joblib
    import sklearn

    bundle = joblib.load(hourly_model_path())
    if (bundle["station_id"] != TRAINING_STATION or set(bundle["models"]) != set(range(1, 7))
            or bundle["sklearn_version"] != sklearn.__version__):
        raise ValueError("Incompatible AirBKK hourly model")
    return bundle


def hourly_features(history, base, lags):
    row = {f"lag{lag}": history.get(base - lag * HOUR) for lag in lags}
    if any(value is None for value in row.values()):
        return None
    angle = base.hour * math.pi / 12
    return {**row, "sin": math.sin(angle), "cos": math.cos(angle)}


def compare_hourly_forecast(station_id, horizon, now, *, show_history=False):
    station_id = station_id.strip().upper()
    source = "AirBKK" if station_id in STATIONS else "AQMThai"
    result = {"stationId": station_id, "horizon": horizon, "source": source,
              "points": [], "sampleCount": 0, "mae": None,
              "holdoutCount": 0, "holdoutMae": None, "contextCount": 0}
    if station_id not in STATIONS and station_id not in AQM_STATIONS:
        return {**result, "reason": "station_not_supported"}

    import pandas as pd

    bundle = load_model()
    result["modelName"] = bundle.get("model_name", type(bundle["models"][1]).__name__)
    cutoff = datetime.fromisoformat(bundle["training_end"])
    if cutoff.tzinfo is None:
        cutoff = cutoff.replace(tzinfo=BKK_TZ)
    start = now.replace(minute=0, second=0, microsecond=0) - timedelta(days=7)
    earliest = max(start, cutoff.replace(minute=0, second=0, microsecond=0) + (horizon + 1) * HOUR)
    chart_start = start if show_history else earliest
    lookback = chart_start - (max(bundle["lags"]) + horizon) * HOUR
    with database() as conn:
        exists = conn.execute("SELECT 1 FROM sqlite_master WHERE name='airbkk_hourly'").fetchone()
        rows = conn.execute(
            """SELECT observed_at, pm25 FROM airbkk_hourly
               WHERE station_id=? AND observed_at BETWEEN ? AND ? ORDER BY observed_at""",
            (station_id, lookback.isoformat(), now.isoformat()),
        ).fetchall() if exists else []
    history = {datetime.fromisoformat(stamp): value for stamp, value in rows}
    targets = [stamp for stamp in history if stamp >= chart_start]
    if not targets:
        return {**result, "reason": "no_observations"}

    points = []
    pairs = []
    target = min(targets)
    end = max(targets)
    while target <= end:
        issue = target - horizon * HOUR
        actual = history.get(target)
        point = {"targetAt": target.isoformat(), "actual": actual, "predicted": None,
                 "holdout": target >= earliest and issue > cutoff}
        points.append(point)
        features = hourly_features(history, issue, bundle["lags"]) if actual is not None and (show_history or point["holdout"]) else None
        if features is not None:
            pairs.append((point, features))
        target += HOUR
    if not pairs:
        return {**result, "points": points, "reason": "no_matched_predictions"}

    frame = pd.DataFrame([features for _, features in pairs], columns=bundle["features"])
    predicted = bundle["models"][horizon].predict(frame)
    errors, holdout_errors = [], []
    for (point, _), value in zip(pairs, predicted):
        point["predicted"] = round(float(value), 2)
        error = abs(point["predicted"] - point["actual"])
        errors.append(error)
        if point["holdout"]:
            holdout_errors.append(error)
    return {**result, "points": points, "sampleCount": len(errors),
            "mae": round(sum(errors) / len(errors), 2),
            "holdoutCount": len(holdout_errors),
            "holdoutMae": round(sum(holdout_errors) / len(holdout_errors), 2) if holdout_errors else None,
            "contextCount": len(errors) - len(holdout_errors)}


@lru_cache(maxsize=128)
def exact_hourly_shap(model, feature_names, current, references):
    """Shapley values over all feature subsets using historical rows as background."""
    import numpy as np
    import pandas as pd

    feature_count = len(feature_names)
    subsets = np.arange(1 << feature_count)
    masks = (subsets[:, None] & (1 << np.arange(feature_count))) != 0
    background = np.asarray(references)
    masked_rows = np.where(masks[:, None, :], np.asarray(current), background[None, :, :])
    frame = pd.DataFrame(masked_rows.reshape(-1, feature_count), columns=feature_names)
    coalition_values = model.predict(frame).reshape(len(subsets), len(references)).mean(axis=1)
    subset_sizes = masks.sum(axis=1)
    weights = np.array([
        1 / (feature_count * math.comb(feature_count - 1, size))
        for size in range(feature_count)
    ])
    contributions = []
    for index, feature in enumerate(feature_names):
        excluded = subsets[~masks[:, index]]
        changes = coalition_values[excluded | (1 << index)] - coalition_values[excluded]
        contributions.append({
            "feature": feature,
            "value": float(weights[subset_sizes[excluded]] @ changes),
        })
    return {
        "baseValue": float(coalition_values[0]),
        "predictedPM25": float(coalition_values[-1]),
        "contributions": sorted(contributions, key=lambda item: abs(item["value"]), reverse=True),
    }


def explain_hourly_forecast(station_id, base, bundle, features, horizon):
    feature_names = tuple(bundle["features"])
    if len(feature_names) > 12:
        return {"reason": "explanation_unavailable"}
    start = base - timedelta(days=7, hours=max(bundle["lags"]))
    with database() as conn:
        rows = conn.execute(
            """SELECT observed_at, pm25 FROM airbkk_hourly
               WHERE station_id=? AND observed_at>=? AND observed_at<?
               ORDER BY observed_at""",
            (station_id, start.isoformat(), base.isoformat()),
        ).fetchall()
    history = {datetime.fromisoformat(stamp): value for stamp, value in rows}
    candidates = []
    for stamp in history:
        if stamp >= base - timedelta(days=7):
            row = hourly_features(history, stamp, bundle["lags"])
            if row is not None:
                candidates.append(tuple(row[name] for name in feature_names))
    if not candidates:
        return {"reason": "no_reference_history"}
    count = min(8, len(candidates))
    references = tuple(candidates[(i * len(candidates)) // count] for i in range(count))
    current = tuple(features[name] for name in feature_names)
    explanation = exact_hourly_shap(bundle["models"][horizon], feature_names, current, references)
    scores = {item["feature"]: item["value"] for item in explanation["contributions"]}
    contributions = [item for item in explanation["contributions"] if item["feature"] not in {"sin", "cos"}]
    contributions.append({"feature": "hour_of_day", "value": scores["sin"] + scores["cos"]})
    return {
        "hoursAhead": horizon, "referenceCount": count, **explanation,
        "contributions": sorted(contributions, key=lambda item: abs(item["value"]), reverse=True),
    }


def hourly_forecast(station_id, now, *, diagnostics_only=False, shap_horizon=None):
    station_id = station_id.upper()
    if station_id not in STATIONS and station_id not in AQM_STATIONS:
        return {"reason": "station_not_supported", "points": []}
    import pandas as pd

    with database() as conn:
        table = conn.execute("SELECT 1 FROM sqlite_master WHERE name='airbkk_hourly'").fetchone()
        rows = conn.execute("""SELECT observed_at, pm25, fetched_at FROM airbkk_hourly
            WHERE station_id=? AND observed_at<=? ORDER BY observed_at DESC LIMIT 25""",
            (station_id, now.isoformat())).fetchall() if table else []
    history = {datetime.fromisoformat(stamp): value for stamp, value, _ in rows}
    if not history:
        return {"reason": "no_observations", "points": []}
    base = max(history)
    result = {"observedAt": base.isoformat(), "source": "AirBKK" if station_id in STATIONS else "AQMThai", "points": [],
              "latestObservation": {"observedAt": base.isoformat(), "pm25": history[base]}}
    if diagnostics_only:
        result["history"] = [
            {"observedAt": stamp, "pm25": value}
            for stamp, value, _ in reversed(rows)
        ]
        result["lastStoredAt"] = max(fetched for _, _, fetched in rows)
    if now - base >= 2 * HOUR:
        return {**result, "reason": "stale_observations"}
    bundle = load_model()
    result["modelName"] = bundle.get("model_name", type(bundle["models"][1]).__name__)
    result["experimental"] = station_id not in bundle.get("training_stations", [TRAINING_STATION])
    needed = {lag: base - lag * HOUR for lag in bundle["lags"]}
    missing = sorted(stamp.isoformat() for stamp in needed.values() if stamp not in history)
    if missing:
        return {**result, "reason": "missing_hourly_observations", "missingHours": missing}
    if diagnostics_only:
        return {**result, "ready": True}
    features = hourly_features(history, base, bundle["lags"])
    frame = pd.DataFrame([features], columns=bundle["features"])
    result["points"] = [
        {"hoursAhead": h, "targetAt": (base + h * HOUR).isoformat(),
         "predictedPM25": round(float(bundle["models"][h].predict(frame)[0]), 2)}
        for h in range(1, 7)
    ]
    if shap_horizon is not None:
        try:
            result["shap"] = explain_hourly_forecast(station_id, base, bundle, features, shap_horizon)
        except Exception:
            logger.exception("Hourly SHAP unavailable for %s", station_id)
            result["shap"] = {"reason": "explanation_unavailable"}
    return result



def record_hourly_issuance(stop):
    """Record the first forecast computed for each station, base hour and horizon."""
    rows = []
    model_file = os.path.basename(hourly_model_path())
    for station_id in dict.fromkeys((*STATIONS, *AQM_STATIONS)):
        if stop.is_set():
            break
        try:
            forecast = hourly_forecast(station_id, datetime.now(BKK_TZ))
            issued_at = datetime.now(BKK_TZ)
            for point in forecast["points"]:
                if datetime.fromisoformat(point["targetAt"]) > issued_at:
                    rows.append((
                        station_id, forecast["observedAt"], point["hoursAhead"], point["targetAt"],
                        issued_at.isoformat(), point["predictedPM25"],
                        forecast["latestObservation"]["pm25"], model_file,
                    ))
        except Exception:
            logger.exception("Could not issue hourly forecast for %s", station_id)
    with database() as conn:
        result = conn.executemany(
            """INSERT INTO hourly_forecast_issuance VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(station_id, base_at, horizon) DO NOTHING""",
            rows,
        )
        return result.rowcount


def compare_issued_hourly(station_id, horizon, now):
    """Compare recorded forecasts against subsequent observations for the same station and hour."""
    model_file = os.path.basename(hourly_model_path())
    with database() as conn:
        rows = conn.execute(
            """SELECT f.issued_at, f.base_at, f.target_at, f.predicted, f.persistence, f.model_file, a.pm25
               FROM hourly_forecast_issuance AS f
               LEFT JOIN airbkk_hourly AS a
                 ON a.station_id = f.station_id AND a.observed_at = f.target_at AND f.target_at <= ?
               WHERE f.station_id = ? AND f.horizon = ? AND f.model_file = ? AND f.issued_at BETWEEN ? AND ?
               ORDER BY f.target_at DESC""",
            (now.isoformat(), station_id, horizon, model_file, (now - timedelta(days=7)).isoformat(), now.isoformat()),
        ).fetchall()
    points = [
        {"issuedAt": issued_at, "baseAt": base_at, "targetAt": target_at, "predicted": predicted,
         "persistence": persistence, "modelFile": model_file, "actual": actual}
        for issued_at, base_at, target_at, predicted, persistence, model_file, actual in rows
    ]
    matched = [point for point in points if point["actual"] is not None]
    pending = sum(datetime.fromisoformat(point["targetAt"]) > now for point in points)
    return {
        "stationId": station_id, "horizon": horizon, "windowDays": 7, "modelFile": model_file,
        "issuedCount": len(points), "matchedCount": len(matched),
        "pendingCount": pending, "missingActualCount": len(points) - len(matched) - pending,
        "modelMae": sum(abs(point["predicted"] - point["actual"]) for point in matched) / len(matched) if matched else None,
        "persistenceMae": sum(abs(point["persistence"] - point["actual"]) for point in matched) / len(matched) if matched else None,
        "points": points[:12],
    }
