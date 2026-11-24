import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// AirBKK report indices verified against the matching Air4Thai stations.
const indices = [101, 102, 103, 104, 105, 56, 57, 58, 59, 60, 61, 62, 63, 64,
  65, 66, 67, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84,
  85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100,
  114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 133];
const bangkokDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric",
});
type Reading = { source: "AirBKK" | "AQMThai"; observedAt: string; temperatureC?: number; windSpeedMs?: number };
type Column = { Alias: string; MeasIndex: string; ShortName: string };
type Report = { status: string; arrParameter: Column[]; arrData: Record<string, string>[] };

async function readBatch(batch: number[], now: number) {
  const body = new URLSearchParams({
    groupid: "all", data_type: "hourly", display_type: "table",
    date_s: bangkokDate.format(now - 86400000), date_e: bangkokDate.format(now + 86400000),
  });
  body.append("parameterTags[]", "Temp");
  body.append("parameterTags[]", "WS");
  for (const index of batch) body.append("MeasIndex[]", String(index));
  const response = await fetch("https://official.airbkk.com/airbkk/Report/getData", {
    method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(10000),
    headers: { Cookie: "seen_welcome=yes", "X-Requested-With": "XMLHttpRequest",
      "User-Agent": "SPU-SKYE data report" },
  });
  if (!response.ok) throw new Error("AirBKK HTTP " + response.status);
  const report: Report = await response.json();
  if (report.status !== "success") throw new Error("AirBKK hourly report unavailable");
  const columns = report.arrParameter.filter(column => batch.includes(Number(column.MeasIndex)) &&
    (column.ShortName === "Temp" || column.ShortName === "WS"));
  const result: Record<string, Reading> = {};
  for (const row of report.arrData) {
    const date = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2})$/.exec(row.Date_Time);
    if (!date) continue;
    const [, day, month, year, clock] = date;
    const observedAt = `${Number(year) >= 2400 ? Number(year) - 543 : year}-${month}-${day}T${clock}:00+07:00`;
    const observed = Date.parse(observedAt);
    if (!Number.isFinite(observed) || observed > now || now - observed > 3 * 3600000) continue;
    for (const column of columns) {
      const raw = row[column.Alias];
      if (!raw || !String(raw).trim()) continue;
      const value = Number(raw);
      const temperature = column.ShortName === "Temp";
      if (!Number.isFinite(value) || (temperature ? value < 0 || value > 60 : value < 0 || value > 100)) continue;
      const id = `bkp${column.MeasIndex}t`;
      const existing = result[id];
      if (existing && existing.observedAt > observedAt) continue;
      const reading: Reading = existing?.observedAt === observedAt ? existing : { observedAt, source: "AirBKK" };
      if (temperature) reading.temperatureC = value;
      else reading.windSpeedMs = value;
      result[id] = reading;
    }
  }
  return result;
}

// Matches used by the Bangkok station backend for the AQMThai network.
const aqmStations = [
  ["02t", 67, "1BKK1002"], ["03t", 114, "1BKK1003"], ["05t", 122, "1BKK1004"],
  ["12t", 68, "1BKK1008"], ["50t", 88, "1BKK1009"], ["52t", 126, "1BKK1010"],
  ["53t", 110, "1BKK1011"], ["54t", 161, "1BKK1012"], ["59t", 116, "1BKK1001"],
  ["61t", 104, "1BKK1005"], ["o10", 54, "1BKK1006"],
] as const;

async function readAqm([id, serial, code]: typeof aqmStations[number], now: number) {
  const localDate = (time: number) => bangkokDate.format(time).split("/").reverse().join("-");
  const query = new URLSearchParams({
    serial: String(serial), timeframe: "hourly", sdate: localDate(now - 86400000),
    edate: localDate(now), stime: "0", etime: "23",
  });
  const response = await fetch("https://aqmthai.pcd.go.th/pcd/Ajaxs/getStationHistory?" + query, {
    cache: "no-store", signal: AbortSignal.timeout(8500),
  });
  if (!response.ok) throw new Error("AQMThai HTTP " + response.status);
  const data: { station?: { name_en?: string }; timeframe?: string;
    rows?: { t: string; temp?: number; ws?: number }[] } = await response.json();
  if (data.station?.name_en !== code || data.timeframe !== "hourly" || !Array.isArray(data.rows)) {
    throw new Error("Unexpected AQMThai station report");
  }
  let latest: Reading | undefined;
  for (const { t, temp, ws } of data.rows) {
    const date = /^(\d{4}-\d{2}-\d{2}) (\d{2}):00:00(?:\.0+)?$/.exec(t);
    if (!date) continue;
    const observedAt = `${date[1]}T${date[2]}:00:00+07:00`;
    const observed = Date.parse(observedAt);
    if (!Number.isFinite(observed) || observed > now || now - observed > 3 * 3600000 ||
        (latest && observedAt <= latest.observedAt)) continue;
    const temperatureC = typeof temp === "number" && temp >= 0 && temp <= 60 ? temp : undefined;
    const windSpeedMs = typeof ws === "number" && ws >= 0 && ws <= 100 ? ws : undefined;
    if (temperatureC !== undefined || windSpeedMs !== undefined) {
      latest = { source: "AQMThai", observedAt, temperatureC, windSpeedMs };
    }
  }
  return latest ? { [id]: latest } : {};
}

let cache: { expires: number; result: Promise<Record<string, Reading>> } | undefined;

export async function GET() {
  const now = Date.now();
  if (!cache || now >= cache.expires) {
    const batches = Array.from({ length: Math.ceil(indices.length / 8) },
      (_, i) => indices.slice(i * 8, i * 8 + 8));
    const result = Promise.allSettled([
      ...batches.map(batch => readBatch(batch, now)),
      ...aqmStations.map(station => readAqm(station, now)),
    ]).then(parts => {
      const good = parts.flatMap(part => part.status === "fulfilled" ? [part.value] : []);
      if (!good.length) throw new Error("Station weather unavailable");
      return Object.assign({}, ...good) as Record<string, Reading>;
    });
    cache = { expires: now + 5 * 60000, result };
  }
  const active = cache;
  try {
    return NextResponse.json({ stations: await active.result });
  } catch {
    if (cache === active) cache = undefined;
    return NextResponse.json({ error: "Station weather unavailable" }, { status: 502 });
  }
}
