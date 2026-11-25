"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import WeatherModelExperiment from "./WeatherModelExperiment";
import hourlyEvaluation from "./hourly-evaluation.json";
import { formatObservedAt, formatReading, getThaiAqiMeta } from "@/lib/forecastService";

type Reading = { observedAt: string; pm25: number };
type Station = {
  stationId: string;
  name: string;
  district: string | null;
  currentPM25: number | null;
  observedAt?: string;
  isStale: boolean;
  forecastAvailable: boolean;
  dailyCoverage?: { availableDays: number; requiredDays: number };
  hourlyForecast?: {
    ready?: boolean;
    reason?: string;
    source?: string;
    lastStoredAt?: string;
    missingHours?: string[];
    history?: Reading[];
  };
};
type Snapshot = { stations: Station[]; fetchedAt?: string };
type ErrorMetrics = { mae: number; rmse: number };
type EvaluationGroup = { count: number; extraTrees: ErrorMetrics; persistence?: ErrorMetrics };
type Evaluation = { overall?: EvaluationGroup; stations?: Record<string, EvaluationGroup> };
type Comparison = {
  stationId: string;
  horizon: number;
  source: string;
  sampleCount: number;
  modelName?: string;
  mae: number | null;
  holdoutCount: number;
  holdoutMae: number | null;
  contextCount: number;
  reason?: string;
  points: { targetAt: string; actual: number | null; predicted: number | null }[];
};
type IssuedComparison = {
  windowDays: number;
  modelFile?: string;
  issuedCount: number;
  matchedCount: number;
  pendingCount: number;
  missingActualCount: number;
  modelMae: number | null;
  persistenceMae: number | null;
  points: {
    issuedAt: string; targetAt: string; predicted: number; persistence: number; actual: number | null;
  }[];
};

type HourlyShap =
  | { reason: string }
  | {
    hoursAhead: number;
    baseValue: number;
    predictedPM25: number;
    referenceCount: number;
    contributions: { feature: string; value: number }[];
  };
const weatherFields = {
  wind_speed_10m: ["ความเร็วลม", "km/h"],
  wind_direction_10m: ["ทิศที่ลมพัดมา", "°"],
  rain: ["ฝนสะสมในชั่วโมงก่อนหน้า", "mm"],
  relative_humidity_2m: ["ความชื้นสัมพัทธ์", "%"],
  temperature_2m: ["อุณหภูมิ", "°C"],
} as const;

type WeatherField = keyof typeof weatherFields;
type WeatherPayload = {
  weather: {
    timezone: string;
    hourly: Partial<Record<WeatherField, (number | null)[]>> & { time: string[] };
  };
};

function weatherAtHour(payload: WeatherPayload, preferred?: string) {
  const hourly = payload.weather.hourly;
  if (payload.weather.timezone !== "Asia/Bangkok") return null;
  const parseTime = (stamp: string) => Date.parse(stamp + "+07:00");
  const anchor = preferred ? Date.parse(preferred) : Date.now();
  const index = hourly.time.findLastIndex(stamp => parseTime(stamp) <= anchor);
  if (index === -1 || (preferred && parseTime(hourly.time[index]) !== anchor)) return null;
  const readings = (Object.keys(weatherFields) as WeatherField[]).map(field => {
    const value = hourly[field]?.[index];
    return { field, value: typeof value === "number" && Number.isFinite(value) ? value : null };
  });
  return { time: hourly.time[index] + "+07:00", readings };
}

const correlationFields = ["wind_speed_10m", "rain", "relative_humidity_2m", "temperature_2m"] as const;
const minimumWeatherPairs = 12;

function weatherCorrelations(payload: WeatherPayload, points: Comparison["points"]) {
  if (payload.weather.timezone !== "Asia/Bangkok") return [];
  const hourly = payload.weather.hourly;
  const pmByTime = new Map(points.flatMap(({ targetAt, actual }) =>
    actual != null && Number.isFinite(actual) ? [[Date.parse(targetAt), actual] as const] : []
  ));
  return correlationFields.map(field => {
    const pairs = hourly.time.flatMap((stamp, index) => {
      const pm = pmByTime.get(Date.parse(stamp + "+07:00"));
      const value = hourly[field]?.[index];
      return pm != null && typeof value === "number" && Number.isFinite(value) ? [[pm, value] as const] : [];
    });
    const count = pairs.length;
    if (count < minimumWeatherPairs) return { field, count, reason: "few" as const, correlation: null };
    const pmMean = pairs.reduce((sum, [pm]) => sum + pm, 0) / count;
    const weatherMean = pairs.reduce((sum, [, value]) => sum + value, 0) / count;
    let covariance = 0;
    let pmVariance = 0;
    let weatherVariance = 0;
    for (const [pm, value] of pairs) {
      const pmDelta = pm - pmMean;
      const weatherDelta = value - weatherMean;
      covariance += pmDelta * weatherDelta;
      pmVariance += pmDelta ** 2;
      weatherVariance += weatherDelta ** 2;
    }
    const scale = Math.sqrt(pmVariance * weatherVariance);
    if (scale <= 1e-9) return { field, count, reason: "constant" as const, correlation: null };
    return { field, count, correlation: Math.max(-1, Math.min(1, covariance / scale)) };
  });
}

type HourlyExplanationResponse = {
  hourlyForecast: {
    shap?: HourlyShap; reason?: string; observedAt?: string; modelName?: string;
    points?: { hoursAhead: number; targetAt: string; predictedPM25: number }[];
  };
};

function shapFeatureLabel(feature: string) {
  if (feature === "hour_of_day") return "รอบเวลาในวัน (sin + cos)";
  const lag = /^lag(\d+)$/.exec(feature)?.[1];
  if (lag === "0") return "PM2.5 ชั่วโมงล่าสุด";
  if (lag) return "PM2.5 ย้อนหลัง " + lag + " ชม.";
  return feature === "sin" || feature === "cos" ? "รอบเวลาในวัน (" + feature + ")" : feature;
}

const comparisonTick = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

const targetHour = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok", hour: "2-digit", hourCycle: "h23",
});
const targetDate = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok" });

function summarizeByTime(points: Comparison["points"]) {
  const morning = { label: "05:00–09:59", count: 0, absoluteError: 0, signedError: 0, dates: new Set<string>() };
  const other = { label: "ช่วงอื่น", count: 0, absoluteError: 0, signedError: 0, dates: new Set<string>() };
  for (const { targetAt, actual, predicted } of points) {
    if (actual == null || predicted == null) continue;
    const target = new Date(targetAt);
    const hour = Number(targetHour.format(target));
    const group = hour >= 5 && hour < 10 ? morning : other;
    const error = predicted - actual;
    group.count++;
    group.absoluteError += Math.abs(error);
    group.signedError += error;
    group.dates.add(targetDate.format(target));
  }
  return [morning, other];
}

const reasons: Record<string, string> = {
  missing_hourly_observations: "ข้อมูลบางชั่วโมงขาด",
  stale_observations: "ค่ารายชั่วโมงเก่า",
  no_observations: "ยังไม่มีค่ารายชั่วโมง",
  station_not_supported: "ยังไม่รองรับ",
  model_unavailable: "โมเดลยังไม่พร้อม",
};
const panel = "rounded-2xl border border-neutral-200 bg-white/80 p-5 shadow-sm";
const time = (stamp?: string) => stamp ? formatObservedAt(stamp) : "—";
const fresh = (s: Station) => s.currentPM25 != null && !s.isStale;
const hourlyLabel = (s: Station) => s.hourlyForecast?.ready ? "พร้อม" :
  reasons[s.hourlyForecast?.reason ?? ""] ?? "รอตรวจสอบ";

async function request<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch("/admin/api" + path, { cache: "no-store", credentials: "same-origin", signal });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

export default function AdminPage() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [evaluation, setEvaluation] = useState<Evaluation>();
  const [query, setQuery] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [selected, setSelected] = useState("");
  const [comparisonHorizon, setComparisonHorizon] = useState(1);
  const [comparison, setComparison] = useState<{ id: string; horizon: number; value: Comparison | null }>();
  const [stationWeather, setStationWeather] = useState<{
    id: string; revision: number; payload: WeatherPayload | null;
  }>();
  const [issuedComparison, setIssuedComparison] = useState<{
    id: string; horizon: number; revision: number; value: IssuedComparison | null;
  }>();
  const [explanation, setExplanation] = useState<{
    id: string; horizon: number; revision: number;
    forecast: HourlyExplanationResponse["hourlyForecast"] | null;
  }>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
    request<Snapshot>("/forecast?diagnostics=true", signal).then(data => {
      if (!controller.signal.aborted) {
        setSnapshot(data);
        setFailed(false);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    request<Evaluation>("/evaluation", signal).then(data => {
      if (!controller.signal.aborted) setEvaluation(data);
    }).catch(() => {});
    return () => controller.abort();
  }, [revision]);

  const stations = snapshot?.stations ?? [];
  const issueCount = (station: Station) =>
    Number(!fresh(station)) + Number(!station.hourlyForecast?.ready) + Number(!station.forecastAvailable);
  const needle = query.trim().toLowerCase();
  const visible = stations.filter(s =>
    (!onlyIssues || issueCount(s) > 0) &&
    [s.stationId, s.name, s.district].some(value => value?.toLowerCase().includes(needle))
  ).sort((a, b) => issueCount(b) - issueCount(a) || a.name.localeCompare(b.name, "th"));
  const station = stations.find(s => s.stationId === selected);
  const comparisonId = selected || stations.find(item => item.stationId.toUpperCase() === "BKP102T")?.stationId || stations[0]?.stationId;
  useEffect(() => {
    if (!comparisonId) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    const url = "/stations/" + encodeURIComponent(comparisonId) + "/forecast/hourly-comparison?show_history=true&horizon=" + comparisonHorizon;
    request<Comparison>(url, signal).then(value => {
      if (!controller.signal.aborted) setComparison({ id: comparisonId, horizon: comparisonHorizon, value });
    }).catch(() => {
      if (!controller.signal.aborted) setComparison({ id: comparisonId, horizon: comparisonHorizon, value: null });
    });
    return () => controller.abort();
  }, [comparisonId, comparisonHorizon, revision]);
  useEffect(() => {
    if (!comparisonId) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    const url = "/stations/" + encodeURIComponent(comparisonId) + "/forecast/hourly?shap_horizon=" + comparisonHorizon;
    const store = (forecast: HourlyExplanationResponse["hourlyForecast"] | null) => {
      if (!controller.signal.aborted) {
        setExplanation({ id: comparisonId, horizon: comparisonHorizon, revision, forecast });
      }
    };
    request<HourlyExplanationResponse>(url, signal).then(reply => store(reply.hourlyForecast), () => store(null));
    return () => controller.abort();
  }, [comparisonId, comparisonHorizon, revision]);
  useEffect(() => {
    if (!comparisonId) return;
    const controller = new AbortController();
    async function refresh() {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
      const url = "/stations/" + encodeURIComponent(comparisonId) + "/forecast/hourly-issued?horizon=" + comparisonHorizon;
      try {
        const value = await request<IssuedComparison>(url, signal);
        if (!controller.signal.aborted) setIssuedComparison({ id: comparisonId, horizon: comparisonHorizon, revision, value });
      } catch {
        if (!controller.signal.aborted) setIssuedComparison({ id: comparisonId, horizon: comparisonHorizon, revision, value: null });
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 60000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [comparisonId, comparisonHorizon, revision]);
  const issued = issuedComparison?.id === comparisonId &&
    issuedComparison?.horizon === comparisonHorizon && issuedComparison.revision === revision
    ? issuedComparison.value : undefined;

  const hourlyExplanation = explanation?.id === comparisonId &&
    explanation?.horizon === comparisonHorizon && explanation.revision === revision
    ? explanation.forecast : undefined;
  const shap = hourlyExplanation?.shap;

  useEffect(() => {
    if (!comparisonId) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
    const store = (payload: WeatherPayload | null) => {
      if (!controller.signal.aborted) setStationWeather({ id: comparisonId, revision, payload });
    };
    request<WeatherPayload>("/stations/" + encodeURIComponent(comparisonId) + "/weather", signal)
      .then(store, () => store(null));
    return () => controller.abort();
  }, [comparisonId, revision]);

  const weatherPayload = stationWeather?.id === comparisonId && stationWeather?.revision === revision
    ? stationWeather.payload : undefined;
  const weatherTarget = hourlyExplanation?.points?.find(point => point.hoursAhead === comparisonHorizon);
  const weatherAnchor = weatherTarget?.targetAt ?? hourlyExplanation?.observedAt;
  const weather = weatherPayload ? weatherAtHour(weatherPayload, weatherAnchor) : weatherPayload;
  const weatherRain = weather?.readings.find(reading => reading.field === "rain")?.value;

  const comparisonResult = comparison?.id === comparisonId && comparison?.horizon === comparisonHorizon
    ? comparison.value : undefined;
  const correlations = weatherPayload && comparisonResult
    ? weatherCorrelations(weatherPayload, comparisonResult.points) : [];
  const lastPair = comparisonResult?.points.findLast(point => point.actual != null && point.predicted != null);

  const hourlyReadings = station?.hourlyForecast?.history ?? [];
  const newest = hourlyReadings.at(-1);
  const readingsByHour = new Map(hourlyReadings.map(item => [Date.parse(item.observedAt), item.pm25]));
  const chart = newest ? Array.from({ length: 24 }, (_, index) => {
    const stamp = new Date(Date.parse(newest.observedAt) - (23 - index) * 3600000);
    return { stamp, value: readingsByHour.get(stamp.getTime()) };
  }) : [];
  const chartMax = Math.max(1, ...hourlyReadings.map(item => item.pm25));
  const evaluationRows = [
    { label: "รวมชุดทดสอบ", group: evaluation?.overall },
    ...(station ? [{ label: station.stationId, group: evaluation?.stations?.[station.stationId.toUpperCase()] }] : []),
  ];
  const lastStored = (source: string) => stations.reduce<string | undefined>((latest, item) => {
    const hourly = item.hourlyForecast;
    const stamp = hourly?.source === source ? hourly.lastStoredAt : undefined;
    return stamp && (!latest || stamp > latest) ? stamp : latest;
  }, undefined);

  return (
    <main id="main-content" className="bangkok-ui-font min-h-screen bg-neutral-100 px-4 py-6 text-neutral-900 sm:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <a href="/map" className="text-sm font-semibold text-neutral-600 hover:underline">← แผนที่คุณภาพอากาศ</a>
            <h1 className="mt-2 text-3xl font-bold">สถานะระบบ PM2.5</h1>
            <p className="mt-1 text-sm text-neutral-600">ติดตามข้อมูลตรวจวัดและความพร้อมของพยากรณ์รายสถานี</p>
          </div>
          <button type="button" disabled={loading} onClick={() => { setLoading(true); setRevision(value => value + 1); }}
            className="rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {loading ? "กำลังโหลด…" : "อัปเดตสถานะ"}
          </button>
        </header>
        {failed && <p role="alert" className="rounded-xl bg-amber-100 p-3 text-sm text-amber-950">โหลดสถานะไม่สำเร็จ {snapshot ? "กำลังแสดงข้อมูลรอบก่อน" : "ตรวจว่าบริการรายสถานีกำลังรัน แล้วกดอัปเดตอีกครั้ง"}</p>}
        <section aria-label="ภาพรวมสถานี" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ["มีค่าฝุ่นล่าสุด", stations.filter(fresh).length],
            ["พร้อมพยากรณ์ 6 ชั่วโมง", stations.filter(s => s.hourlyForecast?.ready).length],
            ["พยากรณ์ค่าเฉลี่ยวันพรุ่งนี้ได้", stations.filter(s => s.forecastAvailable).length],
          ].map(([label, count]) => (
            <div key={label} className={panel}>
              <h2 className="text-sm font-medium text-neutral-600">{label}</h2>
              <p className="mt-2 text-3xl font-bold tabular-nums">{snapshot ? count : "—"} <span className="text-sm font-normal text-neutral-600">{snapshot && ("จาก " + stations.length + " สถานี")}</span></p>
            </div>
          ))}
        </section>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="space-y-4">
          <section className={panel}>
            <h2 className="text-lg font-bold">สถานีตรวจวัด</h2>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input type="search" aria-label="ค้นหาสถานี" placeholder="ค้นหาชื่อ เขต หรือรหัสสถานี" value={query}
                onChange={event => setQuery(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-neutral-300 px-3 py-2 text-sm" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyIssues} onChange={event => setOnlyIssues(event.target.checked)} /> เฉพาะสถานีที่มีปัญหา</label>
            </div>
            <div className="mt-3 max-h-[34rem] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-white text-neutral-600"><tr>
                  <th className="p-2">สถานี</th><th className="p-2">PM2.5</th><th className="p-2">6 ชม.</th><th className="p-2">พรุ่งนี้</th>
                </tr></thead>
                <tbody>{visible.map(item => (
                  <tr key={item.stationId} className={item.stationId === selected ? "border-t bg-neutral-100" : "border-t"}>
                    <th scope="row" className="p-2 text-left">
                      <button type="button" aria-pressed={selected === item.stationId} onClick={() => setSelected(item.stationId)}
                        className="text-left font-semibold underline decoration-neutral-300 underline-offset-2 hover:decoration-current">{item.name}</button>
                      <span className="block text-xs font-normal text-neutral-600">{item.district} · {item.stationId}</span>
                    </th>
                    <td className="p-2 tabular-nums">{item.currentPM25 == null ? "—" : formatReading(item.currentPM25)}
                      <span className="block text-xs text-neutral-600">{time(item.observedAt)}{item.isStale && " · ข้อมูลเก่า"}</span>
                    </td>
                    <td className="p-2">{hourlyLabel(item)}</td>
                    <td className="p-2">{item.forecastAvailable ? "พร้อม" : "ยังไม่พร้อม"}</td>
                  </tr>
                ))}</tbody>
              </table>
              {visible.length === 0 && <p className="p-3 text-sm text-neutral-600">{loading ? "กำลังโหลดสถานี…" : snapshot ? "ไม่พบสถานีตามตัวกรอง" : "ยังไม่มีข้อมูลสถานี"}</p>}
            </div>
          </section>
          <section className={panel} aria-labelledby="forecast-actual-title">
            <h2 id="forecast-actual-title" className="text-lg font-bold">พยากรณ์เทียบค่าจริง</h2>
            <p className="mt-1 text-sm text-neutral-600">คำนวณย้อนหลังด้วยโมเดลที่ระบบใช้อยู่ เทียบกับค่าที่สถานีวัดได้ในชั่วโมงเดียวกัน</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
              <label className="min-w-0 text-xs font-semibold text-neutral-700">สถานี
                <select value={comparisonId ?? ""} disabled={!stations.length} onChange={event => setSelected(event.target.value)}
                  className="mt-1 block w-full min-w-0 rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm">
                  {!stations.length && <option value="">กำลังโหลดสถานี</option>}
                  {stations.map(item => <option key={item.stationId} value={item.stationId}>{item.name} ({item.stationId.toUpperCase()})</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-neutral-700">พยากรณ์ล่วงหน้า
                <select value={comparisonHorizon} onChange={event => setComparisonHorizon(Number(event.target.value))}
                  className="mt-1 block w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm">
                  {[1, 2, 3, 4, 5, 6].map(hour => <option key={hour} value={hour}>{hour} ชั่วโมง</option>)}
                </select>
              </label>
            </div>
            {comparisonResult?.points.length ? (
              <>
                <p className="mt-4 text-xs text-neutral-600">µg/m³ · {comparisonResult.source}{comparisonResult.modelName && " · " + comparisonResult.modelName} · {comparisonResult.sampleCount.toLocaleString("th-TH")} คู่ที่เทียบได้
                  {comparisonResult.mae != null && " · MAE ย้อนหลังรวม " + formatReading(comparisonResult.mae, 2)}
                </p>
                <div className="mt-2 h-64 w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={comparisonResult.points} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 4" vertical={false} />
                      <XAxis dataKey="targetAt" minTickGap={35} tick={{ fontSize: 10 }}
                        tickFormatter={stamp => comparisonTick.format(new Date(stamp))} />
                      <YAxis width={34} tick={{ fontSize: 11 }} />
                      <Tooltip labelFormatter={label => time(String(label))} />
                      <Legend />
                      <Line dataKey="actual" name="ค่าตรวจวัดจริง" stroke="#05705f" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                      <Line dataKey="predicted" name="ค่าพยากรณ์ย้อนหลัง" stroke="#5b50b7" strokeDasharray="6 3" strokeWidth={2} dot={{ r: 2, strokeWidth: 0 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {lastPair && <p className="mt-3 rounded-xl bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
                  {time(lastPair.targetAt)} · จริง <strong>{formatReading(lastPair.actual!)}</strong> · พยากรณ์ <strong>{formatReading(lastPair.predicted!)}</strong> µg/m³
                </p>}
                {!!comparisonResult.contextCount && (
                  <p className="mt-2 text-xs text-neutral-600">
                    กราฟรวม {comparisonResult.contextCount} คู่ในช่วงฝึกหรือช่วงคาบเกี่ยว
                    {comparisonResult.holdoutMae == null
                      ? " · ยังไม่มีคู่ทดสอบนอกช่วงฝึก"
                      : " · MAE เฉพาะชุดทดสอบ " + formatReading(comparisonResult.holdoutMae, 2) + " µg/m³ จาก " + comparisonResult.holdoutCount + " คู่"}
                  </p>
                )}
                {!!comparisonResult.sampleCount && (
                  <div className="mt-4">
                    <h3 className="text-sm font-semibold">ความคลาดเคลื่อนตามช่วงเวลาที่พยากรณ์ถึง</h3>
                    <table className="mt-2 w-full text-xs tabular-nums sm:text-sm">
                      <thead>
                        <tr className="border-b border-neutral-200">
                          <th scope="col" className="py-2 text-left">เวลาไทย</th>
                          <th scope="col" className="text-right">คู่ / วัน</th>
                          <th scope="col" className="text-right">MAE</th>
                          <th scope="col" className="text-right">พยากรณ์ − จริง</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summarizeByTime(comparisonResult.points).map(group => (
                          <tr key={group.label} className="border-b border-neutral-100">
                            <th scope="row" className="py-2 text-left font-medium">{group.label}</th>
                            <td className="text-right">{group.count} / {group.dates.size}</td>
                            <td className="text-right">{group.count ? formatReading(group.absoluteError / group.count, 2) : "—"}</td>
                            <td className="text-right">{group.count ? new Intl.NumberFormat("th-TH", {
                              signDisplay: "exceptZero", minimumFractionDigits: 2, maximumFractionDigits: 2,
                            }).format(group.signedError / group.count) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-2 text-xs text-neutral-600">หน่วย µg/m³ · ค่าบวกหมายถึงทายสูงกว่าค่าจริงโดยเฉลี่ย · แสดงผลย้อนหลังสูงสุด 7 วัน · ตารางสรุปจากคู่ทั้งหมดในกราฟ</p>
                  </div>
                )}
                {!comparisonResult.sampleCount && <p role="status" className="mt-2 text-sm text-neutral-600">มีค่าจริง แต่ช่วงนี้ยังไม่มีชั่วโมงที่ข้อมูลเข้าโมเดลครบสำหรับเทียบผล</p>}
              </>
            ) : <p role="status" className="mt-4 text-sm text-neutral-600">
              {comparisonResult === null ? "โหลดผลเปรียบเทียบไม่ได้" : comparisonResult
                ? "สถานีนี้ยังไม่มีค่าตรวจวัดในช่วงที่ใช้เทียบผล" : "กำลังโหลดผลเปรียบเทียบ…"}
            </p>}
          </section>

          <section className={panel} aria-labelledby="issued-hourly-title">
            <h2 id="issued-hourly-title" className="text-lg font-bold">พยากรณ์ที่ระบบออกจริง</h2>
            <p className="mt-1 text-sm text-neutral-600">
              บันทึกก่อนถึงเวลาเป้าหมาย · ใช้สถานีและช่วงล่วงหน้าที่เลือกด้านบน
              {comparisonId && " · " + comparisonId.toUpperCase() + " · " + comparisonHorizon + " ชั่วโมง"}
            </p>
            {issued ? (
              <>
                <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    ["บันทึกแล้ว", issued.issuedCount], ["เทียบค่าจริงได้", issued.matchedCount],
                    ["ยังไม่ถึงเวลาเป้าหมาย", issued.pendingCount], ["ถึงเวลาแล้ว รอค่าจริง", issued.missingActualCount],
                  ].map(([label, count]) => (
                    <div key={label} className="rounded-xl bg-neutral-100 p-3">
                      <dt className="text-xs text-neutral-700">{label}</dt>
                      <dd className="mt-1 text-xl font-bold tabular-nums">{count}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-sm text-neutral-700">
                  {issued.matchedCount > 0 && issued.modelMae != null && issued.persistenceMae != null
                    ? "MAE โมเดล " + formatReading(issued.modelMae, 2) + " · MAE วิธีใช้ค่าล่าสุด " + formatReading(issued.persistenceMae, 2) + " µg/m³ จากคู่เดียวกัน"
                    : "จะแสดง MAE เมื่อมีพยากรณ์ที่จับคู่กับค่าตรวจวัดได้"}
                </p>
                {issued.points.length > 0 && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[39rem] text-left text-sm tabular-nums">
                      <caption className="pb-2 text-left text-xs text-neutral-600">รายการล่าสุดในช่วง {issued.windowDays} วัน · หน่วย µg/m³{issued.modelFile && " · " + issued.modelFile}</caption>
                      <thead className="bg-neutral-100"><tr>
                        <th scope="col" className="p-2">เวลาออกผล</th>
                        <th scope="col" className="p-2">เวลาเป้าหมาย</th>
                        <th scope="col" className="p-2 text-right">โมเดล</th>
                        <th scope="col" className="p-2 text-right">ใช้ค่าล่าสุด</th>
                        <th scope="col" className="p-2 text-right">ค่าจริง</th>
                      </tr></thead>
                      <tbody>{issued.points.map(point => (
                        <tr key={point.targetAt} className="border-t border-neutral-200">
                          <td className="p-2">{time(point.issuedAt)}</td>
                          <td className="p-2">{time(point.targetAt)}</td>
                          <td className="p-2 text-right">{formatReading(point.predicted, 2)}</td>
                          <td className="p-2 text-right">{formatReading(point.persistence, 2)}</td>
                          <td className="p-2 text-right">{point.actual === null ? "—" : formatReading(point.actual, 2)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
                {issued.issuedCount === 0 && <p className="mt-2 text-sm text-neutral-600">ยังไม่มีรายการในช่วง {issued.windowDays} วันที่ผ่านมา ระบบจะเริ่มบันทึกเมื่อพยากรณ์ล่วงหน้าได้</p>}
              </>
            ) : <p role="status" className="mt-3 text-sm text-neutral-600">
              {issued === null ? "โหลดบันทึกพยากรณ์ไม่ได้" : comparisonId || loading ? "กำลังโหลดบันทึกพยากรณ์…" : "ยังไม่มีข้อมูลสถานี"}
            </p>}
          </section>

          <section className={panel} aria-labelledby="hourly-shap-title">
            <h2 id="hourly-shap-title" className="text-lg font-bold">วิเคราะห์ปัจจัย PM2.5</h2>
            <p className="mt-1 text-sm text-neutral-600">ใช้สถานีและช่วงเวลาที่เลือกในส่วนพยากรณ์เทียบค่าจริงด้านบน
              {comparisonId && " · " + comparisonId.toUpperCase() + " · ล่วงหน้า " + comparisonHorizon + " ชั่วโมง"}
            </p>
            <h3 className="mt-4 font-bold">ปัจจัยที่โมเดลใช้ · SHAP{hourlyExplanation?.modelName && " · " + hourlyExplanation.modelName}</h3>
            {shap && !("reason" in shap) ? (
              <>
                <p className="mt-3 font-semibold tabular-nums">ค่าอ้างอิง {formatReading(shap.baseValue, 2)} → ค่าพยากรณ์ {formatReading(shap.predictedPM25, 2)} µg/m³</p>
                <p className="mt-1 text-xs text-neutral-600">เทียบกับข้อมูลย้อนหลังของสถานีเดียวกัน {shap.referenceCount} ชุด · ค่าบวกเพิ่มผลพยากรณ์ ค่าลบลดผลพยากรณ์</p>
                <ul className="mt-2 divide-y divide-neutral-200 text-sm">
                  {shap.contributions.map(item => (
                    <li key={item.feature} className="flex justify-between gap-3 py-2">
                      <span>{shapFeatureLabel(item.feature)}</span>
                      <span className="font-semibold tabular-nums">{item.value >= 0.005 ? "+" : ""}{formatReading(item.value, 2)} µg/m³</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p role="status" className="mt-3 text-sm text-neutral-600">
                {!comparisonId ? (loading ? "กำลังโหลดสถานี…" : "ยังไม่มีข้อมูลสถานี")
                  : hourlyExplanation === undefined ? "กำลังโหลดค่า SHAP…"
                  : hourlyExplanation === null ? "โหลดค่า SHAP ไม่ได้"
                  : shap && "reason" in shap && shap.reason === "no_reference_history"
                    ? "ข้อมูลย้อนหลังของสถานียังไม่พอสำหรับคำนวณค่าอ้างอิง SHAP"
                    : reasons[hourlyExplanation.reason ?? ""] ?? "ยังไม่มีค่า SHAP สำหรับช่วงพยากรณ์นี้"}
              </p>
            )}

            <section className="mt-5 border-t border-neutral-200 pt-4" aria-labelledby="station-weather-context-title">
            <h3 id="station-weather-context-title" className="font-bold">สภาพอากาศบริเวณสถานี</h3>
            <p className="mt-1 text-sm text-neutral-600">
              {comparisonId && comparisonId.toUpperCase() + " · "}Open-Meteo เป็นข้อมูลจากแบบจำลองอากาศบริเวณพิกัดสถานี
              ใช้ประกอบการตีความ ส่วนค่า SHAP ด้านบนมาจากโมเดลที่ใช้ประวัติ PM2.5 และเวลาในวัน
            </p>
            {weather ? (
              <>
                <p className="mt-3 text-sm text-neutral-700">
                  {weatherTarget ? "ชั่วโมงเป้าหมายของพยากรณ์" : weatherAnchor ? "ชั่วโมงเดียวกับค่าฝุ่นล่าสุดของโมเดล" : "ชั่วโมงล่าสุดของข้อมูลอากาศ"}
                  {" · "}<time dateTime={weather.time}>{time(weather.time)}</time>
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                  {weather.readings.map(({ field, value }) => (
                    <div key={field} className="rounded-xl bg-neutral-100 p-3">
                      <dt className="text-xs text-neutral-700">{weatherFields[field][0]}</dt>
                      <dd className="mt-1 text-lg font-semibold tabular-nums">
                        {value === null ? "—" : formatReading(value, field === "wind_direction_10m" ? 0 : 1) + " " + weatherFields[field][1]}
                      </dd>
                    </div>
                  ))}
                </dl>
                <ul className="mt-3 space-y-1.5 text-sm text-neutral-700">
                  {weather.readings.some(reading => reading.field === "wind_speed_10m" && reading.value !== null) && (
                    <li>ลมอ่อนเอื้อต่อการสะสมของฝุ่น ส่วนทิศลมช่วยบอกทิศที่อากาศเคลื่อนมาถึงสถานี</li>
                  )}
                  {weatherRain != null && (
                    <li>{weatherRain > 0
                      ? "แบบจำลองระบุว่ามีฝนในชั่วโมงก่อนหน้า ฝนอาจช่วยชะล้างอนุภาคในอากาศ"
                      : "แบบจำลองไม่พบฝนในชั่วโมงก่อนหน้า"}</li>
                  )}
                  <li>ใช้ค่าเหล่านี้ดูสภาพแวดล้อมร่วมกับค่าฝุ่น การระบุสาเหตุที่จุดนี้ฝุ่นสูงหรือต่ำต้องอาศัยข้อมูลเพิ่มเติม เช่น แหล่งกำเนิดและค่าตรวจวัดในช่วงเดียวกัน</li>
                </ul>
              </>
            ) : (
              <p role="status" className="mt-3 text-sm text-neutral-600">
                {!comparisonId ? "รอข้อมูลสถานี"
                  : weather === undefined ? "กำลังโหลดข้อมูลสภาพอากาศ…"
                  : "ยังไม่มีข้อมูลสภาพอากาศสำหรับสถานีและชั่วโมงที่เลือก"}
              </p>
            )}
            </section>
            <section className="mt-5 border-t border-neutral-200 pt-4" aria-labelledby="weather-correlation-title">
              <h3 id="weather-correlation-title" className="font-bold">ความสัมพันธ์ระหว่างสภาพอากาศกับ PM2.5 ที่วัดได้</h3>
              <p className="mt-1 text-sm text-neutral-600">
                จับคู่ค่าฝุ่นจริงกับข้อมูล Open-Meteo ของสถานีเดียวกันในชั่วโมงเดียวกันจากช่วงย้อนหลังที่แสดงด้านบน
                ค่า r บวกหมายถึงมีแนวโน้มเพิ่มด้วยกัน ค่า r ลบหมายถึงมีแนวโน้มสวนทางกัน ผลนี้ใช้ดูความสัมพันธ์เบื้องต้น
              </p>
              {correlations.length > 0 ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm tabular-nums">
                    <thead className="bg-neutral-100"><tr>
                      <th scope="col" className="p-2 text-left">ปัจจัย</th>
                      <th scope="col" className="p-2 text-right">ชั่วโมงที่จับคู่ได้</th>
                      <th scope="col" className="p-2 text-right">ค่า r</th>
                    </tr></thead>
                    <tbody>{correlations.map(({ field, count, reason, correlation }) => (
                      <tr key={field} className="border-t border-neutral-200">
                        <th scope="row" className="p-2 text-left font-medium">{weatherFields[field][0]}</th>
                        <td className="p-2 text-right">{count}</td>
                        <td className="p-2 text-right">
                          {correlation !== null ? formatReading(correlation, 2)
                            : reason === "constant" ? "ค่าแทบไม่เปลี่ยนในช่วงนี้" : "ต้องมีอย่างน้อย " + minimumWeatherPairs + " คู่"}
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p role="status" className="mt-2 text-sm text-neutral-600">
                {comparisonId && (weatherPayload === undefined || comparisonResult === undefined)
                  ? "กำลังจับคู่ข้อมูลย้อนหลัง…" : "ยังไม่มีข้อมูลจับคู่สำหรับสถานีที่เลือก"}
              </p>}
            </section>
          </section>

          <WeatherModelExperiment stationId={comparisonId} horizon={comparisonHorizon} revision={revision} />

          <section className={panel} aria-labelledby="hourly-evaluation-title">
            <h2 id="hourly-evaluation-title" className="text-lg font-bold">ผลทดสอบย้อนหลัง Extra Trees รุ่นก่อน</h2>
            <p className="mt-1 text-sm text-neutral-600">ผลย้อนหลังรวม {Math.max(...hourlyEvaluation.metrics.map(row => row.stations))} สถานี · 24–25 พ.ย. 2569 · แสดงภาพรวมทุกสถานีในชุดทดสอบ</p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm tabular-nums">
                <caption className="sr-only">เปรียบเทียบโมเดลเดิมกับรุ่นฝึกเพิ่มบนข้อมูลทดสอบเดียวกัน</caption>
                <thead className="bg-neutral-100 text-neutral-700"><tr>
                  <th scope="col" className="p-2">ล่วงหน้า</th>
                  <th scope="col" className="p-2 text-right">คู่ที่เทียบได้</th>
                  <th scope="col" className="p-2 text-right">MAE เดิม</th>
                  <th scope="col" className="p-2 text-right">MAE ฝึกเพิ่ม</th>
                  <th scope="col" className="p-2 text-right">รุ่นใหม่คลาด ≤ 5</th>
                </tr></thead>
                <tbody>{hourlyEvaluation.metrics.map(row => (
                  <tr key={row.horizon} className="border-t border-neutral-200">
                    <th scope="row" className="p-2 font-medium">{row.horizon} ชม.</th>
                    <td className="p-2 text-right">{row.test.toLocaleString("th-TH")}</td>
                    <td className="p-2 text-right">{row.original.mae.toFixed(2)}</td>
                    <td className={row.candidate.mae < row.original.mae ? "p-2 text-right font-semibold text-emerald-800" : "p-2 text-right font-semibold"}>{row.candidate.mae.toFixed(2)}</td>
                    <td className="p-2 text-right">{row.candidate.within5.toFixed(1)}%</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-neutral-600">MAE คือค่าคลาดเฉลี่ย หน่วย µg/m³ · คลาด ≤ 5 คือสัดส่วนที่ต่างจากค่าจริงไม่เกิน ±5 µg/m³</p>
            <p className="mt-1 text-xs text-neutral-600">ผลนี้มาจากการรันย้อนหลัง ดูผลที่ระบบออกจริงได้ในส่วนด้านบน</p>
          </section>
          </div>

          <aside className="space-y-4" aria-label="รายละเอียดระบบ">
            <section className={panel} aria-live="polite">
              <h2 className="text-lg font-bold">{station?.name ?? "รายละเอียดสถานี"}</h2>
              {station ? <>
                <p className="text-sm text-neutral-600">{station.district} · {station.stationId}</p>
                <p className="mt-3 text-sm font-semibold">พยากรณ์ 6 ชั่วโมง · {hourlyLabel(station)}</p>
                {station.dailyCoverage && <p className="text-sm text-neutral-600">ข้อมูลรายวัน {station.dailyCoverage.availableDays}/{station.dailyCoverage.requiredDays} วัน</p>}
                {!!station.hourlyForecast?.missingHours?.length && <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm">
                  <h3 className="font-semibold">ชั่วโมงที่โมเดลยังขาด</h3>
                  <ul>{station.hourlyForecast.missingHours.map(stamp => <li key={stamp}>{time(stamp)}</li>)}</ul>
                </div>}
                {!!station.hourlyForecast?.history?.length && <>
                  <h3 className="mt-4 text-sm font-semibold">ค่าตรวจวัดรายชั่วโมง · {station.hourlyForecast.source}</h3>
                  <div aria-hidden="true" className="mt-2 flex h-20 items-end gap-px rounded-lg border border-neutral-200 bg-neutral-50 p-2">
                    {chart.map(({ stamp, value }) => (
                      <span key={stamp.toISOString()} className="min-w-0 flex-1 rounded-t-sm"
                        title={time(stamp.toISOString()) + " · " + (value == null ? "ไม่มีข้อมูล" : formatReading(value) + " µg/m³")}
                        style={value == null ? undefined : { height: Math.max(3, value / chartMax * 100) + "%", backgroundColor: getThaiAqiMeta(value).color }} />
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-neutral-600">24 ชั่วโมงถึงค่าล่าสุด · ช่องว่างคือชั่วโมงที่ไม่มีข้อมูล</p>
                  <div className="mt-2 max-h-48 overflow-auto">
                    <table className="w-full text-left text-xs">
                      <caption className="sr-only">ค่าตรวจวัดรายชั่วโมงของสถานี</caption>
                      <thead className="sticky top-0 bg-white text-neutral-600"><tr>
                        <th scope="col" className="px-2 py-1.5">เวลาวัด</th>
                        <th scope="col" className="px-2 py-1.5 text-right">PM2.5 (µg/m³)</th>
                      </tr></thead>
                      <tbody>{[...chart].reverse().map(({ stamp, value }) => (
                        <tr key={stamp.toISOString()} className="border-t border-neutral-100">
                          <td className="px-2 py-1.5"><time dateTime={stamp.toISOString()}>{time(stamp.toISOString())}</time></td>
                          <td className="px-2 py-1.5 text-right font-semibold tabular-nums"
                            style={value == null ? undefined : { backgroundColor: getThaiAqiMeta(value).bgTint }}>
                            {value == null ? "ไม่มีข้อมูล" : formatReading(value)}
                          </td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </>}
              </> : <p className="mt-2 text-sm text-neutral-600">เลือกชื่อสถานีในตารางเพื่อดูค่าตรวจวัดและชั่วโมงที่ขาด</p>}
            </section>
            <section className={panel}>
              <h2 className="font-bold">ข้อมูลที่ระบบรับล่าสุด</h2>
              <dl className="mt-2 space-y-2 text-sm">
                {[["Air4Thai", snapshot?.fetchedAt], ["AirBKK", lastStored("AirBKK")], ["AQMThai", lastStored("AQMThai")]].map(([source, stamp]) => (
                  <div key={source} className="flex flex-wrap justify-between gap-x-2"><dt>{source}</dt><dd className="text-neutral-600">{time(stamp)}</dd></div>
                ))}
              </dl>
            </section>
            <section className={panel}>
              <h2 className="font-bold">ผลประเมิน Extra Trees</h2>
              <p className="mt-1 text-xs text-neutral-600">ทดสอบย้อนหลังสำหรับค่าเฉลี่ยวันถัดไป</p>
              {evaluation?.overall ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-xs tabular-nums">
                    <caption className="sr-only">ผลทดสอบย้อนหลังของโมเดลพยากรณ์ค่าเฉลี่ยวันถัดไป</caption>
                    <thead className="bg-neutral-100 text-neutral-700"><tr>
                      <th scope="col" className="p-2">ชุดทดสอบ</th>
                      <th scope="col" className="p-2 text-right">จำนวน</th>
                      <th scope="col" className="p-2 text-right">MAE</th>
                      <th scope="col" className="p-2 text-right">RMSE</th>
                    </tr></thead>
                    <tbody>{evaluationRows.map(({ label, group }) => (
                      <tr key={label} className="border-t border-neutral-200">
                        <th scope="row" className="p-2 font-medium">{label}</th>
                        {group ? <>
                          <td className="p-2 text-right">{group.count.toLocaleString("th-TH")}</td>
                          <td className="p-2 text-right">{group.extraTrees.mae}</td>
                          <td className="p-2 text-right">{group.extraTrees.rmse}</td>
                        </> : <td colSpan={3} className="p-2 text-neutral-600">ไม่มีผลประเมินรายสถานี</td>}
                      </tr>
                    ))}</tbody>
                  </table>
                  <p className="mt-2 text-xs text-neutral-600">MAE และ RMSE เป็นค่าคลาดเคลื่อน หน่วย µg/m³ ค่ายิ่งต่ำยิ่งดี</p>
                  <a href="#issued-hourly-title" className="mt-1 inline-block text-xs text-neutral-700 underline">ดูผลเทียบพยากรณ์ที่ระบบออกจริง</a>
                </div>
              ) : <p className="mt-2 text-sm text-neutral-600">ยังไม่มีผลประเมินให้แสดง</p>}
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
