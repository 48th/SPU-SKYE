"""Collect the official, date-labelled Air4Thai 24-hour report for Bangkok BKP sites."""
import json
import logging
import math
import os
import re
import subprocess
from datetime import date, datetime, timedelta

from live_data import BKK_TZ, get_live_snapshot
from station_forecast import ROOT, database

logger = logging.getLogger(__name__)
SOURCE = "Air4Thai dated Avg 24Hr https://air4thai.pcd.go.th/webV3/#/StationDetail"
MONTHS = ("มค", "กพ", "มีค", "เมย", "พค", "มิย", "กค", "สค", "กย", "ตค", "พย", "ธค")


def save_daily_report(payload, stations, now):
    rows = []
    for sid in stations:
        for stamp, value in payload.get(sid, []):
            match = re.fullmatch(r"(\d{1,2})\s+([ก-๙.]+)\s+(\d{4})", stamp.strip())
            if not match or value.strip() in {"", "-", "–", "—"}:
                continue
            day, month, year = match.groups()
            month = month.replace(".", "")
            if month not in MONTHS:
                continue
            year = int(year)
            observed = date(year - 543 if year >= 2400 else year, MONTHS.index(month) + 1, int(day))
            value = float(value)
            if now.date() - timedelta(days=7) <= observed < now.date() and math.isfinite(value) and value >= 0:
                rows.append((sid.upper(), observed.isoformat(), value, now.isoformat(), SOURCE))

    with database() as conn:
        result = conn.executemany("INSERT OR IGNORE INTO station_daily VALUES (?, ?, ?, ?, ?)", rows)
        return {"stations": len({row[0] for row in rows}), "eligible": len(rows), "inserted": result.rowcount}


def sync_daily_report():
    snapshot = get_live_snapshot()
    if not snapshot:
        raise RuntimeError("Bangkok station roster unavailable")
    stations = sorted(sid for sid in snapshot["stations"] if re.fullmatch(r"bkp\d+t?", sid))
    if not stations:
        raise RuntimeError("No Bangkok BKP stations found")
    result = subprocess.run(
        [os.getenv("PM25_NODE", "node"), str(ROOT / "air4thai_daily.cjs"), *stations],
        capture_output=True, encoding="utf-8", timeout=420,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if result.returncode or not result.stdout:
        raise RuntimeError(result.stderr.strip()[-1500:])
    if result.stderr:
        logger.warning("Some Air4Thai stations could not be read: %s", result.stderr.strip()[-1200:])
    return save_daily_report(json.loads(result.stdout), stations, datetime.now(BKK_TZ))


def run_daily_report_sync(stop):
    while not stop.is_set():
        try:
            logger.info("Air4Thai daily report sync: %s", sync_daily_report())
        except Exception:
            logger.exception("Air4Thai daily report sync failed; will retry")
        stop.wait(6 * 3600)


if __name__ == "__main__":
    print(json.dumps(sync_daily_report()))
