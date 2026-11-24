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
SOURCE = "https://aqmthai.pcd.go.th/main/index.html · 1BKK1002"


def import_table(raw_rows, start, end, now):
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
        rows[observed_day] = ("02T", observed_day.isoformat(), value, now.isoformat(), SOURCE)
    if not rows:
        return {"eligible": 0, "inserted": 0}
    return store_daily_rows(list(rows.values()))


def sync_daily():
    now = datetime.now(BKK_TZ)
    history = station_histories().get("02T", {})
    end = now.date() - timedelta(days=1)
    missing = [end - timedelta(days=n) for n in range(14) if end - timedelta(days=n) not in history]
    if not missing:
        return {"eligible": 0, "inserted": 0}
    start = min(missing)
    result = subprocess.run(
        [os.getenv("PM25_NODE", "node"), str(ROOT / "aqm_daily.cjs"), start.isoformat(), end.isoformat()],
        check=False, capture_output=True, encoding="utf-8", timeout=90,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip()[-1200:])
    rows = json.loads(result.stdout)
    # AQMThai can revise earlier values. Retain existing records and import gaps only.
    missing_labels = {day.strftime("%d/%m/") + str(day.year + 543) for day in missing}
    return import_table([row for row in rows if row[0] in missing_labels], start, end, now)


def run_daily_sync(stop):
    while not stop.is_set():
        try:
            logger.info("AQMThai daily sync (02T): %s", sync_daily())
        except Exception as exc:
            logger.warning("AQMThai daily sync will retry: %s", exc)
        stop.wait(3600)


if __name__ == "__main__":
    print(json.dumps(sync_daily()))
