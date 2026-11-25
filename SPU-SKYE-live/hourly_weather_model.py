"""Train and inspect an experimental hourly PM2.5 model with weather inputs."""
import json
import math
import os
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesRegressor

from airbkk_hourly import HOUR, exact_hourly_shap, hourly_features, load_model
from live_data import BKK_TZ, OPEN_METEO_FORECAST_URL, _fetch_json, get_live_snapshot
from station_forecast import DB_PATH, database

WEATHER_FIELDS = ("wind_speed_10m", "rain", "relative_humidity_2m")
ARTIFACT = DB_PATH.with_name("hourly_weather_experiment.joblib")
ARTIFACT_SCHEMA = 1


def weather_rows(coordinates, start, end):
    latitude, longitude = zip(*coordinates)
    reports = _fetch_json(OPEN_METEO_FORECAST_URL, {
        "latitude": ",".join(map(str, latitude)),
        "longitude": ",".join(map(str, longitude)),
        "timezone": "Asia/Bangkok",
        "wind_speed_unit": "kmh",
        "hourly": ",".join(WEATHER_FIELDS),
        "start_date": start,
        "end_date": end,
    }, timeout=30)
    if isinstance(reports, dict):
        reports = [reports]
    if len(reports) != len(coordinates):
        raise ValueError("Mismatch in number of weather reports")
    frames = []
    for report in reports:
        if report.get("utc_offset_seconds") != 7 * 3600:
            raise ValueError("Unexpected weather time zone")
        hourly = report["hourly"]
        readings = zip(hourly["time"], *(hourly[field] for field in WEATHER_FIELDS))
        frames.append({
            datetime.fromisoformat(stamp).replace(tzinfo=BKK_TZ): values
            for stamp, *values in readings
            if all(isinstance(value, (int, float)) and math.isfinite(value) for value in values)
        })
    return frames


def train():
    base_bundle = load_model()
    feature_names = [*base_bundle["features"], *WEATHER_FIELDS]
    snapshot = get_live_snapshot()
    if not snapshot:
        raise RuntimeError("Station coordinates unavailable")
    with database() as conn:
        records = conn.execute(
            "SELECT station_id, observed_at, pm25 FROM airbkk_hourly ORDER BY station_id, observed_at"
        ).fetchall()
    histories = {}
    for station, stamp, pm25 in records:
        if station.lower() in snapshot["stations"]:
            histories.setdefault(station, {})[datetime.fromisoformat(stamp)] = pm25
    if not histories:
        raise RuntimeError("No hourly PM2.5 records available")
    start = min(min(history) for history in histories.values())
    end = max(max(history) for history in histories.values())
    test_start = end - timedelta(hours=17)
    station_ids = sorted(histories)
    examples = []
    for offset in range(0, len(station_ids), 12):
        batch = station_ids[offset:offset + 12]
        coords = [
            (snapshot["stations"][sid.lower()]["meta"]["lat"], snapshot["stations"][sid.lower()]["meta"]["lon"])
            for sid in batch
        ]
        reports = weather_rows(coords, start.date(), end.date())
        for sid, weather in zip(batch, reports):
            history = histories[sid]
            for stamp in history:
                pm_inputs = hourly_features(history, stamp, base_bundle["lags"])
                if pm_inputs is None or stamp not in weather:
                    continue
                row = {**pm_inputs, **dict(zip(WEATHER_FIELDS, weather[stamp]))}
                examples.append((stamp, sid, row, [history.get(stamp + hour * HOUR) for hour in range(1, 7)]))
        print(f"Weather joined for {offset + len(batch)}/{len(station_ids)} stations", flush=True)

    examples.sort(key=lambda row: (row[0], row[1]))
    models = {}
    metrics = []
    references = {}
    for horizon in range(1, 7):
        valid = [row for row in examples if row[3][horizon - 1] is not None]
        training = [row for row in valid if row[0] + horizon * HOUR < test_start]
        testing = [row for row in valid if row[0] >= test_start]
        if len(training) < 100 or len(testing) < 100:
            raise ValueError(f"Not enough training/test samples for horizon {horizon}")
        train_x = pd.DataFrame([row[2] for row in training], columns=feature_names)
        test_x = pd.DataFrame([row[2] for row in testing], columns=feature_names)
        train_y = [row[3][horizon - 1] for row in training]
        test_y = np.asarray([row[3][horizon - 1] for row in testing])
        scores = {}
        for name, columns in (("pmOnly", base_bundle["features"]), ("withWeather", feature_names)):
            model = ExtraTreesRegressor(n_estimators=64, min_samples_leaf=5, random_state=42, n_jobs=1)
            model.fit(train_x[columns], train_y)
            error = model.predict(test_x[columns]) - test_y
            scores[name] = {"mae": round(float(np.abs(error).mean()), 3),
                            "rmse": round(float(np.sqrt(np.square(error).mean())), 3)}
            if name == "withWeather":
                models[horizon] = model
        reference_indices = np.linspace(0, len(training) - 1, 4, dtype=int)
        references[horizon] = tuple(tuple(row) for row in train_x.iloc[reference_indices].to_numpy())
        metrics.append({"horizon": horizon, "trainCount": len(training), "testCount": len(testing),
                        "testStationCount": len({row[1] for row in testing}), **scores})
    bundle = {"schema": ARTIFACT_SCHEMA, "features": feature_names, "lags": base_bundle["lags"],
              "models": models, "references": references, "metrics": metrics,
              "testStart": test_start.isoformat(), "testEnd": end.isoformat()}
    temporary = ARTIFACT.with_name(ARTIFACT.name + ".tmp")
    joblib.dump(bundle, temporary, compress=3)
    os.replace(temporary, ARTIFACT)
    print(json.dumps({key: bundle[key] for key in ("testStart", "testEnd", "metrics")}), flush=True)


@lru_cache(maxsize=1)
def load_experiment(modified_ns):
    bundle = joblib.load(ARTIFACT)
    if bundle["schema"] != ARTIFACT_SCHEMA:
        raise ValueError("Incompatible weather experiment")
    return bundle


@lru_cache(maxsize=64)
def observed_weather(lat, lon, stamp):
    return weather_rows([(lat, lon)], stamp.date(), stamp.date())[0].get(stamp)


def weather_explanation(station_id, horizon, now):
    if not ARTIFACT.is_file():
        return {"reason": "model_not_trained"}
    bundle = load_experiment(ARTIFACT.stat().st_mtime_ns)
    assessment = {key: bundle[key] for key in ("testStart", "testEnd", "metrics")}
    station_id = station_id.upper()
    snapshot = get_live_snapshot()
    station = snapshot["stations"].get(station_id.lower()) if snapshot else None
    if not station:
        return {**assessment, "reason": "station_unavailable"}
    with database() as conn:
        rows = conn.execute(
            """SELECT observed_at, pm25 FROM airbkk_hourly
               WHERE station_id=? AND observed_at<=? ORDER BY observed_at DESC LIMIT 25""",
            (station_id, now.isoformat()),
        ).fetchall()
    history = {datetime.fromisoformat(stamp): pm for stamp, pm in rows}
    if not history or now - max(history) >= 2 * HOUR:
        return {**assessment, "reason": "stale_or_missing_pm25"}
    base = max(history)
    target = base + horizon * HOUR
    if target <= now:
        return {**assessment, "reason": "forecast_time_passed"}
    pm_inputs = hourly_features(history, base, bundle["lags"])
    if pm_inputs is None:
        return {**assessment, "reason": "stale_or_missing_pm25"}
    weather = observed_weather(station["meta"]["lat"], station["meta"]["lon"], base)
    if weather is None:
        return {**assessment, "reason": "weather_unavailable"}
    inputs = {**pm_inputs, **dict(zip(WEATHER_FIELDS, weather))}
    features = tuple(bundle["features"])
    shap = exact_hourly_shap(bundle["models"][horizon], features,
                             tuple(inputs[name] for name in features), bundle["references"][horizon])
    return {**assessment, "baseAt": base.isoformat(), "targetAt": target.isoformat(),
            "referenceCount": len(bundle["references"][horizon]), "inputs": inputs, **shap}


if __name__ == "__main__":
    train()
