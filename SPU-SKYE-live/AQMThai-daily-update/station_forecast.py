"""Station daily PM2.5 storage, backtest and next-calendar-day inference."""
import argparse
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta
import json
import math
import os
from pathlib import Path
import re
import sqlite3

from live_data import BKK_TZ, get_live_snapshot

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("PM25_STATION_DB", ROOT / "station_pm25.sqlite3"))
BUNDLE_PATH = Path(os.getenv("PM25_STATION_MODEL_PATH", ROOT / "models/station_extra_trees.joblib"))
SCHEMA = "bangkok_station_daily_pm25_v1"
LAGS = (1, 2, 3, 7, 14)
WINDOWS = (3, 7, 14)
FEATURES = [f"pm25_lag_{n}" for n in LAGS] + [
    f"pm25_rolling_{n}" for n in WINDOWS
] + ["target_month_sin", "target_month_cos"]
DAY = timedelta(days=1)


@contextmanager
def database():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=15)
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS air4thai_latest (
                station_id TEXT NOT NULL, observed_at TEXT NOT NULL,
                fetched_at TEXT NOT NULL, pm25 REAL NOT NULL,
                averaging_period TEXT NOT NULL, station_name TEXT NOT NULL,
                PRIMARY KEY(station_id, observed_at)
            );
            CREATE TABLE IF NOT EXISTS station_daily (
                station_id TEXT NOT NULL, day TEXT NOT NULL, pm25 REAL NOT NULL,
                imported_at TEXT NOT NULL, source TEXT NOT NULL,
                PRIMARY KEY(station_id, day)
            );
        """)
        with conn:
            yield conn
    finally:
        conn.close()


def store_snapshot(snapshot):
    if not snapshot or snapshot["cache_stale"]:
        raise ValueError("A fresh Air4Thai response is required")
    fetched = datetime.fromisoformat(snapshot["fetched_at"])
    rows = []
    for station in snapshot["stations"].values():
        value = station["current_pm25"]
        stamp = station["observed_at"]
        if (
            value is None or stamp is None or station["is_stale"]
            or datetime.fromisoformat(stamp) > fetched
        ):
            continue
        rows.append((
            station["station_id"].upper(), stamp, fetched.isoformat(), value,
            station["averaging_period"], station["name"],
        ))
    if not rows:
        raise ValueError("Air4Thai returned no fresh, dated Bangkok PM2.5 measurements")
    with database() as conn:
        result = conn.executemany(
            "INSERT OR IGNORE INTO air4thai_latest VALUES (?, ?, ?, ?, ?, ?)", rows
        )
        return {"eligible": len(rows), "inserted": result.rowcount}


def read_workbook(path, imported_at):
    from openpyxl import load_workbook

    book = load_workbook(path, read_only=True, data_only=True)
    try:
        metadata = {}
        for row in book["รายละเอียดจุดตรวจวัด"].values:
            station = str(row[2] or "").strip().upper()
            area = str(row[3] or "").strip()
            if re.fullmatch(r"[A-Z0-9]+", station) and area:
                if station in metadata and metadata[station] != area:
                    raise ValueError(f"{path.name}: conflicting station location for {station}")
                metadata[station] = area
        rows = iter(book["DATA"].values)
        header = next(rows)
        if str(header[0]).strip().lower() != "date":
            raise ValueError(f"{path.name}: DATA must start with Date")
        columns = {}
        for index, value in enumerate(header[1:], 1):
            station = str(value or "").strip().upper()
            if any(token in metadata.get(station, "") for token in ("กรุงเทพ", "กทม.")):
                if station in columns.values():
                    raise ValueError(f"{path.name}: duplicate station column {station}")
                columns[index] = station
        if not columns:
            raise ValueError(f"{path.name}: no Bangkok stations matched workbook metadata")
        seen = set()
        for line, row in enumerate(rows, 2):
            value = row[0]
            if value is None or str(value).strip().startswith(("หมายเหตุ", "N/A")):
                continue
            day = value.date() if isinstance(value, datetime) else date.fromisoformat(str(value))
            if day in seen or day >= imported_at.date():
                raise ValueError(f"{path.name}:{line}: duplicate or incomplete date {day}")
            seen.add(day)
            for index, station in columns.items():
                value = row[index]
                if value is None or str(value).strip().upper() in {"", "N/A", "NA", "-", "-999", "-1"}:
                    continue
                pm25 = float(value)
                if not math.isfinite(pm25) or pm25 < 0:
                    raise ValueError(f"{path.name}:{line}: invalid PM2.5 for {station}")
                yield station, day.isoformat(), pm25, imported_at.isoformat(), path.name
    finally:
        book.close()


def import_workbooks(paths):
    imported_at = datetime.now(BKK_TZ)
    rows = [row for path in paths for row in read_workbook(path, imported_at)]
    return store_daily_rows(rows)


def store_daily_rows(rows):
    if not rows:
        raise ValueError("No Bangkok daily PM2.5 measurements found")
    inserted = 0
    with database() as conn:
        for row in rows:
            inserted += conn.execute(
                "INSERT OR IGNORE INTO station_daily VALUES (?, ?, ?, ?, ?)", row
            ).rowcount
            previous = conn.execute(
                "SELECT pm25 FROM station_daily WHERE station_id=? AND day=?", row[:2]
            ).fetchone()[0]
            if previous != row[2]:
                raise ValueError(f"Conflicting daily PM2.5 for {row[0]} on {row[1]}")
    return {"eligible": len(rows), "inserted": inserted}


def feature_row(history, issue_day):
    """Latest eligible day is yesterday in Bangkok. Every lag is a calendar lag."""
    prior_days = [issue_day - timedelta(days=n) for n in range(1, 15)]
    if any(day not in history for day in prior_days):
        return None
    values = [history[day] for day in prior_days]
    angle = 2 * math.pi * (issue_day + DAY).month / 12
    return (
        [values[n - 1] for n in LAGS]
        + [sum(values[:n]) / n for n in WINDOWS]
        + [math.sin(angle), math.cos(angle)]
    )


def station_histories():
    histories = {}
    with database() as conn:
        for sid, day, pm25 in conn.execute(
            "SELECT station_id, day, pm25 FROM station_daily ORDER BY day"
        ):
            histories.setdefault(sid, {})[date.fromisoformat(day)] = pm25
    return histories


def train():
    import joblib
    import numpy as np
    import pandas as pd
    import sklearn
    from sklearn.ensemble import ExtraTreesRegressor

    histories = station_histories()
    if not histories:
        raise ValueError("Import verified daily workbooks first")
    end = max(max(history) for history in histories.values())
    test_start = end - timedelta(days=59)
    first_test_issue = test_start - DAY
    models, by_station, totals, coverage = {}, {}, [], {}

    def metrics(actual, prediction, baseline):
        scores = {}
        for name, values in (("extraTrees", prediction), ("persistence", baseline)):
            error = np.asarray(values) - actual
            scores[name] = {
                "mae": round(float(np.abs(error).mean()), 3),
                "rmse": round(float(np.sqrt(np.square(error).mean())), 3),
            }
        return {"count": len(actual), **scores}

    for sid, history in sorted(histories.items()):
        training, testing = [], []
        for target, observed in history.items():
            features = feature_row(history, target - DAY)
            if features is None:
                continue
            if target < first_test_issue:
                training.append((features, observed))
            elif target >= test_start:
                testing.append((features, observed))
        coverage[sid] = {
            "dailyRows": len(history), "trainingRows": len(training),
            "testRows": len(testing), "lastDailyDate": max(history).isoformat(),
        }
        if len(training) < 60 or len(testing) < 15:
            continue
        inputs, labels = zip(*training)
        model = ExtraTreesRegressor(
            n_estimators=150, min_samples_leaf=3, random_state=42, n_jobs=1
        )
        model.fit(pd.DataFrame(inputs, columns=FEATURES), labels)
        inputs, labels = zip(*testing)
        predictions = model.predict(pd.DataFrame(inputs, columns=FEATURES))
        baseline = [row[0] for row in inputs]
        totals.extend(zip(labels, predictions, baseline))
        by_station[sid] = metrics(*map(np.asarray, (labels, predictions, baseline)))
        models[sid] = model

    if not models:
        raise ValueError("No station has sufficient chronological train and holdout rows")
    report = {
        "schema": SCHEMA,
        "method": "retrospective_daily_holdout_with_assumed_prior_day_availability",
        "unit": "ug/m3",
        "testTargetStart": test_start.isoformat(), "testTargetEnd": end.isoformat(),
        "lastEligibleTrainingTarget": (first_test_issue - DAY).isoformat(),
        "overall": metrics(*map(np.asarray, zip(*totals))),
        "stations": by_station, "coverage": coverage,
    }
    BUNDLE_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation preserves the previous release if training is rerun.
    with BUNDLE_PATH.open("xb") as output:
        joblib.dump({
            "schema": SCHEMA, "features": FEATURES, "models": models,
            "report": report, "sklearn_version": sklearn.__version__,
        }, output, compress=3)
    return report


def load_station_bundle():
    import joblib
    import sklearn
    from sklearn.ensemble import ExtraTreesRegressor
    from sklearn.utils.validation import check_is_fitted

    bundle = joblib.load(BUNDLE_PATH)
    if (
        bundle["schema"] != SCHEMA or bundle["features"] != FEATURES
        or bundle["sklearn_version"] != sklearn.__version__
        or not bundle["models"] or bundle["report"]["schema"] != SCHEMA
    ):
        raise ValueError("Incompatible station bundle")
    for model in bundle["models"].values():
        if not isinstance(model, ExtraTreesRegressor):
            raise ValueError("The station bundle must contain Extra Trees models")
        check_is_fitted(model)
        if list(model.feature_names_in_) != FEATURES:
            raise ValueError("Station estimator feature order differs from bundle schema")
    return bundle


def forecast_station(station_id, models, history, issue_day):
    import pandas as pd

    if station_id not in models:
        return {"forecastAvailable": False, "reason": "station_model_unavailable"}
    features = feature_row(history, issue_day)
    if features is None:
        last = max((day for day in history if day < issue_day), default=None)
        return {
            "forecastAvailable": False, "reason": "station_daily_history_required",
            "latestDailyDate": last.isoformat() if last else None,
        }
    value = float(models[station_id].predict(pd.DataFrame([features], columns=FEATURES))[0])
    if not math.isfinite(value) or value < 0:
        return {"forecastAvailable": False, "reason": "invalid_model_output"}
    return {
        "forecastAvailable": True, "predictedPM25": round(value, 2),
        "latestDailyDate": (issue_day - DAY).isoformat(),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("collect")
    importer = commands.add_parser("import-xlsx")
    importer.add_argument("files", type=Path, nargs="+")
    commands.add_parser("train")
    args = parser.parse_args()
    if args.command == "collect":
        result = store_snapshot(get_live_snapshot(force_refresh=True))
    elif args.command == "import-xlsx":
        result = import_workbooks(args.files)
    else:
        result = train()
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
