"use client";
import React, { useEffect, useRef, useState } from "react";
import { X, ArrowClockwise } from "@phosphor-icons/react";
import { getThaiAqiMeta, formatReading, formatObservedAt, type DistrictStation, type ForecastHorizon, type ForecastResponse, type FetchStatus } from "@/lib/forecastService";
export type DrawerSection = "all" | "hourly" | "shap";
interface Props {
 isOpen: boolean; station: DistrictStation | null; lang: "TH" | "EN";
 horizon: ForecastHorizon; focusSection: DrawerSection; status: FetchStatus;
 data: ForecastResponse | null; error: string | null; onClose: () => void;
 onHorizonChange: (h: ForecastHorizon) => void; onRefresh: () => void;
 onLoadFallback: () => void;
}
const stationApi = (process.env.NEXT_PUBLIC_STATION_API_URL || "http://127.0.0.1:8001").replace(/\/+$/, "");
type HourlyForecast = {
  observedAt?: string;
  source?: string;
  experimental?: boolean;
  reason?: string;
  latestObservation?: { observedAt: string; pm25: number };
  missingHours?: string[];
  points: { hoursAhead: number; targetAt: string; predictedPM25: number }[];
};
const forecastClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const hourlyReasons: Record<string, [string, string]> = {
  no_observations: ["รอค่าตรวจวัดรายชั่วโมง", "Waiting for hourly observations"],
  stale_observations: ["ค่าตรวจวัดล่าสุดเก่าเกินไป", "Latest observations are too old"],
  missing_hourly_observations: ["ค่าตรวจวัดที่โมเดลต้องใช้ยังไม่ครบ", "Required hourly observations are missing"],
  station_not_supported: ["สถานีนี้ยังไม่รองรับพยากรณ์รายชั่วโมง", "Hourly forecasts are unavailable for this station"],
  model_unavailable: ["โมเดลรายชั่วโมงยังไม่พร้อม", "Hourly model is unavailable"],
};
export default function DistrictAnalyticsDrawer({isOpen,station,lang,focusSection,data,onClose,onRefresh}: Props) {
 const closeRef = useRef<HTMLButtonElement>(null);
 const forecastRef = useRef<HTMLElement>(null);
 const [revision, setRevision] = useState(0);
 const [result, setResult] = useState<{ id: string; forecast?: HourlyForecast; failed?: boolean }>();
 const stationId = isOpen ? station?.id : undefined;
 const hourly = result?.id === stationId ? result : undefined;

 useEffect(() => {
   if (!stationId) return;
   const controller = new AbortController();
   let pending = false;
   async function refresh() {
     if (pending) return;
     pending = true;
     try {
       const reply = await fetch(stationApi + "/api/v1/stations/" + encodeURIComponent(stationId!) + "/forecast/hourly", {
         cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
       });
       if (!reply.ok) throw new Error("Station forecast unavailable");
       const payload: { stationId: string; hourlyForecast: HourlyForecast } = await reply.json();
       if (payload.stationId.toLowerCase() !== stationId!.toLowerCase()) throw new Error("Unexpected station");
       if (!controller.signal.aborted) setResult({ id: stationId!, forecast: payload.hourlyForecast });
     } catch {
       if (!controller.signal.aborted) setResult({ id: stationId!, failed: true });
     } finally {
       pending = false;
     }
   }
   void refresh();
   const timer = window.setInterval(refresh, 60000);
   return () => { controller.abort(); window.clearInterval(timer); };
 }, [stationId, revision]);

 useEffect(() => {
   if (isOpen && focusSection === "hourly") forecastRef.current?.scrollIntoView({ block: "start" });
 }, [isOpen, focusSection]);

 useEffect(() => {
   if (!isOpen) return;
   const previous = document.activeElement as HTMLElement | null;
   const overflow = document.body.style.overflow;
   document.body.style.overflow = "hidden";
   closeRef.current?.focus();
   const keydown = (event: KeyboardEvent) => {
     if (event.key === "Escape") onClose();
     if (event.key === "Tab") {
       const buttons = closeRef.current?.closest("aside")?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
       if (!buttons?.length) return;
       const first = buttons[0], last = buttons[buttons.length - 1];
       if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
       else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
     }
   };
   window.addEventListener("keydown", keydown);
   return () => {window.removeEventListener("keydown",keydown); document.body.style.overflow=overflow; previous?.focus();};
 }, [isOpen,onClose]);
 if (!isOpen || !station?.id) return null;
 const th = lang === "TH";
 const hasFeedReading = Number.isFinite(station.currentPM25);
 const fallback = hasFeedReading ? undefined : hourly?.forecast?.latestObservation;
 const reading = fallback?.pm25 ?? station.currentPM25;
 const observedAt = fallback?.observedAt ?? station.observedAt;
 const missingHours = hourly?.forecast?.missingHours ?? [];
 const points = [...(hourly?.forecast?.points ?? [])].sort((a, b) => a.hoursAhead - b.hoursAhead);
 const axisMax = Math.ceil(Math.max(10, ...points.map(point => point.predictedPM25)) / 10) * 10;
 const chartPoints = points.map(point => ({
   point,
   x: 76 + (point.hoursAhead - 1) * 69,
   height: Math.max(0, point.predictedPM25) * 92 / axisMax,
   time: forecastClock.format(new Date(point.targetAt)),
   tier: getThaiAqiMeta(point.predictedPM25),
 }));
 return <div className="fixed inset-0 z-50 flex justify-end bg-neutral-950/25" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
  <aside role="dialog" aria-modal="true" aria-labelledby="station-detail-title" className="w-full max-w-2xl bg-white/60 bg-gradient-to-br from-white/95 via-neutral-50/85 to-neutral-200/85 sm:m-4 sm:rounded-[2rem] border border-white/80 flex flex-col overflow-y-auto text-neutral-900 shadow-2xl backdrop-blur-xl">
   <header className="sticky top-0 z-10 p-4 sm:p-5 bg-white/85 backdrop-blur-xl border-b border-neutral-300/60 flex items-start justify-between gap-3">
    <div><h2 id="station-detail-title" className="text-xl font-bold">{station.nameTh}</h2><p className="mt-1 text-sm text-neutral-600">{station.stationTh} · {station.id}</p></div>
    <button ref={closeRef} type="button" onClick={onClose} aria-label={th?"ปิด":"Close"} className="shrink-0 rounded-full border border-neutral-300/70 bg-white/60 p-2.5 hover:bg-white"><X size={22}/></button>
   </header>
   <div className="p-4 sm:p-5 flex flex-col gap-4">
    <section className="rounded-3xl border border-white/80 bg-white/60 px-4 py-4 sm:px-5 shadow-sm">
     <p className="text-sm font-medium text-neutral-700">{th?"ค่าฝุ่นล่าสุดที่สถานีรายงาน":"Latest station PM2.5"}</p>
     {Number.isFinite(reading) ? (
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
       <p className="text-4xl font-semibold tracking-tight tabular-nums">{formatReading(reading)} <span className="text-sm font-normal">µg/m³</span></p>
       <p className="text-sm text-neutral-600">{fallback ? hourly?.forecast?.source : "Air4Thai"} · {formatObservedAt(observedAt)}</p>
      </div>
     ) : <p className="mt-2 text-sm text-neutral-600">{th ? "ยังไม่มีค่าฝุ่นจากฟีดรอบล่าสุด" : "No PM2.5 reading in the latest feed"}</p>}
     {hasFeedReading && <p className="text-sm text-neutral-600 mt-2">{th?"ยังไม่ยืนยันรอบเวลาเฉลี่ยของค่าต้นทาง":"Source averaging period has not yet been verified."}</p>}
     {hasFeedReading && station.isStale && <p role="status" className="text-amber-800 mt-2">{th?"ข้อมูลเก่ากว่าเกณฑ์ โปรดตรวจเวลาวัด":"Reading is stale; check its observation time."}</p>}
    </section>
    <dl className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 rounded-3xl border border-white/80 bg-white/60 p-4 [&_dt]:text-xs [&_dt]:text-neutral-600 [&_dd]:font-semibold">
     <div><dt>{th?"เขต":"District"}</dt><dd>{station.district || "—"}</dd></div>
     <div><dt>{th?"พิกัด":"Coordinates"}</dt><dd>{station.lat.toFixed(5)}, {station.lon.toFixed(5)}</dd></div>
     <div><dt>{th?"อุณหภูมิ":"Temperature"}</dt><dd>{formatReading(station.temperatureC)} °C</dd></div>
     <div><dt>{th?"ความเร็วลม":"Wind speed"}</dt><dd>{formatReading(station.windSpeedMs)} m/s</dd></div>
    </dl>
    {station.weatherAt && <p className="text-sm text-neutral-600">
      {th ? "อุณหภูมิและความเร็วลมที่สถานีตรวจวัด" : "Station-measured temperature and wind speed"}
      {" · "}{station.weatherSource}{" · "}{formatObservedAt(station.weatherAt)}
    </p>}
    {data?.district === station.id && data.tomorrow && (
     <section className="rounded-3xl border border-white/80 bg-white/60 p-4 shadow-sm">
      <h3 className="font-bold">{th ? "พยากรณ์ค่าเฉลี่ยวันพรุ่งนี้" : "Tomorrow’s average PM2.5 forecast"}</h3>
      <p className="mt-1 text-2xl font-bold tabular-nums">{formatReading(data.tomorrow.pm25)} <span className="text-sm font-normal">µg/m³</span></p>
      <p className="mt-1 text-xs text-neutral-600">{data.tomorrow.date} · {data.modelName}</p>
     </section>
    )}
    <section ref={forecastRef} className="scroll-mt-24 rounded-3xl border border-white/80 bg-white/60 p-4 shadow-sm"
      aria-labelledby="drawer-hourly-title">
     <h3 id="drawer-hourly-title" className="font-bold">{th ? "พยากรณ์ PM2.5 ล่วงหน้า 6 ชั่วโมง" : "6-hour PM2.5 forecast"}</h3>
     {hourly?.forecast?.points.length ? (
       <>
        <p className="mt-1 text-xs text-neutral-600">
         {hourly.forecast.source} · {formatObservedAt(hourly.forecast.observedAt)} · Extra Trees
         {hourly.forecast.experimental && (th ? " · ผลทดลอง" : " · Experimental")}
        </p>
        <div aria-hidden="true" className="mt-4 rounded-2xl border border-neutral-300/60 bg-neutral-100/65 p-3">
         <svg viewBox="0 0 480 138" className="block w-full overflow-visible">
          {[16, 62, 108].map(y => <g key={y}><line x1="44" x2="462" y1={y} y2={y} stroke="#a3a3a370" strokeDasharray="3 5" /><text x="37" y={y + 5} textAnchor="end" fill="#525252" fontSize="16">{(108 - y) * axisMax / 92}</text></g>)}
          {chartPoints.map(({x, height, point, time, tier}) => <g key={point.hoursAhead}>
           <rect x={x - 21} y={108 - height} width="42" height={height} rx="5" fill={tier.color} />
           <text x={x} y={132} textAnchor="middle" fill="#262626" fontSize="16">{time}</text>
          </g>)}
         </svg>
        </div>
        <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
         {chartPoints.map(({point, time, tier}) => (
          <li key={point.hoursAhead} className="rounded-2xl border border-neutral-300/60 bg-white/70 p-3" style={{ borderTopColor: tier.color }}>
           <time dateTime={point.targetAt} title={formatObservedAt(point.targetAt)} className="text-sm font-semibold tabular-nums">{time}</time>
           <p className="text-lg font-bold tabular-nums">{formatReading(point.predictedPM25)} <span className="text-xs font-normal">µg/m³</span></p>
           <p className="text-xs text-neutral-600">{th ? tier.thaiLabel : tier.englishLabel}</p>
          </li>
         ))}
        </ol>
       </>
     ) : <p role="status" className="mt-2 text-sm text-neutral-600">
       {!hourly ? (th ? "กำลังโหลดพยากรณ์…" : "Loading forecast…")
         : hourly.failed ? (th ? "เชื่อมต่อบริการพยากรณ์ไม่ได้" : "Could not reach forecast service")
         : hourlyReasons[hourly.forecast?.reason ?? ""]?.[th ? 0 : 1] ??
           (th ? "ยังไม่มีพยากรณ์รายชั่วโมง" : "No hourly forecast available")}
     </p>}
     {missingHours.length > 0 && (
      <ul aria-label={th ? "ชั่วโมงที่ยังขาด" : "Missing observation hours"} className="mt-3 flex flex-wrap gap-2">
       {missingHours.map(stamp => (
        <li key={stamp} className="rounded-full bg-neutral-200/70 px-3 py-1 text-xs text-neutral-800">
         <time dateTime={stamp}>{formatObservedAt(stamp)}</time>
        </li>
       ))}
      </ul>
     )}
    </section>
    <button type="button" onClick={() => { onRefresh(); setRevision(value => value + 1); }} className="inline-flex items-center justify-center gap-2 p-3 rounded-2xl border border-white/80 bg-white/60 hover:bg-white"><ArrowClockwise size={18}/>{th?"รีเฟรชข้อมูลสถานี":"Refresh stations"}</button>
   </div>
  </aside>
 </div>;
}
