"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const origin = (process.env.NEXT_PUBLIC_STATION_API_URL || "http://127.0.0.1:8001").replace(/\/+$/, "");
const dateTime = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok",
});
const dateOnly = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium", timeZone: "Asia/Bangkok",
});
const number = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });
const formatDate = (day: string) => dateOnly.format(new Date(day + "T00:00:00+07:00"));
const formatValue = (value: number | null | undefined) =>
  value == null ? "ไม่มีข้อมูล" : number.format(value);

type HistoryPoint = { date: string; pm25: number | null; source: string | null };
type Hourly = {
  observedAt?: string;
  source?: string;
  reason?: string;
  experimental?: boolean;
  points: { hoursAhead: number; targetAt: string; predictedPM25: number }[];
};
type Station = {
  stationId: string;
  name: string;
  currentPM25: number | null;
  observedAt: string | null;
  forecastAvailable: boolean;
  predictedPM25?: number;
  dailyCoverage?: { availableDays: number; requiredDays: number };
  hourlyForecast?: Hourly;
};
type Forecast = { stations: Station[]; fetchedAt: string; targetDate: string };

async function get<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(origin + path, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6";
const hourlyReasons: Record<string, string> = {
  no_observations: "ยังไม่มีค่ารายชั่วโมงจากแหล่งข้อมูล",
  stale_observations: "ค่ารายชั่วโมงล่าสุดเก่าเกินไปสำหรับรอบนี้",
  missing_hourly_observations: "ข้อมูลรายชั่วโมงที่โมเดลใช้ยังไม่ครบ",
  station_not_supported: "สถานีนี้ยังไม่มีแหล่งข้อมูลรายชั่วโมงที่ยืนยันได้",
  model_unavailable: "โมเดลรายชั่วโมงไม่พร้อมใช้งาน",
};

export default function StationForecastPage() {
  const [id, setId] = useState("bkp102t");
  const [data, setData] = useState<Forecast>();
  const [forecastError, setForecastError] = useState(false);
  const [history, setHistory] = useState<{ id: string; points?: HistoryPoint[] }>();
  const station = data?.stations.find((item) => item.stationId === id);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const forecast = await get<Forecast>("/api/v1/forecast", controller.signal);
        if (controller.signal.aborted) return;
        setData(forecast);
        setForecastError(false);
        setId((selected) => forecast.stations.some((item) => item.stationId === selected)
          ? selected : forecast.stations[0]?.stationId ?? selected);
      } catch {
        if (!controller.signal.aborted) setForecastError(true);
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!station) return;
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const result = await get<{ points: HistoryPoint[] }>(
          "/api/v1/stations/" + encodeURIComponent(id) + "/history/daily", controller.signal,
        );
        if (!controller.signal.aborted) setHistory({ id, points: result.points });
      } catch {
        if (!controller.signal.aborted) setHistory({ id });
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [id, Boolean(station)]);

  const hours = station?.hourlyForecast;
  const daily = history?.id === id ? history : undefined;

  return (
    <main lang="th" className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:py-12">
      <div className="mx-auto max-w-5xl space-y-5">
        <Link href="/" className="inline-block text-sm font-semibold text-[#005A50] underline">
          ← กลับแดชบอร์ด
        </Link>
        <h1 className="text-3xl font-bold sm:text-4xl">PM2.5 กรุงเทพฯ รายสถานี</h1>
        <div className={card}>
          <label htmlFor="station-select" className="font-semibold">สถานีตรวจวัด</label>
          <select id="station-select" className="mt-2 w-full rounded-lg border border-slate-300 bg-white p-3"
            value={id} disabled={!data?.stations.length} onChange={(event) => setId(event.target.value)}>
            {!data?.stations.length && <option value={id}>กำลังรอรายชื่อสถานี</option>}
            {data?.stations.map((item) => (
              <option key={item.stationId} value={item.stationId}>
                {item.name} ({item.stationId.toUpperCase()})
              </option>
            ))}
          </select>
          <p role="status" className="mt-3 text-sm text-slate-600">
            {forecastError ? (data ? "เชื่อมต่อขัดข้อง กำลังแสดงข้อมูลจากรอบล่าสุด" : "เชื่อมต่อระบบข้อมูลสถานีไม่ได้")
              : data ? "Air4Thai รับข้อมูลล่าสุด " + dateTime.format(new Date(data.fetchedAt))
              : "กำลังโหลดข้อมูลสถานี"}
          </p>
        </div>

        {station && data && <>
          <div className="grid gap-4 sm:grid-cols-2">
            <section className={card}>
              <h2 className="font-semibold">ค่าล่าสุดจาก Air4Thai</h2>
              <p className="my-2 text-3xl font-bold text-[#005A50]">
                {formatValue(station.currentPM25)}{station.currentPM25 != null && " µg/m³"}
              </p>
              <p className="text-sm text-slate-600">{station.observedAt && dateTime.format(new Date(station.observedAt))}</p>
            </section>
            <section className={card}>
              <h2 className="font-semibold">พยากรณ์ค่าเฉลี่ยวันพรุ่งนี้</h2>
              <p className="my-2 text-3xl font-bold text-[#005A50]">
                {station.forecastAvailable ? formatValue(station.predictedPM25) + " µg/m³" : "ยังไม่มีพยากรณ์"}
              </p>
              <p className="text-sm text-slate-600">{formatDate(data.targetDate)}
                {station.forecastAvailable ? " · Extra Trees" : station.dailyCoverage &&
                  ` · มีข้อมูล ${station.dailyCoverage.availableDays} จาก ${station.dailyCoverage.requiredDays} วัน`}
              </p>
            </section>
          </div>

          <section className={card}>
            <h2 className="text-xl font-bold">พยากรณ์ล่วงหน้า 6 ชั่วโมง</h2>
            <p className="mt-2 text-sm text-slate-600">
              {hours?.observedAt && `ข้อมูล ${hours.source} เวลา ${dateTime.format(new Date(hours.observedAt))} · `}
              {hours?.reason ? hourlyReasons[hours.reason] ?? "ยังไม่มีพยากรณ์"
                : hours?.points.length ? hours.experimental ? "Extra Trees รุ่นทดลองจากจอมทอง" : "Extra Trees"
                : "API ยังไม่มีผลพยากรณ์รายชั่วโมง"}
            </p>
            {!!hours?.points.length && (
              <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {hours.points.map((point) => (
                  <li key={point.hoursAhead} className="rounded-xl bg-emerald-50 p-3">
                    <span className="text-sm font-semibold">+{point.hoursAhead} ชม.</span>
                    <p className="my-1 text-lg font-bold">{formatValue(point.predictedPM25)} µg/m³</p>
                    <time dateTime={point.targetAt} className="text-xs text-slate-600">
                      {dateTime.format(new Date(point.targetAt))}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className={card}>
            <h2 className="text-xl font-bold">ค่าเฉลี่ย PM2.5 ย้อนหลัง 7 วัน</h2>
            {!daily?.points ? <p role="status" className="mt-3 text-sm text-slate-600">
              {daily ? "อ่านข้อมูลย้อนหลังไม่ได้ ระบบจะลองใหม่อัตโนมัติ" : "กำลังอ่านข้อมูลย้อนหลัง"}
            </p> : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr className="border-b border-slate-300">
                    <th scope="col" className="py-2 pr-4">วันที่</th>
                    <th scope="col" className="py-2 pr-4">PM2.5 (µg/m³)</th>
                    <th scope="col" className="py-2">แหล่งข้อมูล</th>
                  </tr></thead>
                  <tbody>{daily.points.map((point) => (
                    <tr key={point.date} className="border-b border-slate-100">
                      <th scope="row" className="py-2 pr-4 font-normal">{formatDate(point.date)}</th>
                      <td className="py-2 pr-4 tabular-nums">{formatValue(point.pm25)}</td>
                      <td className="py-2">{point.source ?? "—"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
        </>}
      </div>
    </main>
  );
}
