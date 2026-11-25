import { adminAuthError } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

function backendPath(segments: string[]): string | undefined {
  if (segments.length === 1 && (segments[0] === "forecast" || segments[0] === "evaluation")) {
    return "/api/v1/" + segments[0];
  }
  const [resource, stationId, category, forecast] = segments;
  if (segments.length === 3 && resource === "stations" && /^[a-z0-9_-]{1,64}$/i.test(stationId)
    && category === "weather") {
    return "/api/v1/stations/" + encodeURIComponent(stationId) + "/weather";
  }
  if (segments.length === 4 && resource === "stations" && /^[a-z0-9_-]{1,64}$/i.test(stationId)
    && category === "forecast" && ["hourly", "hourly-issued", "hourly-comparison", "hourly-weather-experiment"].includes(forecast)) {
    return "/api/v1/stations/" + encodeURIComponent(stationId) + "/forecast/" + forecast;
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ endpoint: string[] }> }) {
  const error = adminAuthError(request);
  if (error) return error;

  const headers = { "Cache-Control": "private, no-store" };
  const path = backendPath((await params).endpoint);
  if (!path) return new Response(null, { status: 404, headers });

  const key = process.env.SPU_ADMIN_API_KEY;
  const origin = process.env.SPU_STATION_INTERNAL_URL;
  if (!key || !origin) return new Response(null, { status: 503, headers });

  const url = new URL(path, origin);
  url.search = new URL(request.url).search;
  try {
    const result = await fetch(url, {
      headers: { "X-SPU-Admin-Key": key },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(25000)]),
    });
    return new Response(result.body, {
      status: result.status,
      headers: { ...headers, "Content-Type": result.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return Response.json({ error: "Station service unavailable" }, { status: 502, headers });
  }
}
