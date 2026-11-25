"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Heart, NavigationArrow } from "@phosphor-icons/react";
import { useStationFavorites } from "@/lib/stationFavorites";
import { AirQualityExpression } from "@/components/CivicIllustrationAssets";
import { formatObservedAt, formatReading, getThaiAqiMeta } from "@/lib/forecastService";

type Station = { stationId: string; name: string; district?: string; lat: number; lon: number; currentPM25: number | null; observedAt?: string; isStale?: boolean };
type Reading = { observedAt: string; pm25: number };
type Hourly = {
  source?: string; observedAt?: string; reason?: string; missingHours?: string[]; experimental?: boolean;
  latestObservation?: Reading;
  points: { hoursAhead: number; targetAt: string; predictedPM25: number }[];
};
type Daily = { targetDate: string; stations: { forecastAvailable: boolean; predictedPM25?: number; dailyCoverage?: { availableDays: number; requiredDays: number } }[] };
type DailyReading = { date: string; pm25: number | null; source?: string; derivedFromHourly?: boolean; hoursAvailable?: number };
type StationDetail = { id: string; hourly?: Hourly | null; daily?: Daily | null; history?: DailyReading[] | null };

type HourlyComparison = {
  source: string;
  sampleCount: number;
  mae: number | null;
  points: { targetAt: string; actual: number | null; predicted: number | null }[];
};

const api = (process.env.NEXT_PUBLIC_STATION_API_URL || "http://127.0.0.1:8001").replace(/\/+$/, "");
const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const day = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short" });
const dateLabel = (value: string) => day.format(new Date(value + "T00:00:00+07:00"));
const hourlyReasons: Record<string, string> = {
  missing_hourly_observations: "ข้อมูลรายชั่วโมงที่โมเดลใช้ยังไม่ครบ",
  no_observations: "ยังไม่มีค่าตรวจวัดรายชั่วโมง",
  stale_observations: "ค่าตรวจวัดรายชั่วโมงล่าสุดเก่าเกินไปสำหรับรอบนี้",
  model_unavailable: "โมเดลรายชั่วโมงยังไม่พร้อม",
  station_not_supported: "สถานีนี้ยังไม่มีแหล่งข้อมูลรายชั่วโมงที่รองรับ",
};
const pageBackgrounds = {
  "Very Good": ["#BFE5F5", "#EAF7FB"],
  Good: ["#BDEACC", "#F0FDE9"],
  Moderate: ["#FAECA5", "#FEFCE1"],
  "Unhealthy for Sensitive": ["#F8D2B8", "#FFF3E1"],
  Unhealthy: ["#F3BFC8", "#FDE6E7"],
} as const;

const panel = "rounded-3xl border border-white/80 bg-white/75 shadow-sm backdrop-blur-sm";

async function read<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(api + path, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), cache: "no-store" });
  if (!response.ok) throw new Error("Station API unavailable");
  return response.json();
}

export default function PM25ForecastPage() {
  const [stations, setStations] = useState<Station[]>([]);
  const [id, setId] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [detail, setDetail] = useState<StationDetail>();
  const [horizon, setHorizon] = useState(1);
  const [comparison, setComparison] = useState<{ id: string; horizon: number; revision: number; result: HourlyComparison | null }>();
  const [revision, setRevision] = useState(0);
  const { ids: favorites, toggle: toggleFavorite } = useStationFavorites();
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [locationStatus, setLocationStatus] = useState("");
  const [locating, setLocating] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!locationStatus) return;
    const timer = window.setTimeout(() => setLocationStatus(""), 6500);
    return () => window.clearTimeout(timer);
  }, [locationStatus]);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const initial = new URLSearchParams(window.location.search).get("station_id")?.toLowerCase();
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const result = await read<{ stations: Station[] }>("/api/v1/stations", controller.signal);
        if (controller.signal.aborted) return;
        setStations(result.stations);
        setId(current => result.stations.find(s => s.stationId.toLowerCase() === (current || initial || "bkp102t").toLowerCase())?.stationId ?? result.stations[0]?.stationId ?? "");
        setStatus("ready");
      } catch {
        if (!controller.signal.aborted) setStatus("failed");
      } finally { pending = false; }
    }
    void refresh();
    const timer = window.setInterval(refresh, 60000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [revision]);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    let pending = false;
    const stationPath = "/api/v1/stations/" + encodeURIComponent(id);
    function update(change: Partial<StationDetail>) {
      if (!controller.signal.aborted) setDetail(current => ({
        ...(current?.id === id ? current : { id }),
        ...change,
      }));
    }
    async function refresh() {
      if (pending) return;
      pending = true;
      await Promise.all([
        read<{ hourlyForecast: Hourly }>(stationPath + "/forecast/hourly", controller.signal)
          .then(result => update({ hourly: result.hourlyForecast })).catch(() => update({ hourly: null })),
        read<Daily>("/api/v1/forecast?diagnostics=true&station_id=" + encodeURIComponent(id), controller.signal)
          .then(daily => update({ daily })).catch(() => update({ daily: null })),
        read<{ points: DailyReading[] }>(stationPath + "/history/daily?include_hourly=true", controller.signal)
          .then(result => update({ history: result.points })).catch(() => update({ history: null })),
      ]);
      pending = false;
    }
    void refresh();
    const timer = window.setInterval(refresh, 60000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [id, revision]);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    const path = "/api/v1/stations/" + encodeURIComponent(id) + "/forecast/hourly-comparison?horizon=" + horizon;
    void read<HourlyComparison>(path, controller.signal)
      .then(result => {
        if (!controller.signal.aborted) setComparison({ id, horizon, revision, result });
      })
      .catch(() => {
        if (!controller.signal.aborted) setComparison({ id, horizon, revision, result: null });
      });
    return () => controller.abort();
  }, [id, horizon, revision]);

  const station = stations.find(s => s.stationId === id);
  const favoriteStations = stations.filter(s => favorites.includes(s.stationId.toLowerCase()));
  const browsing = favoritesOnly ? favoriteStations : stations;
  const stationIndex = browsing.findIndex(s => s.stationId === id);
  const isFavorite = favorites.includes(id.toLowerCase());

  function step(direction: number) {
    if (browsing.length < 2) return;
    const next = stationIndex < 0 ? 0 : (stationIndex + direction + browsing.length) % browsing.length;
    setId(browsing[next].stationId);
  }

  function locate() {
    if (!navigator.geolocation) {
      setLocationStatus("เบราว์เซอร์นี้เปิดตำแหน่งไม่ได้ เลือกสถานีจากรายการได้ครับ");
      return;
    }
    setLocating(true);
    setLocationStatus("");
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      let nearest: Station | undefined;
      let closest = Infinity;
      const radians = Math.PI / 180;
      for (const candidate of stations) {
        if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lon)) continue;
        const lat = (candidate.lat - coords.latitude) * radians;
        const lon = (candidate.lon - coords.longitude) * radians;
        const a = Math.sin(lat / 2) ** 2 + Math.cos(coords.latitude * radians) *
          Math.cos(candidate.lat * radians) * Math.sin(lon / 2) ** 2;
        const distance = 12742 * Math.asin(Math.sqrt(Math.min(1, a)));
        if (distance < closest) { nearest = candidate; closest = distance; }
      }
      if (nearest) {
        setFavoritesOnly(false);
        setId(nearest.stationId);
        setLocationStatus("สถานีใกล้ที่สุด · " + closest.toFixed(1) + " กม. ตามเส้นตรง");
      } else {
        setLocationStatus("ยังไม่มีพิกัดสถานีให้เปรียบเทียบ");
      }
      setLocating(false);
    }, () => {
      setLocationStatus("อ่านตำแหน่งไม่ได้ ตรวจสิทธิ์ตำแหน่งหรือเลือกสถานีจากรายการ");
      setLocating(false);
    }, { timeout: 10000, maximumAge: 60000 });
  }

  const selected = detail?.id === id ? detail : undefined;
  const hourly = selected?.hourly;
  const modelBase = hourly?.latestObservation;
  const comparisonResult = comparison?.id === id && comparison.horizon === horizon && comparison.revision === revision
    ? comparison.result : undefined;
  const matchedPoints = comparisonResult?.points.flatMap(point =>
    point.actual == null || point.predicted == null ? [] : [{
      targetAt: point.targetAt,
      actual: point.actual,
      predicted: point.predicted,
    }]
  ).slice(-6).reverse();
  const fallback = station?.currentPM25 == null ? hourly?.latestObservation : undefined;
  const current = station?.currentPM25 ?? fallback?.pm25;
  const level = getThaiAqiMeta(current ?? NaN);
  const [backgroundTop, backgroundBottom] = current == null || !Number.isFinite(current)
    ? ["#E8EEF0", "#F7F9FA"] : pageBackgrounds[level.tier];
  const currentTime = fallback?.observedAt ?? station?.observedAt;
  const tomorrow = selected?.daily?.stations[0];
  const forecastValue = tomorrow?.forecastAvailable ? tomorrow.predictedPM25 : undefined;
  const dailyRows = [...(selected?.history ?? [])].reverse();
  const historyMax = Math.max(1, ...dailyRows.map(row => row.pm25 ?? 0));

  return (
    <main id="main-content" lang="th" className="bangkok-ui-font min-h-screen bg-neutral-100 px-4 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] pt-4 sm:pb-10 text-slate-900 sm:px-8 sm:pt-7"
      style={{ backgroundImage: "linear-gradient(180deg, " + backgroundTop + " 30%, " + backgroundBottom + " 100%)" }}>
      <div className="mx-auto max-w-4xl space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <Link href="/map" className="hidden sm:inline-flex min-h-11 items-center rounded-full border border-white bg-white/80 px-4 text-sm font-semibold shadow-sm">← แผนที่คุณภาพอากาศ</Link>
          <span className="text-sm font-bold tracking-wide text-slate-700">SPU SKYE</span>
        </header>

        <section className={panel + " px-4 py-5 sm:px-7 sm:py-7"}>
          <div className="flex items-center gap-2">
            <label htmlFor="forecast-station" className="sr-only">เลือกสถานีตรวจวัด</label>
            <select id="forecast-station" value={id} disabled={!stations.length} onChange={event => setId(event.target.value)}
              className="min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold focus-visible:outline-emerald-700 sm:max-w-xs">
              {!stations.length && <option value="">เลือกสถานีตรวจวัด</option>}
              {stations.map(item => <option key={item.stationId} value={item.stationId}>{item.name} ({item.stationId.toUpperCase()})</option>)}
            </select>
            <button type="button" onClick={() => setRevision(value => value + 1)}
              className="min-h-11 shrink-0 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold focus-visible:outline-emerald-700">รีเฟรช</button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" aria-pressed={favoritesOnly}
              disabled={!favoriteStations.length && !favoritesOnly}
              onClick={() => {
                if (!favoritesOnly && !isFavorite && favoriteStations[0]) setId(favoriteStations[0].stationId);
                setFavoritesOnly(!favoritesOnly);
              }}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold aria-pressed:bg-slate-900 aria-pressed:text-white disabled:opacity-50">
              <Heart size={17} aria-hidden="true" /> สถานีโปรด {favorites.length}
            </button>
            <button type="button" disabled={locating || !stations.length} onClick={locate}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold disabled:opacity-50">
              <NavigationArrow size={17} weight="fill" aria-hidden="true" /> {locating ? "กำลังหาตำแหน่ง…" : "ใกล้ฉัน"}
            </button>
          </div>
          {locationStatus && <p role="status" className="mt-2 text-xs text-slate-700">{locationStatus}</p>}

          <div className="mt-6 grid touch-pan-y gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
            onTouchStart={event => {
              const touch = event.touches[0];
              touchStart.current = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
            }}
            onTouchCancel={() => { touchStart.current = null; }}
            onTouchEnd={event => {
              const start = touchStart.current;
              touchStart.current = null;
              if (!start || event.touches.length) return;
              const touch = event.changedTouches[0];
              const x = touch.clientX - start.x;
              const y = touch.clientY - start.y;
              if (Math.abs(x) > 45 && Math.abs(x) > Math.abs(y) * 1.5) step(x < 0 ? 1 : -1);
            }}>
            <div>
              <h1 className="text-xl font-bold sm:text-3xl">{station?.name ?? "พยากรณ์ฝุ่นกรุงเทพฯ"}</h1>
              {station && <p className="mt-1 text-sm text-slate-600">{station.district && ("เขต" + station.district + " · ")}{station.stationId.toUpperCase()}</p>}
              <p className="mt-4 text-sm font-semibold text-slate-700">PM2.5 ที่สถานีรายงานล่าสุด</p>
              {current == null ? <p className="mt-2 text-xl font-bold">ยังไม่มีค่าตรวจวัด</p> : (
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-5xl font-bold tracking-tight tabular-nums sm:text-6xl">{formatReading(current)}</span>
                  <span className="font-medium text-slate-700">µg/m³</span>
                </div>
              )}
            </div>
            {current != null && <div className="flex items-center gap-3">
              <AirQualityExpression pm25={current} className="h-12 w-12 sm:h-14 sm:w-14" />
              <div>
                <p className="text-sm font-bold">{level.thaiLabel}</p>
                <p className="text-xs text-slate-600">{fallback ? hourly?.source : "Air4Thai"}{currentTime && (" · " + formatObservedAt(currentTime))}</p>
              </div>
            </div>}
          </div>
          {station && <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-200/70 pt-3">
            <span className="text-xs tabular-nums text-slate-700">{stationIndex < 0 ? "—" : stationIndex + 1} / {browsing.length}</span>
            <button type="button" aria-pressed={isFavorite} aria-label={isFavorite ? "ยกเลิกสถานีโปรด" : "เพิ่มสถานีโปรด"}
              onClick={() => {
                toggleFavorite(id);
                if (favoritesOnly && isFavorite) {
                  const remaining = favoriteStations.find(item => item.stationId !== id);
                  if (remaining) setId(remaining.stationId);
                  else setFavoritesOnly(false);
                }
              }}
              className="grid h-11 w-11 place-items-center rounded-full border border-slate-200 bg-white text-rose-700">
              <Heart size={22} weight={isFavorite ? "fill" : "regular"} aria-hidden="true" />
            </button>
          </div>}
          {station?.isStale && !fallback && current != null && <p className="mt-3 text-xs text-amber-800">ข้อมูลรอบล่าสุดเก่า โปรดดูเวลาวัด</p>}
          {status !== "ready" && <p role="status" className="mt-3 text-sm text-slate-700">{status === "loading" ? "กำลังโหลดรายชื่อสถานี" : stations.length ? "อัปเดตข้อมูลไม่ได้ กำลังแสดงรอบล่าสุด" : "เชื่อมต่อข้อมูลไม่ได้ ลองกดรีเฟรช"}</p>}
        </section>

        {station && <>
          <section className={panel + " p-4 sm:p-6"} aria-labelledby="pm25-hourly">
            <h2 id="pm25-hourly" className="text-lg font-bold">พยากรณ์ 1–6 ชั่วโมง</h2>
            <p className="mt-1 text-xs text-slate-600">PM2.5 (µg/m³){hourly?.observedAt && (" · " + hourly.source + " · ฐานเวลา " + formatObservedAt(hourly.observedAt))}{hourly?.points.length ? " · Extra Trees" : ""}{hourly?.experimental && hourly.points.length ? " · ผลทดลอง" : ""}</p>
            {modelBase && !!hourly?.points.length && (
              <p className="mt-2 text-sm font-medium text-slate-700">
                ค่าฝุ่นรายชั่วโมงที่โมเดลใช้เป็นฐาน {formatReading(modelBase.pm25)} µg/m³
              </p>
            )}
            {hourly?.points.length ? (
              <div tabIndex={0} role="region" aria-label="พยากรณ์รายชั่วโมง เลื่อนแนวนอนได้" className="mt-3 overflow-x-auto rounded-2xl bg-slate-100/80 [scrollbar-width:thin] focus-visible:outline-emerald-700">
                <ol className="flex w-max min-w-full divide-x divide-slate-200 px-1 py-3">
                  {[...hourly.points].sort((a, b) => a.hoursAhead - b.hoursAhead).map(point => (
                    <li key={point.hoursAhead} className="grid min-w-[4.6rem] flex-1 justify-items-center gap-2 px-2">
                      <time dateTime={point.targetAt} title={formatObservedAt(point.targetAt)} className="text-xs font-semibold tabular-nums">{clock.format(new Date(point.targetAt))}</time>
                      <AirQualityExpression pm25={point.predictedPM25} />
                      <span className="text-lg font-bold tabular-nums">{formatReading(point.predictedPM25)}</span>
                      <span className="sr-only">{getThaiAqiMeta(point.predictedPM25).thaiLabel}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : <p role="status" className="mt-3 text-sm text-slate-700">
              {hourly === null ? "เชื่อมต่อบริการพยากรณ์รายชั่วโมงไม่ได้" : hourly ? hourlyReasons[hourly.reason ?? ""] ?? "ยังไม่มีพยากรณ์รายชั่วโมง" : "กำลังโหลดพยากรณ์รายชั่วโมง"}
            </p>}
            {!!hourly?.missingHours?.length && <p className="mt-2 text-xs text-slate-600">ชั่วโมงที่ขาด {hourly.missingHours.map(formatObservedAt).join(" · ")}</p>}
          </section>
          <section className={panel + " p-4 sm:p-6"} aria-labelledby="pm25-hourly-comparison">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="pm25-hourly-comparison" className="text-lg font-bold">เทียบพยากรณ์ย้อนหลังกับค่าจริง</h2>
              <select aria-label="ระยะพยากรณ์" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" value={horizon} onChange={event => setHorizon(Number(event.target.value))}>
                {[1, 2, 3, 4, 5, 6].map(hour => <option key={hour} value={hour}>ล่วงหน้า {hour} ชม.</option>)}
              </select>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              คำนวณพยากรณ์ย้อนหลังด้วยโมเดลปัจจุบัน เทียบค่าตรวจวัดสถานีเดียวกัน{comparisonResult?.source && (" จาก " + comparisonResult.source)}
            </p>
            {matchedPoints?.length ? (
              <>
                <p className="mt-2 text-sm text-slate-600">
                  แสดง {matchedPoints.length} คู่ล่าสุด · คลาดเคลื่อนเฉลี่ย {comparisonResult?.mae?.toFixed(2)} µg/m³ จาก {comparisonResult?.sampleCount} คู่
                </p>
                <table className="mt-3 w-full text-sm tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-200 text-left">
                      <th scope="col" className="py-2">เวลาวัด</th>
                      <th scope="col" className="py-2 text-right">พยากรณ์</th>
                      <th scope="col" className="py-2 text-right">ค่าจริง</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matchedPoints.map(point => (
                      <tr key={point.targetAt} className="border-b border-slate-200 last:border-0">
                        <td className="py-2">{formatObservedAt(point.targetAt)}</td>
                        <td className="text-right">{point.predicted.toFixed(1)}</td>
                        <td className="text-right">{point.actual.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <p className="mt-3 text-sm text-slate-600">
                {comparisonResult === undefined ? "กำลังโหลดผลเทียบ" : comparisonResult === null ? "โหลดผลเทียบไม่ได้" : "ยังไม่มีคู่พยากรณ์กับค่าจริงสำหรับช่วงที่เลือก"}
              </p>
            )}
          </section>

          <section className={panel + " p-4 sm:p-6"}>
            <h2 className="text-lg font-bold">พยากรณ์ค่าเฉลี่ยวันพรุ่งนี้</h2>
            {forecastValue != null ? (
              <div className="mt-3 flex items-center gap-3">
                <AirQualityExpression pm25={forecastValue} />
                <p className="text-2xl font-bold tabular-nums">{formatReading(forecastValue)} <span className="text-sm font-medium">µg/m³</span></p>
              </div>
            ) : <p role="status" className="mt-2 text-sm text-slate-700">{selected?.daily === null ? "เชื่อมต่อพยากรณ์รายวันไม่ได้" : selected?.daily ? "ยังไม่มีพยากรณ์ค่าเฉลี่ยวันพรุ่งนี้" : "กำลังโหลดพยากรณ์รายวัน"}</p>}
            {selected?.daily && <p className="mt-2 text-xs text-slate-600">{dateLabel(selected.daily.targetDate)}{forecastValue != null ? " · Extra Trees" : tomorrow?.dailyCoverage ? " · มีประวัติ " + tomorrow.dailyCoverage.availableDays + "/" + tomorrow.dailyCoverage.requiredDays + " วัน" : ""}</p>}
          </section>

          <section className={panel + " p-4 sm:p-6"} aria-labelledby="pm25-history">
            <h2 id="pm25-history" className="text-lg font-bold">ค่าตรวจวัดเฉลี่ยย้อนหลัง 7 วัน</h2>
            {dailyRows.length ? <ul className="mt-2 divide-y divide-slate-200">
              {dailyRows.map(row => <li key={row.date} className="grid grid-cols-[4.1rem_minmax(0,1fr)_6rem] items-center gap-2 py-2.5 text-sm">
                <time dateTime={row.date} className="font-medium">{dateLabel(row.date)}</time>
                <span className="h-2 rounded-full bg-slate-200" aria-hidden="true">
                  {row.pm25 != null && <span className="block h-full rounded-full" style={{ width: Math.max(2, row.pm25 / historyMax * 100) + "%", backgroundColor: getThaiAqiMeta(row.pm25).color }} />}
                </span>
                <span className="text-right text-xs font-semibold tabular-nums">{row.pm25 == null ? "ไม่มีข้อมูล" : formatReading(row.pm25) + " µg/m³"}{row.derivedFromHourly && <span className="block font-normal text-slate-500">เฉลี่ย 24 ชม.</span>}{row.pm25 == null && row.hoursAvailable != null && <span className="block font-normal text-slate-500">{row.hoursAvailable}/24 ชม.</span>}</span>
              </li>)}
            </ul> : <p role="status" className="mt-2 text-sm text-slate-700">{selected?.history === null ? "โหลดประวัติไม่ได้" : selected?.history ? "ยังไม่มีประวัติรายวัน" : "กำลังโหลดข้อมูลย้อนหลัง"}</p>}
          </section>
        </>}
      </div>
    </main>
  );
}
