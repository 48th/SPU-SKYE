"use client";

import { useEffect, useState } from "react";
import { formatObservedAt, formatReading } from "@/lib/forecastService";

type Metric = {
  horizon: number;
  trainCount: number;
  testCount: number;
  testStationCount: number;
  pmOnly: { mae: number; rmse: number };
  withWeather: { mae: number; rmse: number };
};
type Result = {
  reason?: string;
  metrics?: Metric[];
  testStart?: string;
  testEnd?: string;
  targetAt?: string;
  baseAt?: string;
  baseValue?: number;
  predictedPM25?: number;
  inputs?: Record<string, number>;
  contributions?: { feature: string; value: number }[];
};

const weatherFeatures = [
  ["wind_speed_10m", "ความเร็วลม", "กม./ชม."],
  ["rain", "ฝนในชั่วโมงก่อนหน้า", "มม."],
  ["relative_humidity_2m", "ความชื้นสัมพัทธ์", "%"],
] as const;

const reasons: Record<string, string> = {
  model_not_trained: "ยังไม่มีโมเดลทดลองที่ฝึกแล้ว",
  station_unavailable: "ไม่พบสถานีที่เลือก",
  stale_or_missing_pm25: "ค่าฝุ่นรายชั่วโมงของสถานีเก่าเกินไปหรือข้อมูลย้อนหลังยังไม่ครบ",
  forecast_time_passed: "เวลาเป้าหมายผ่านไปแล้ว ลองเลือกช่วงล่วงหน้าที่ไกลขึ้น",
  weather_unavailable: "ยังไม่มีข้อมูลอากาศตรงกับชั่วโมงที่โมเดลต้องใช้",
};

export default function WeatherModelExperiment({ stationId, horizon, revision }: {
  stationId?: string;
  horizon: number;
  revision: number;
}) {
  const [state, setState] = useState<{ stationId: string; horizon: number; revision: number; result: Result | null }>();
  useEffect(() => {
    if (!stationId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ horizon: String(horizon) });
    const path = "/admin/api/stations/" + encodeURIComponent(stationId) + "/forecast/hourly-weather-experiment?" + query;
    const store = (result: Result | null) => {
      if (!controller.signal.aborted) setState({ stationId, horizon, revision, result });
    };
    fetch(path, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(store, () => store(null));
    return () => controller.abort();
  }, [stationId, horizon, revision]);

  const result = state?.stationId === stationId && state?.horizon === horizon && state.revision === revision
    ? state.result : undefined;
  return (
    <section aria-labelledby="weather-experiment-title" className="rounded-2xl border border-neutral-200 bg-white/80 p-5 shadow-sm">
      <h2 id="weather-experiment-title" className="text-lg font-bold">โมเดลทดลอง PM2.5 และสภาพอากาศ</h2>
      <p className="mt-1 text-sm text-neutral-600">
        ใช้ค่าฝุ่นย้อนหลัง เวลาในวัน ความเร็วลม ฝน และความชื้น
        {stationId && " · " + stationId.toUpperCase() + " · ล่วงหน้า " + horizon + " ชั่วโมง"}
      </p>
      {result?.contributions && result.inputs ? (
        <>
          <h3 className="mt-4 font-bold">ค่า SHAP ของปัจจัยอากาศ</h3>
          <p className="mt-1 text-sm text-neutral-700">
            ค่าอ้างอิง {formatReading(result.baseValue ?? NaN, 2)} → ค่าพยากรณ์ทดลอง {formatReading(result.predictedPM25 ?? NaN, 2)} µg/m³
          </p>
          <p className="mt-1 text-xs text-neutral-600">
            อากาศที่เวลาฐาน {formatObservedAt(result.baseAt)} · พยากรณ์สำหรับ {formatObservedAt(result.targetAt)}
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="bg-neutral-100"><tr>
                <th scope="col" className="p-2 text-left">ปัจจัย</th>
                <th scope="col" className="p-2 text-right">ค่าที่โมเดลใช้</th>
                <th scope="col" className="p-2 text-right">SHAP (µg/m³)</th>
              </tr></thead>
              <tbody>{weatherFeatures.map(([key, label, unit]) => {
                const effect = result.contributions?.find(item => item.feature === key)?.value ?? NaN;
                return <tr key={key} className="border-t border-neutral-200">
                  <th scope="row" className="p-2 text-left font-medium">{label}</th>
                  <td className="p-2 text-right">{formatReading(result.inputs?.[key] ?? NaN, 1)} {unit}</td>
                  <td className="p-2 text-right font-semibold">{effect >= 0.005 ? "+" : ""}{formatReading(effect, 2)}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-neutral-600">ตารางแสดงเฉพาะสามปัจจัยอากาศ ผลต่างจากค่าอ้างอิงยังรวมประวัติ PM2.5 และเวลาด้วย</p>
        </>
      ) : <p role="status" className="mt-3 text-sm text-neutral-600">
        {!stationId ? "รอข้อมูลสถานี" : result === undefined ? "กำลังประมวลผลค่า SHAP รุ่นทดลอง…"
          : result === null ? "โหลดผลโมเดลทดลองไม่ได้" : reasons[result.reason ?? ""] ?? "ยังไม่มีค่า SHAP สำหรับช่วงนี้"}
      </p>}
      {!!result?.metrics?.length && (
        <details className="mt-4 border-t border-neutral-200 pt-3">
          <summary className="cursor-pointer text-sm font-semibold">ผลทดสอบย้อนหลังเทียบรุ่นใช้ค่าฝุ่นและเวลา</summary>
          <p className="mt-2 text-xs text-neutral-600">
            ช่วงทดสอบ {formatObservedAt(result.testStart)} ถึง {formatObservedAt(result.testEnd)} · ทั้งสองรุ่นฝึกและทดสอบบนคู่ข้อมูลเดียวกัน
          </p>
          <table className="mt-2 w-full text-sm tabular-nums">
            <thead className="bg-neutral-100"><tr>
              <th scope="col" className="p-2 text-left">ล่วงหน้า</th>
              <th scope="col" className="p-2 text-right">คู่ทดสอบ</th>
              <th scope="col" className="p-2 text-right">MAE ค่าฝุ่นและเวลา</th>
              <th scope="col" className="p-2 text-right">MAE เพิ่มอากาศ</th>
            </tr></thead>
            <tbody>{result.metrics.map(metric => (
              <tr key={metric.horizon} className="border-t border-neutral-200">
                <th scope="row" className="p-2 text-left font-medium">{metric.horizon} ชม.</th>
                <td className="p-2 text-right">{metric.testCount}</td>
                <td className="p-2 text-right">{formatReading(metric.pmOnly.mae, 2)}</td>
                <td className="p-2 text-right">{formatReading(metric.withWeather.mae, 2)}</td>
              </tr>
            ))}</tbody>
          </table>
        </details>
      )}
    </section>
  );
}
