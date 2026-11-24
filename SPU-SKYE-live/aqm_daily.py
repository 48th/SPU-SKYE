"""Import finalized-by-date daily PM2.5 published in AQMThai's public table."""
import json
import logging
import math
import os
import re
import subprocess
from datetime import date, datetime, timedelta

from live_data import BKK_TZ
from station_forecast import ROOT, station_histories, store_daily_rows

logger = logging.getLogger(__name__)
SOURCE = "https://aqmthai.pcd.go.th/main/index.html"
# Match the Bangkok station locations in AQMThai with the Air4Thai/Excel locations.
STATIONS = {
    "02T": "1BKK1002", "03T": "1BKK1003", "05T": "1BKK1004",
    "10T": "1BKK1006", "12T": "1BKK1008", "50T": "1BKK1009",
    "52T": "1BKK1010", "53T": "1BKK1011", "54T": "1BKK1012",
    "59T": "1BKK1001", "61T": "1BKK1005",
}


def import_table(station, raw_rows, start, end, now):
    rows = {}
    for raw_day, raw_value in raw_rows:
        match = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", raw_day)
        if not match or raw_value in {"", "-", "–", "—"}:
            continue
        day, month, year = map(int, match.groups())
        observed_day = date(year - 543, month, day)
        value = float(raw_value)
        if not start <= observed_day <= end or observed_day >= now.date():
            raise ValueError(f"AQMThai returned a date outside the requested window: {observed_day}")
        if not math.isfinite(value) or value < 0 or observed_day in rows:
            raise ValueError(f"Invalid or duplicate AQMThai PM2.5 on {observed_day}")
        rows[observed_day] = (
            station, observed_day.isoformat(), value, now.isoformat(),
            f"{SOURCE} · {STATIONS[station]}",
        )
    if not rows:
        return {"eligible": 0, "inserted": 0}
    return store_daily_rows(list(rows.values()))


def sync_station(station, history, now):
    end = now.date() - timedelta(days=1)
    missing = [end - timedelta(days=n) for n in range(14) if end - timedelta(days=n) not in history]
    if not missing:
        return {"eligible": 0, "inserted": 0}
    start = min(missing)
    result = subprocess.run(
        [
            os.getenv("PM25_NODE", "node"), str(ROOT / "aqm_daily.cjs"),
            STATIONS[station], start.isoformat(), end.isoformat(),
        ],
        check=False, capture_output=True, encoding="utf-8", timeout=90,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip()[-1200:])
    rows = json.loads(result.stdout)
    # AQMThai can revise earlier values. Retain existing records and import gaps only.
    missing_labels = {day.strftime("%d/%m/") + str(day.year + 543) for day in missing}
    return import_table(
        station, [row for row in rows if row[0] in missing_labels], start, end, now
    )


def run_daily_sync(stop):
    while not stop.is_set():
        try:
            sync_daily(stop)
        except Exception:
            logger.exception("AQMThai daily sync will retry")
        stop.wait(3600)


def sync_daily(stop=None):
    now = datetime.now(BKK_TZ)
    histories = station_histories()
    results = {}
    for station in STATIONS:
        if stop is not None and stop.is_set():
            break
        try:
            result = sync_station(station, histories.get(station, {}), now)
            results[station] = result
            logger.info("AQMThai daily sync (%s): %s", station, result)
        except Exception as exc:
            results[station] = {"error": str(exc)}
            logger.warning("AQMThai daily sync (%s) will retry: %s", station, exc)
    return results


if __name__ == "__main__":
    print(json.dumps(sync_daily()))
