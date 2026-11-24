"""Poll Air4Thai and import verified daily workbooks while the API runs."""
import logging
import os
from pathlib import Path
from threading import Event, Thread

from aqm_daily import run_daily_sync
from air4thai_daily import run_daily_report_sync
from live_data import CACHE_TTL_SECONDS, get_live_snapshot
from station_forecast import ROOT, import_workbooks, store_snapshot

logger = logging.getLogger(__name__)
INBOX = Path(os.environ.get("PM25_DAILY_INBOX", ROOT / "daily_inbox"))


def collect_continuously(stop):
    imported = {}
    while not stop.is_set():
        try:
            for path in sorted(INBOX.glob("*.xlsx")):
                if path.name.startswith("~$"):
                    continue
                try:
                    stat = path.stat()
                    signature = (stat.st_mtime_ns, stat.st_size)
                    if imported.get(path) != signature:
                        result = import_workbooks([path])
                        imported[path] = signature
                        logger.info("Imported %s: %s", path.name, result)
                except Exception:
                    logger.exception("Daily workbook import failed for %s", path.name)
        except OSError:
            logger.exception("Cannot read daily workbook folder %s", INBOX)

        delay = CACHE_TTL_SECONDS
        try:
            result = store_snapshot(get_live_snapshot(force_refresh=True))
            logger.info("Air4Thai collection: %s", result)
        except ValueError as exc:
            logger.warning("Air4Thai collection skipped: %s", exc)
            delay = 60
        except Exception:
            logger.exception("Air4Thai collection failed")
            delay = 60
        stop.wait(delay)


def start_collector():
    stop = Event()
    thread = Thread(target=collect_continuously, args=(stop,), daemon=True)
    thread.start()
    if os.environ.get("PM25_AQMTHAI_DAILY") == "1":
        Thread(target=run_daily_sync, args=(stop,), daemon=True).start()
    if os.environ.get("PM25_AIR4THAI_DAILY") == "1":
        Thread(target=run_daily_report_sync, args=(stop,), daemon=True).start()
    return stop
