// ── Types ──────────────────────────────────────────────────────────────────

export type District = string;

export type ForecastHorizon = "24h" | "48h";

export type ThaiAqiTier =
  | "Very Good"
  | "Good"
  | "Moderate"
  | "Unhealthy for Sensitive"
  | "Unhealthy";

export interface AqiTierMeta {
  tier: ThaiAqiTier;
  color: string;
  bgTint: string;
  thaiLabel: string;
  englishLabel: string;
  rangeLabel: string;
  adviceTh: string;
  adviceEn: string;
}

export interface HourlyDataPoint {
  hour: string;
  timestamp: string;
  actual: number | null;
  predicted: number;
}

export interface ShapFeature {
  feature: string;
  featureTh: string;
  value: number;
  unit: string;
}

export interface DailyForecastPoint {
  dayIndex: number;
  dayTh: string;
  dayEn: string;
  dateLabel: string;
  predictedPM25: number;
  peakPM25: number;
}

export interface DistrictStation {
  id: District;
  district?: string;
  observedAt?: string | null;
  isStale?: boolean;
  dataSource?: string;
  averagingPeriod?: string;
  nameTh: string;
  nameEn: string;
  stationTh: string;
  stationEn: string;
  currentPM25: number;
  weatherAt?: string;
  weatherSource?: string;
  temperatureC: number;
  windSpeedMs: number;
  windDirectionDeg: number;
  lat: number;
  lon: number;
  mapX: number; // 0..100 percentage on Bangkok canvas
  mapY: number; // 0..100 percentage on Bangkok canvas
  distanceKm: number;
}

export interface ForecastResponse {
  district: District;
  horizon: ForecastHorizon;
  modelName?: string;
  dataSource?: string;
  fetchedAt: string;
  currentPM25: number;
  predictedPeak: number;
  predictedPeakHour: string;
  topShapFactor: string;
  modelRMSE: number;
  hourly: HourlyDataPoint[];
  shap: ShapFeature[];
  weekly?: DailyForecastPoint[];
  tomorrow?: { date: string; pm25: number };
}

// ── 5-Tier Thai AQI Metadata (Flat Solid Colors) ───────────────────────────

export const THAI_AQI_TIERS: AqiTierMeta[] = [
  {
    tier: "Very Good",
    color: "#1776A5",
    bgTint: "#C5E8F8",
    thaiLabel: "คุณภาพอากาศดีมาก",
    englishLabel: "Very Good",
    rangeLabel: "0 to 15.0",
    adviceTh: "อากาศบริสุทธิ์ เหมาะกับทุกกิจกรรมกลางแจ้ง",
    adviceEn: "Clean air, suitable for all outdoor activities",
  },
  {
    tier: "Good",
    color: "#267B46",
    bgTint: "#C4EDCF",
    thaiLabel: "คุณภาพอากาศดี",
    englishLabel: "Good",
    rangeLabel: "15.1 to 25.0",
    adviceTh: "คุณภาพอากาศดี สามารถทำกิจกรรมกลางแจ้งได้ปกติ",
    adviceEn: "Satisfactory air quality for outdoor activity",
  },
  {
    tier: "Moderate",
    color: "#E5BE3C",
    bgTint: "#F9ECA9",
    thaiLabel: "ปานกลาง",
    englishLabel: "Moderate",
    rangeLabel: "25.1 to 37.5",
    adviceTh: "คนทั่วไปทำกิจกรรมได้ปกติ กลุ่มเสี่ยงควรลดกิจกรรมหนัก",
    adviceEn: "Sensitive individuals should reduce prolonged exertion",
  },
  {
    tier: "Unhealthy for Sensitive",
    color: "#B94D20",
    bgTint: "#F8D3BA",
    thaiLabel: "เริ่มมีผลกระทบ",
    englishLabel: "Sensitive",
    rangeLabel: "37.6 to 75.0",
    adviceTh: "ควรสวมหน้ากาก N95 เมื่ออยู่กลางแจ้งและลดเวลาอยู่นอกอาคาร",
    adviceEn: "Wear an N95 mask outdoors and limit outdoor exposure",
  },
  {
    tier: "Unhealthy",
    color: "#BE3F50",
    bgTint: "#F4C3CB",
    thaiLabel: "มีผลกระทบต่อสุขภาพ",
    englishLabel: "Unhealthy",
    rangeLabel: "Above 75.0",
    adviceTh: "งดกิจกรรมกลางแจ้ง ปิดประตูหน้าต่างและเปิดเครื่องฟอกอากาศ",
    adviceEn: "Avoid outdoor activity and run indoor air filtration",
  },
];

export function getThaiAqiMeta(pm25: number): AqiTierMeta {
  if (!Number.isFinite(pm25)) return { ...THAI_AQI_TIERS[2], color: "#64748B", bgTint: "#F1F5F9", thaiLabel: "ไม่มีข้อมูล", englishLabel: "No data", adviceTh: "ไม่มีค่าที่ใช้ประเมิน", adviceEn: "Reading unavailable" };
  if (pm25 <= 15) return THAI_AQI_TIERS[0];
  if (pm25 <= 25) return THAI_AQI_TIERS[1];
  if (pm25 <= 37.5) return THAI_AQI_TIERS[2];
  if (pm25 <= 75) return THAI_AQI_TIERS[3];
  return THAI_AQI_TIERS[4];
}

// Legacy 4-tier helpers kept for compatibility with standalone chart/KPI components
export type AqiStatus =
  | "Good"
  | "Moderate"
  | "Unhealthy for Sensitive"
  | "Unhealthy";

export function getAqiStatus(pm25: number): AqiStatus {
  if (pm25 <= 25) return "Good";
  if (pm25 <= 37.5) return "Moderate";
  if (pm25 <= 75) return "Unhealthy for Sensitive";
  return "Unhealthy";
}

export function getAqiColor(status: AqiStatus): string {
  return THAI_AQI_TIERS.find(level => level.tier === status)!.color;
}


export const BANGKOK_STATIONS: DistrictStation[] = [];
export const EMPTY_STATION: DistrictStation = {
  id: "", nameTh: "", nameEn: "", stationTh: "", stationEn: "",
  currentPM25: NaN, temperatureC: NaN, windSpeedMs: NaN,
  windDirectionDeg: NaN, lat: 13.7563, lon: 100.5018,
  mapX: 50, mapY: 50, distanceKm: NaN
};
export function formatReading(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}
export function formatObservedAt(value?: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Date(value).toLocaleString("th-TH", {timeZone: "Asia/Bangkok"});
}
export function build7DayBangkokForecast(): DailyForecastPoint[] { return []; }
export function buildMockForecast(district: District, horizon: ForecastHorizon): ForecastResponse {
  return { district, horizon, fetchedAt: "", currentPM25: NaN,
    predictedPeak: NaN, predictedPeakHour: "", topShapFactor: "",
    modelRMSE: NaN, hourly: [], shap: [], weekly: [],
    dataSource: "unavailable" };
}
const ORIGIN = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");
const API_BASE = ORIGIN.endsWith("/api/v1") ? ORIGIN : ORIGIN + "/api/v1";
const STATION_ORIGIN = (process.env.NEXT_PUBLIC_STATION_API_URL || "http://127.0.0.1:8001").replace(/\/+$/, "");
export type FetchStatus = "idle" | "loading" | "success" | "error";
export interface ForecastResult {
 data: ForecastResponse | null; status: FetchStatus; error: string | null; isOffline: boolean;
}
function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : NaN;
}
type StationRecord = Record<string, unknown>;
export function normalizeStation(raw: StationRecord, stale: boolean): DistrictStation | null {
  const id = typeof raw.stationId === "string" ? raw.stationId : raw.id;
  const lat = numeric(raw.latitude ?? raw.lat), lon = numeric(raw.longitude ?? raw.lon);
  if (typeof id !== "string" || !id || !Number.isFinite(lat) || !Number.isFinite(lon)
      || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const name = String(raw.stationName ?? raw.name ?? id);
  const district = typeof raw.district === "string" ? raw.district : "";
  return {
    id, district, nameTh: name, nameEn: name,
    stationTh: district ? "เขต" + district : String(raw.area ?? ""),
    stationEn: district || String(raw.area ?? ""),
    lat, lon, mapX: 50, mapY: 50, distanceKm: NaN,
    currentPM25: numeric(raw.currentPM25) >= 0 ? numeric(raw.currentPM25) : NaN,
    temperatureC: NaN, windSpeedMs: NaN,
    windDirectionDeg: numeric(raw.windDirectionDeg),
    observedAt: typeof raw.observedAt === "string" ? raw.observedAt : null,
    isStale: stale || raw.isStale === true,
    averagingPeriod: String(raw.averagingPeriod ?? "not_verified"),
    dataSource: String(raw.dataSource ?? "air4thai")
  };
}
async function getJson(path: string, externalSignal?: AbortSignal, base = API_BASE): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, 45000);
  externalSignal?.addEventListener("abort", abort);
  if (externalSignal?.aborted) abort();
  try {
    const res = await fetch(base + path, {signal: controller.signal, cache: "no-store"});
    if (!res.ok) throw new Error("API returned " + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abort);
  }
}
type MeasuredWeather = { source: string; observedAt: string; temperatureC?: number; windSpeedMs?: number };

async function addCurrentWeather(stations: DistrictStation[], signal?: AbortSignal) {
  if (!stations.length) return stations;
  try {
    const timeout = AbortSignal.timeout(12000);
    const response = await fetch("/api/station-weather", {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: "no-store",
    });
    if (!response.ok) return stations;
    const { stations: weatherById }: { stations: Record<string, MeasuredWeather> } = await response.json();
    return stations.map(station => {
      const weather = weatherById[station.id.toLowerCase()];
      if (!weather) return station;
      return { ...station, temperatureC: numeric(weather.temperatureC),
        windSpeedMs: numeric(weather.windSpeedMs), weatherAt: weather.observedAt, weatherSource: weather.source };
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return stations;
  }
}

export async function fetchLiveStations(forceRefresh = false, externalSignal?: AbortSignal): Promise<DistrictStation[] | null> {
  try {
    const payload = await getJson("/stations" + (forceRefresh ? "?refresh=true" : ""), externalSignal, STATION_ORIGIN + "/api/v1");
    if (!Array.isArray(payload.stations)) throw new Error("Invalid stations response");
    const ids = new Set<string>();
    const stations = payload.stations.flatMap(raw => {
      if (!raw || typeof raw !== "object") return [];
      const station = normalizeStation(raw as StationRecord, payload.cacheStale === true);
      if (!station || ids.has(station.id)) return [];
      ids.add(station.id);
      return [station];
    });
    return await addCurrentWeather(stations, externalSignal);
  } catch (error) {
    if (externalSignal?.aborted) throw error;
    return null;
  }
}
export type DistrictTomorrowForecast = {
  date: string;
  modelName?: string;
  stationCount: number;
  forecastCount: number;
  averagePM25: number | null;
};

export async function fetchDistrictTomorrow(district: District, signal: AbortSignal): Promise<DistrictTomorrowForecast> {
  const query = new URLSearchParams({ district, horizon: "tomorrow" });
  const payload = await getJson("/forecast?" + query, signal, STATION_ORIGIN + "/api/v1");
  if (typeof payload.targetDate !== "string" || !Array.isArray(payload.stations)) {
    throw new Error("Invalid district forecast response");
  }

  const stations = payload.stations.filter(station => station?.district === district);
  const predictions = stations.flatMap(station => {
    const value = numeric(station.predictedPM25);
    return station.forecastAvailable === true && value >= 0 ? [value] : [];
  });
  return {
    date: payload.targetDate,
    modelName: typeof payload.modelName === "string" ? payload.modelName : undefined,
    stationCount: stations.length,
    forecastCount: predictions.length,
    averagePM25: predictions.length ? predictions.reduce((sum, value) => sum + value, 0) / predictions.length : null,
  };
}

export async function fetchForecast(stationId: District, horizon: ForecastHorizon, externalSignal?: AbortSignal, forceRefresh = false): Promise<ForecastResult> {
  try {
    const payload = await getJson("/forecast?station_id=" + encodeURIComponent(stationId)
      + (forceRefresh ? "&refresh=true" : ""), externalSignal, STATION_ORIGIN + "/api/v1");
    const station = Array.isArray(payload.stations) ? payload.stations.find(item =>
      typeof item?.stationId === "string" && item.stationId.toLowerCase() === stationId.toLowerCase()) : undefined;
    const pm25 = numeric(station?.predictedPM25);
    const date = typeof payload.targetDate === "string" ? payload.targetDate : "";
    if (station?.forecastAvailable !== true || !Number.isFinite(pm25) || !date) {
      return { data: null, status: "error", isOffline: false,
        error: "ยังไม่มีพยากรณ์วันพรุ่งนี้สำหรับสถานีนี้" };
    }
    return {
      data: {
        ...buildMockForecast(stationId, horizon), tomorrow: { date, pm25 },
        fetchedAt: typeof payload.fetchedAt === "string" ? payload.fetchedAt : "",
        currentPM25: numeric(station.currentPM25),
        dataSource: typeof payload.dataSource === "string" ? payload.dataSource : undefined,
        modelName: typeof payload.modelName === "string" ? payload.modelName : undefined,
      },
      status: "success", error: null, isOffline: false,
    };
  } catch (error) {
    if (externalSignal?.aborted) throw error;
    return {data:null,status:"error",isOffline:true,error:"เชื่อมต่อบริการพยากรณ์ไม่ได้"};
  }
}
