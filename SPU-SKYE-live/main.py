"""Bangkok station API. Observations and daily model inference are separate."""
import os
import csv
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
import logging
import math
from secrets import compare_digest
from threading import Thread

from airbkk_hourly import (
    STATIONS as AIRBKK_HOURLY_STATIONS, compare_hourly_forecast, compare_issued_hourly,
    hourly_forecast, run_airbkk_daily, run_hourly,
)
from typing import Any, Dict, List, Optional
import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import AliasChoices, BaseModel, ConfigDict, Field
from live_data import BKK_TZ, get_live_snapshot, get_station_weather
from live_pipeline import start_collector
from hourly_weather_model import weather_explanation
from station_forecast import (
    AIRBKK_DAILY_ARCHIVE, database, forecast_station, initialize_database,
    load_station_bundle, station_histories,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("pm25_api")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.environ.get(
    "PM25_MODEL_PATH",
    os.path.join(BASE_DIR, "models", "PM25_model_bundle.joblib")
)
model_state = {"model": None, "features": [], "model_name": None, "error": None}
station_bundle = None

FEATURE_MAPPING: Dict[str, str] = {
    "pm25": "ฝุ่น PM2.5",
    "pm10": "ฝุ่น PM10",
    "us_aqi": "ดัชนีคุณภาพอากาศ US AQI",
    "month": "เดือน",
    "temp_mean": "อุณหภูมิเฉลี่ย (°C)",
    "temp_max": "อุณหภูมิสูงสุด (°C)",
    "temp_min": "อุณหภูมิต่ำสุด (°C)",
    "rain_sum": "ปริมาณฝนรวม (mm)",
    "humidity_mean": "ความชื้นสัมพัทธ์เฉลี่ย (%)",
    "wind_speed_mean": "ความเร็วลมเฉลี่ย (km/h)",
    "wind_speed_max": "ความเร็วลมสูงสุด (km/h)",
    "wind_u": "องค์ประกอบลมแกนตะวันออก-ตะวันตก",
    "wind_v": "องค์ประกอบลมแกนเหนือ-ใต้",
    "cloud_cover_mean": "เมฆปกคลุมเฉลี่ย (%)",
    "surface_pressure_mean": "ความกดอากาศพื้นผิวเฉลี่ย (hPa)",
    "sea_level_pressure_mean": "ความกดอากาศระดับน้ำทะเลเฉลี่ย (hPa)",
    "weather_code": "รหัสสภาพอากาศที่พบบ่อยสุด (wmo code)",
    "wind_direction_mean": "ทิศทางลมเฉลี่ย (°)",
    "pm25_lag_1": "pm25_lag_1",
    "pm25_lag_2": "pm25_lag_2",
    "pm25_lag_3": "pm25_lag_3",
    "pm25_lag_7": "pm25_lag_7",
    "pm25_lag_14": "pm25_lag_14",
    "pm25_rolling_3": "pm25_rolling_3",
    "pm25_rolling_7": "pm25_rolling_7",
    "pm25_rolling_14": "pm25_rolling_14",
    "month_sin": "month_sin",
    "month_cos": "month_cos",
    "weekday_number": "weekday_number",
}

class PredictRequest(BaseModel):
    """Schema defining numerical weather, temporal, and PM2.5 lag inputs."""

    model_config = ConfigDict(
        populate_by_name=True,
        json_schema_extra={
            "example": {
                "pm25": 34.2,
                "pm10": 56.0,
                "us_aqi": 98.0,
                "month": 11,
                "temp_mean": 30.5,
                "temp_max": 34.2,
                "temp_min": 26.8,
                "rain_sum": 0.0,
                "humidity_mean": 68.0,
                "wind_speed_mean": 8.4,
                "wind_speed_max": 14.5,
                "wind_u": -1.2,
                "wind_v": 2.4,
                "cloud_cover_mean": 42.0,
                "surface_pressure_mean": 1011.5,
                "sea_level_pressure_mean": 1012.2,
                "weather_code": 2,
                "wind_direction_mean": 185.0,
                "pm25_lag_1": 31.8,
                "pm25_lag_2": 29.4,
                "pm25_lag_3": 28.0,
                "pm25_lag_7": 25.5,
                "pm25_lag_14": 24.1,
                "pm25_rolling_3": 29.7,
                "pm25_rolling_7": 27.6,
                "pm25_rolling_14": 26.0,
                "month_sin": -0.5,
                "month_cos": 0.866,
                "weekday_number": 3,
            }
        },
    )

    pm25: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices("pm25", "ฝุ่น PM2.5"),
        description="Current day PM2.5 concentration (ug/m3).",
    )
    pm10: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices("pm10", "ฝุ่น PM10"),
        description="Current day PM10 concentration (ug/m3).",
    )
    us_aqi: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices("us_aqi", "ดัชนีคุณภาพอากาศ US AQI"),
        description="US AQI index value.",
    )
    month: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices("month", "เดือน"),
        description="Calendar month number (1 to 12).",
    )
    temp_mean: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices("temp_mean", "อุณหภูมิเฉลี่ย (°C)"),
        description="Mean daily temperature in Celsius.",
    )
    temp_max: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices("temp_max", "อุณหภูมิสูงสุด (°C)"),
        description="Maximum daily temperature in Celsius.",
    )
    temp_min: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices("temp_min", "อุณหภูมิต่ำสุด (°C)"),
        description="Minimum daily temperature in Celsius.",
    )
    rain_sum: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices("rain_sum", "ปริมาณฝนรวม (mm)"),
        description="Total daily rainfall in millimeters.",
    )
    humidity_mean: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices("humidity_mean", "ความชื้นสัมพัทธ์เฉลี่ย (%)"),
        description="Mean relative humidity percentage.",
    )
    wind_speed_mean: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices("wind_speed_mean", "ความเร็วลมเฉลี่ย (km/h)"),
        description="Mean wind speed in km/h.",
    )
    wind_speed_max: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices("wind_speed_max", "ความเร็วลมสูงสุด (km/h)"),
        description="Maximum wind speed in km/h.",
    )
    wind_u: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices("wind_u", "องค์ประกอบลมแกนตะวันออก-ตะวันตก"),
        description="East-west wind vector component.",
    )
    wind_v: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices("wind_v", "องค์ประกอบลมแกนเหนือ-ใต้"),
        description="North-south wind vector component.",
    )
    cloud_cover_mean: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices("cloud_cover_mean", "เมฆปกคลุมเฉลี่ย (%)"),
        description="Mean cloud cover percentage.",
    )
    surface_pressure_mean: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices(
            "surface_pressure_mean", "ความกดอากาศพื้นผิวเฉลี่ย (hPa)"
        ),
        description="Mean surface atmospheric pressure in hPa.",
    )
    sea_level_pressure_mean: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices(
            "sea_level_pressure_mean", "ความกดอากาศระดับน้ำทะเลเฉลี่ย (hPa)"
        ),
        description="Mean sea-level atmospheric pressure in hPa.",
    )
    weather_code: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices(
            "weather_code", "รหัสสภาพอากาศที่พบบ่อยสุด (wmo code)"
        ),
        description="Dominant WMO weather condition code.",
    )
    wind_direction_mean: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices("wind_direction_mean", "ทิศทางลมเฉลี่ย (°)"),
        description="Mean wind direction in degrees.",
    )
    pm25_lag_1: Optional[float] = Field(default=None, description="PM2.5 lag 1 day.")
    pm25_lag_2: Optional[float] = Field(default=None, description="PM2.5 lag 2 days.")
    pm25_lag_3: Optional[float] = Field(default=None, description="PM2.5 lag 3 days.")
    pm25_lag_7: Optional[float] = Field(default=None, description="PM2.5 lag 7 days.")
    pm25_lag_14: Optional[float] = Field(default=None, description="PM2.5 lag 14 days.")
    pm25_rolling_3: Optional[float] = Field(
        default=None, description="3 day rolling average PM2.5."
    )
    pm25_rolling_7: Optional[float] = Field(
        default=None, description="7 day rolling average PM2.5."
    )
    pm25_rolling_14: Optional[float] = Field(
        default=None, description="14 day rolling average PM2.5."
    )
    month_sin: Optional[float] = Field(
        default=None, description="Cyclical sine encoding of month."
    )
    month_cos: Optional[float] = Field(
        default=None, description="Cyclical cosine encoding of month."
    )
    weekday_number: Optional[float] = Field(
        default=None, description="Day of week numeric index."
    )



def load_model_artifacts():
    try:
        artifact = joblib.load(MODEL_PATH)
        if isinstance(artifact, dict):
            estimator = artifact.get("model")
            features = artifact.get("features")
            name = artifact.get("model_name") or type(estimator).__name__
        else:
            estimator = artifact
            features = getattr(estimator, "feature_names_in_", None)
            name = type(estimator).__name__
        if estimator is None or not callable(getattr(estimator, "predict", None)):
            raise ValueError("Model artifact contains no estimator")
        if features is None:
            features = getattr(estimator, "feature_names_in_", None)
        if features is None or isinstance(features, str):
            raise ValueError("Model artifact has no explicit feature order")
        features = [str(column) for column in features]
        if not features or len(set(features)) != len(features):
            raise ValueError("Model feature names must be nonempty and unique")
        if set(features) - (set(FEATURE_MAPPING) | set(FEATURE_MAPPING.values())):
            raise ValueError("Model features do not match the manual prediction schema")
        fitted_names = getattr(estimator, "feature_names_in_", features)
        if list(fitted_names) != features or getattr(estimator, "n_features_in_", len(features)) != len(features):
            raise ValueError("Bundle feature order or count disagrees with fitted estimator")
        model_state.update(
            model=estimator, features=[str(c) for c in features],
            model_name=name, error=None
        )
    except Exception as exc:
        logger.exception("Model unavailable; station observations remain available")
        model_state.update(model=None, features=[], model_name=None, error=str(exc))


@asynccontextmanager
async def lifespan(app):
    global station_bundle
    logger.info("SQLite ready: %s new archived station-days", initialize_database())
    if os.path.isfile(MODEL_PATH) or "PM25_MODEL_PATH" in os.environ:
        load_model_artifacts()
    try:
        station_bundle = load_station_bundle()
    except FileNotFoundError:
        station_bundle = None
    except Exception:
        station_bundle = None
        logger.exception("Station forecast bundle unavailable")
    stop = start_collector()
    Thread(target=run_hourly, args=(stop,), name="airbkk-hourly", daemon=True).start()
    Thread(target=run_airbkk_daily, args=(stop,), name="airbkk-daily", daemon=True).start()
    try:
        yield
    finally:
        stop.set()


app = FastAPI(title="Bangkok PM2.5 Station API", version="3.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=False,
    allow_methods=["*"], allow_headers=["*"]
)


def require_snapshot(refresh=False):
    snapshot = get_live_snapshot(force_refresh=refresh)
    if snapshot is None:
        raise HTTPException(
            status_code=503,
            detail="Station source unavailable. Check network and Air4Thai TLS certificate."
        )
    return snapshot


@app.get("/live", include_in_schema=False)
def live_page():
    return FileResponse(os.path.join(BASE_DIR, "live.html"), headers={"Cache-Control": "no-store"})


@app.get("/api/v1/stations/{station_id}/history")
def station_history(station_id: str):
    end = datetime.now(BKK_TZ)
    start = end - timedelta(days=7)
    with database() as conn:
        rows = conn.execute(
            """SELECT observed_at, pm25 FROM air4thai_latest
               WHERE station_id = ? AND observed_at >= ? AND observed_at <= ?
               ORDER BY observed_at""",
            (station_id.strip().upper(), start.isoformat(), end.isoformat()),
        ).fetchall()
    return {
        "stationId": station_id.upper(),
        "windowStart": start.isoformat(),
        "windowEnd": end.isoformat(),
        "unit": "ug/m3",
        "points": [{"observedAt": stamp, "pm25": value} for stamp, value in rows],
    }


@app.get("/api/v1/stations/{station_id}/history/daily")
def station_daily_history(station_id: str, include_hourly: bool = False):
    sid = station_id.strip().upper()
    today = datetime.now(BKK_TZ).date()
    start = today - timedelta(days=7)
    end = today - timedelta(days=1)
    with database() as conn:
        rows = conn.execute(
            """SELECT day, pm25, source FROM station_daily
               WHERE station_id = ? AND day BETWEEN ? AND ?""",
            (sid, start.isoformat(), end.isoformat()),
        )
        values = {}
        for day, value, source in rows:
            normalized = source.lower()
            provider = (
                "AirBKK" if "airbkk" in normalized else
                "AQMThai" if "aqmthai" in normalized else
                "Air4Thai" if "air4thai" in normalized else
                "ข้อมูลรายวันที่นำเข้า"
            )
            values[day] = (value, provider)
        hourly = {}
        if include_hourly and conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='airbkk_hourly'"
        ).fetchone():
            hourly = {day: (count, mean) for day, count, mean in conn.execute(
                """SELECT substr(observed_at, 1, 10), COUNT(DISTINCT substr(observed_at, 12, 2)), AVG(pm25)
                   FROM airbkk_hourly
                   WHERE station_id=? AND observed_at>=? AND observed_at<?
                   GROUP BY substr(observed_at, 1, 10)""",
                (sid, start.isoformat(), today.isoformat()),
            )}
    # Prefer the original AirBKK daily report when the archive covers a displayed day.
    if AIRBKK_DAILY_ARCHIVE.is_file():
        with AIRBKK_DAILY_ARCHIVE.open(encoding="utf-8-sig", newline="") as source:
            for row in csv.DictReader(source):
                if row["station_id"] == sid and start.isoformat() <= row["date"] <= end.isoformat():
                    values[row["date"]] = (float(row["pm25"]), "AirBKK")
    points = []
    for offset in range(7):
        day = (start + timedelta(days=offset)).isoformat()
        value, provider = values.get(day, (None, None))
        point = {"date": day, "pm25": value, "source": provider}
        if value is None and day in hourly:
            count, mean = hourly[day]
            point["hoursAvailable"] = count
            if count == 24:
                point.update(pm25=round(mean, 2),
                             source="AirBKK" if sid in AIRBKK_HOURLY_STATIONS else "AQMThai",
                             derivedFromHourly=True)
        points.append(point)
    return {"stationId": sid, "unit": "ug/m3", "points": points}


def station_output(station, cache_stale=False):
    meta = station["meta"]
    return {
        "id": meta["id"],
        "stationId": meta["id"],
        "name": meta["name"],
        "stationName": meta["name"],
        "district": meta["district"],
        "area": meta["area"],
        "lat": meta["lat"],
        "lon": meta["lon"],
        "latitude": meta["lat"],
        "longitude": meta["lon"],
        "currentPM25": station["current_pm25"],
        "currentPM10": station["current_pm10"],
        "thaiAQI": station["current_thai_aqi"],
        "temperatureC": None,
        "windSpeedMs": None,
        "windDirectionDeg": None,
        "observedAt": station["observed_at"],
        "reportedDate": station["reported_date"],
        "reportedTime": station["reported_time"],
        "isStale": cache_stale or station["is_stale"],
        "averagingPeriod": station["averaging_period"],
        "dataSource": "air4thai",
        "forecastAvailable": False,
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": model_state["model"] is not None,
        "model_name": model_state["model_name"],
        "feature_count": len(model_state["features"]),
        "model_status": "ready" if model_state["model"] is not None else "unavailable",
        "station_source": "air4thai",
        "station_model_loaded": station_bundle is not None,
        "station_model_count": len(station_bundle["models"]) if station_bundle else 0,
    }


@app.get("/api/v1/stations")
def stations(
    district: Optional[str] = Query(default=None),
    refresh: bool = Query(default=False),
):
    snapshot = require_snapshot(refresh)
    items = [
        station_output(s, snapshot["cache_stale"])
        for s in snapshot["stations"].values()
        if district is None or s["district"] == district
    ]
    items.sort(key=lambda s: (s["district"] or "", s["name"]))
    return {
        "source": snapshot["source"],
        "fetchedAt": snapshot["fetched_at"],
        "cacheStale": snapshot["cache_stale"],
        "count": len(items),
        "stations": items,
    }


@app.get("/api/v1/districts")
def districts(refresh: bool = Query(default=False)):
    snapshot = require_snapshot(refresh)
    grouped = {}
    for s in snapshot["stations"].values():
        if s["district"]:
            grouped[s["district"]] = grouped.get(s["district"], 0) + 1
    return {
        "districts": [
            {"name": name, "stationCount": count}
            for name, count in sorted(grouped.items())
        ],
        "source": snapshot["source"],
        "fetchedAt": snapshot["fetched_at"],
        "cacheStale": snapshot["cache_stale"],
    }


@app.get("/api/v1/stations/{station_id}")
def station_detail(station_id: str, refresh: bool = Query(default=False)):
    snapshot = require_snapshot(refresh)
    station = snapshot["stations"].get(station_id.lower())
    if station is None:
        raise HTTPException(status_code=404, detail="Station not found")
    return station_output(station, snapshot["cache_stale"])


@app.get("/api/v1/stations/{station_id}/weather")
def station_weather(station_id: str):
    station_id = station_id.lower()
    snapshot = require_snapshot()
    if station_id not in snapshot["stations"]:
        raise HTTPException(status_code=404, detail="Station not found")
    try:
        return {
            "stationId": station_id,
            "source": "open_meteo_weather_model",
            "weather": get_station_weather(station_id),
        }
    except Exception as exc:
        logger.exception("Weather fetch failed")
        raise HTTPException(status_code=502, detail="Weather source unavailable") from exc


def build_feature_dataframe(request):
    # Require actual inputs. Do not silently invent history or replace it with medians.
    values = request.model_dump()
    translated = {
        column: values[key]
        for key, column in FEATURE_MAPPING.items()
        if values.get(key) is not None
    }
    translated.update({key: value for key, value in values.items() if value is not None})
    missing = [c for c in model_state["features"] if c not in translated]
    if missing:
        raise ValueError("Missing model features: " + ", ".join(missing))
    if any(not math.isfinite(float(v)) for v in translated.values()):
        raise ValueError("Input values must be finite")
    return pd.DataFrame(
        [{c: float(translated[c]) for c in model_state["features"]}],
        columns=model_state["features"]
    )


@app.post("/predict")
def predict(request: PredictRequest):
    if model_state["model"] is None:
        raise HTTPException(status_code=503, detail="Prediction model is not loaded")
    try:
        frame = build_feature_dataframe(request)
        value = float(model_state["model"].predict(frame)[0])
        if not math.isfinite(value):
            raise ValueError("Model returned a non-finite prediction")
        return {
            "prediction": round(max(0.0, value), 4),
            "modelName": model_state["model_name"],
            "target": "next_day_daily_pm25",
            "inputSource": "caller_supplied_daily_features",
        }
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def require_admin_api(request: Request):
    expected = os.environ.get("SPU_ADMIN_API_KEY")
    supplied = request.headers.get("X-SPU-Admin-Key", "")
    if not expected or not compare_digest(supplied.encode(), expected.encode()):
        raise HTTPException(status_code=403, detail="Admin access required")


@app.get("/api/v1/stations/{station_id}/forecast/hourly")
def station_hourly_prediction(
    station_id: str, request: Request, shap_horizon: Optional[int] = Query(default=None, ge=1, le=6),
):
    if shap_horizon is not None:
        require_admin_api(request)
    return {
        "stationId": station_id.upper(),
        "hourlyForecast": hourly_forecast(station_id, datetime.now(BKK_TZ), shap_horizon=shap_horizon),
    }


@app.get("/api/v1/stations/{station_id}/forecast/hourly-comparison")
def station_hourly_comparison(station_id: str, horizon: int = Query(1, ge=1, le=6)):
    try:
        return compare_hourly_forecast(station_id, horizon, datetime.now(BKK_TZ))
    except (FileNotFoundError, ValueError) as exc:
        logger.warning("Hourly comparison model unavailable: %s", exc)
        raise HTTPException(status_code=503, detail="Hourly comparison unavailable") from exc


@app.get("/api/v1/stations/{station_id}/forecast/hourly-weather-experiment")
def hourly_weather_experiment(station_id: str, request: Request, horizon: int = Query(1, ge=1, le=6)):
    require_admin_api(request)
    try:
        return weather_explanation(station_id.strip(), horizon, datetime.now(BKK_TZ))
    except (OSError, ValueError) as exc:
        logger.warning("Experimental weather explanation unavailable: %s", exc)
        raise HTTPException(status_code=503, detail="Experimental weather model unavailable") from exc


@app.get("/api/v1/stations/{station_id}/forecast/hourly-issued")
def issued_hourly_comparison(station_id: str, request: Request, horizon: int = Query(1, ge=1, le=6)):
    require_admin_api(request)
    return compare_issued_hourly(station_id.strip().upper(), horizon, datetime.now(BKK_TZ))


@app.get("/api/v1/forecast")
def forecast_status(
    request: Request,
    station_id: Optional[str] = Query(default=None),
    district: Optional[str] = Query(default=None),
    horizon: str = Query(default="24h"),
    refresh: bool = Query(default=False),
    diagnostics: bool = False,
):
    if diagnostics:
        require_admin_api(request)
    if horizon not in {"24h", "1d", "tomorrow"}:
        raise HTTPException(status_code=422, detail="Only the next Bangkok calendar day is supported")
    snapshot = require_snapshot(refresh)
    candidates = list(snapshot["stations"].values())
    if station_id:
        candidates = [s for s in candidates if s["station_id"].lower() == station_id.lower()]
    if district:
        candidates = [s for s in candidates if s["district"] == district]
    if not candidates:
        raise HTTPException(status_code=404, detail="No matching station")
    now = datetime.now(BKK_TZ)
    issue_day = now.date()
    target = (issue_day + timedelta(days=1)).isoformat()
    histories = station_histories() if station_bundle else {}
    required_days = [issue_day - timedelta(days=n) for n in range(14, 0, -1)]
    results = []
    for station in candidates:
        sid = station["station_id"].upper()
        item = station_output(station, snapshot["cache_stale"])
        if station_bundle:
            history = histories.get(sid, {})
            item.update(forecast_station(
                sid, station_bundle["models"], history, issue_day
            ))
            missing = [day.isoformat() for day in required_days if day not in history]
            item["dailyCoverage"] = {
                "availableDays": len(required_days) - len(missing),
                "requiredDays": len(required_days),
                "missingDates": missing,
            }
            assignment = station_bundle["report"].get("stationAssignments", {}).get(sid, {})
            item["modelScope"] = assignment.get("modelScope")
            item["modelArea"] = assignment.get("area")
        else:
            item["reason"] = "station_model_bundle_unavailable"
        try:
            item["hourlyForecast"] = hourly_forecast(sid, now, diagnostics_only=diagnostics)
        except Exception:
            logger.exception("AirBKK hourly forecast unavailable")
            item["hourlyForecast"] = {"reason": "model_unavailable", "points": []}
        results.append(item)
    available = sum(item["forecastAvailable"] for item in results)
    return {
        "forecastAvailable": available > 0,
        "forecastCount": available,
        "reason": None if available else "no_station_forecast_available",
        "horizon": horizon,
        "issueDate": issue_day.isoformat(),
        "targetDate": target,
        "target": "next_day_daily_pm25",
        "timezone": "Asia/Bangkok",
        "unit": "ug/m3",
        "modelName": "Extra Trees" if station_bundle else None,
        "evaluationStatus": "retrospective_only" if station_bundle else None,
        "dataSource": "air4thai",
        "fetchedAt": snapshot["fetched_at"],
        "stations": results,
        "hourly": [],
        "weekly": [],
        "shap": [],
        "predictedPeak": None,
        "modelRMSE": None,
    }


@app.get("/api/v1/evaluation")
def evaluation(request: Request):
    require_admin_api(request)
    if station_bundle:
        return station_bundle["report"]
    raise HTTPException(
        status_code=404,
        detail="No verified station-specific evaluation report configured"
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
