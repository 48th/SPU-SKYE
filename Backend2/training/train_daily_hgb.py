"""Train the 19-input next-day model from the PM25 training feature export."""
import argparse
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

FEATURES = [
    "ฝุ่น PM2.5", "ฝุ่น PM10", "ดัชนีคุณภาพอากาศ US AQI",
    "pm25_lag_1", "pm25_lag_2", "pm25_lag_3", "pm25_lag_7", "pm25_lag_14",
    "pm25_rolling_3", "pm25_rolling_7", "pm25_rolling_14",
    "ปริมาณฝนรวม (mm)", "เมฆปกคลุมเฉลี่ย (%)", "ความกดอากาศพื้นผิวเฉลี่ย (hPa)",
    "ความกดอากาศระดับน้ำทะเลเฉลี่ย (hPa)", "รหัสสภาพอากาศที่พบบ่อยสุด (wmo code)",
    "month_sin", "month_cos", "weekday_number",
]
TARGET = "ฝุ่น PM2.5 พรุ่งนี้"


def train(source, output):
    frame = pd.read_csv(source, encoding="utf-8-sig")
    frame["issue_date"] = pd.to_datetime(frame["วันที่"], errors="raise")
    frame[FEATURES + [TARGET]] = frame[FEATURES + [TARGET]].apply(pd.to_numeric, errors="coerce")
    frame = frame.replace([np.inf, -np.inf], np.nan).dropna(subset=FEATURES + [TARGET]).sort_values("issue_date")
    if frame["issue_date"].duplicated().any():
        raise ValueError("Expected one training row per issue date")
    split = frame["issue_date"].iloc[int(len(frame) * 0.8)]
    earlier = frame["issue_date"] + pd.Timedelta(days=1) < split
    training, testing = frame[earlier], frame[frame["issue_date"] >= split]
    if min(len(training), len(testing)) < 100:
        raise ValueError("Not enough dated rows")
    model = HistGradientBoostingRegressor(max_iter=140, learning_rate=0.05, max_depth=4,
                                          l2_regularization=5, early_stopping=False, random_state=42)
    model.fit(training[FEATURES], training[TARGET])
    error = model.predict(testing[FEATURES]) - testing[TARGET]
    baseline_error = testing[FEATURES[0]] - testing[TARGET]
    report = {"trainCount": len(training), "testCount": len(testing), "testStart": split.date().isoformat(),
              "mae": float(abs(error).mean()), "rmse": float(np.sqrt(np.square(error).mean())),
              "baselineMae": float(abs(baseline_error).mean())}
    with output.open("xb") as file:
        joblib.dump({"model": model, "features": FEATURES, "model_name": "HistGradientBoosting",
                     "evaluation": report}, file, compress=3)
    print(report)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    train(args.source, args.output)
