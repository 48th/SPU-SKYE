
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AIR4THAI_URL =
  "https://air4thai.pcd.go.th/services/getNewAQI_JSON.php";

export async function GET() {
  try {
    const response = await fetch(AIR4THAI_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`Air4Thai HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!Array.isArray(data?.stations)) {
      throw new Error("รูปแบบข้อมูล Air4Thai ไม่ถูกต้อง");
    }

    const stations = data.stations
      .map((station: any) => {
        const lat = Number(station.lat);
        const lng = Number(station.long);
        const raw = station.AQILast?.PM25?.value;

        const pm25 =
          raw == null || String(raw).trim() === ""
            ? null
            : Number(raw);

        return {
          id: String(station.stationID ?? ""),
          name: String(station.nameTH ?? station.areaTH ?? ""),
          district: "",
          lat,
          lng,
          pm25:
            pm25 !== null &&
            Number.isFinite(pm25) &&
            pm25 >= 0
              ? pm25
              : null,
          
observedAt:
  station.AQILast?.date && station.AQILast?.time
    ? `${station.AQILast.date}T${station.AQILast.time}:00+07:00`
    : "",

        };
      })
      .filter(
        (s: { lat: number; lng: number }) =>
          Number.isFinite(s.lat) &&
          Number.isFinite(s.lng) &&
          s.lat >= 13.4 &&
          s.lat <= 14.1 &&
          s.lng >= 100.3 &&
          s.lng <= 100.95
      );

    return NextResponse.json({
  source: "Air4Thai",
  fetchedAt: new Date().toISOString(),
  count: stations.length,
  stations,
});

} catch (error) {
  const backend = process.env.AIR_QUALITY_BACKEND_URL;
  if (backend) {
    try {
      const response = await fetch(new URL("/api/v1/stations", backend), {
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error(`Backend HTTP ${response.status}`);
      const data: {
        fetchedAt: string;
        stations: {
          id: string; name: string; district: string | null; lat: number;
          lon: number; currentPM25: number | null; observedAt: string | null;
        }[];
      } = await response.json();
      const stations = data.stations.map((station) => ({
        id: station.id,
        name: station.name,
        district: station.district ?? "",
        lat: station.lat,
        lng: station.lon,
        pm25: station.currentPM25,
        observedAt: station.observedAt ?? "",
      }));
      return NextResponse.json({
        source: "Air4Thai",
        fetchedAt: data.fetchedAt,
        count: stations.length,
        stations,
      });
    } catch (fallbackError) {
      console.error("Air4Thai backend fallback error:", fallbackError);
    }
  }
  console.error("Air4Thai API error:", error);

  const message =
    error instanceof Error
      ? error.message
      : String(error);

  const cause =
    error instanceof Error && error.cause
      ? String(error.cause)
      : null;

  return NextResponse.json(
    {
      error: "ไม่สามารถดึงข้อมูล Air4Thai ได้",
      details: message,
      cause:
        process.env.NODE_ENV === "development"
          ? cause
          : undefined,
    },
    { status: 502 }
  );
}

}
