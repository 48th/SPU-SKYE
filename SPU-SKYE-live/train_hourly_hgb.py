"""Fit direct HistGradientBoosting forecasts for 1–6 hours from stored PM2.5."""
from argparse import ArgumentParser
from datetime import datetime, timedelta
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import HistGradientBoostingRegressor

from airbkk_hourly import HOUR, TRAINING_STATION, hourly_features
from station_forecast import ROOT, database

LAGS = [0, 1, 2, 3, 6, 12, 24]
FEATURES = [f"lag{lag}" for lag in LAGS] + ["sin", "cos"]


def train(output):
    previous = joblib.load(ROOT / "models/BKP102T-hourly-extra-trees.joblib")
    with database() as conn:
        rows = conn.execute("SELECT station_id, observed_at, pm25 FROM airbkk_hourly ORDER BY observed_at").fetchall()
    history_by_station = {}
    for station, stamp, value in rows:
        history_by_station.setdefault(station, {})[datetime.fromisoformat(stamp)] = value
    latest = max(max(history) for history in history_by_station.values())
    cutoff = latest - timedelta(hours=17)
    examples = []
    for station, history in history_by_station.items():
        for base in history:
            features = hourly_features(history, base, LAGS)
            if features is not None:
                examples.append((base, station, features, history))
    examples.sort(key=lambda row: (row[0], row[1]))

    models, report = {}, []
    for horizon in range(1, 7):
        candidates = [(base, station, features, history[base + horizon * HOUR])
                      for base, station, features, history in examples if base + horizon * HOUR in history]
        train_rows = [row for row in candidates if row[0] + horizon * HOUR < cutoff]
        test_rows = [row for row in candidates if row[0] >= cutoff]
        if min(len(train_rows), len(test_rows)) < 100:
            raise ValueError(f"Not enough examples for horizon {horizon}")
        train_x = pd.DataFrame([row[2] for row in train_rows], columns=FEATURES)
        test_x = pd.DataFrame([row[2] for row in test_rows], columns=FEATURES)
        test_y = np.array([row[3] for row in test_rows])
        model = HistGradientBoostingRegressor(max_iter=100, max_depth=5, min_samples_leaf=24,
                                              learning_rate=0.06, l2_regularization=5,
                                              early_stopping=False, random_state=42)
        model.fit(train_x, [row[3] for row in train_rows])
        models[horizon] = model
        error = model.predict(test_x) - test_y
        record = {"horizon": horizon, "trainCount": len(train_rows), "testCount": len(test_rows),
                  "mae": float(np.abs(error).mean()), "rmse": float(np.sqrt(np.square(error).mean())),
                  "baselineMae": float(np.abs(test_x["lag0"] - test_y).mean()),
                  "previousModelMae": float(np.abs(previous["models"][horizon].predict(test_x) - test_y).mean())}
        report.append(record)
        print(record, flush=True)
    with output.open("xb") as handle:
        joblib.dump({"station_id": TRAINING_STATION, "training_stations": sorted(history_by_station),
                     "models": models, "features": FEATURES, "lags": LAGS, "timezone": "Asia/Bangkok",
                     "sklearn_version": sklearn.__version__, "model_name": "HistGradientBoosting",
                     "training_end": (cutoff - HOUR).isoformat(), "test_start": cutoff.isoformat(),
                     "evaluation": report}, handle, compress=3)


if __name__ == "__main__":
    parser = ArgumentParser()
    parser.add_argument("output", type=Path)
    train(parser.parse_args().output)
