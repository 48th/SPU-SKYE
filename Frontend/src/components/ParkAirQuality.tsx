"use client";
import type * as GeoJSON from "geojson";


import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection } from "geojson";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import { ArrowClockwise, Bus, Car, Heart, MagnifyingGlass, NavigationArrow,
  Tree, X } from "@phosphor-icons/react";
import { AirQualityExpression } from "@/components/CivicIllustrationAssets";
import { getThaiAqiMeta } from "@/lib/forecastService";

type Station = { id: string; name: string; district: string; lat: number; lng: number; pm25: number | null; observedAt?: string; isStale?: boolean };
type Park = { id: string; name: string; district: string; lat: number; lng: number; imageUrl?: string | null; description?: string };
const PARK_PHOTOS: Record<string, { url: string; credit: string; source: string }> = {
  "park-049": {
    url: "/parks/queen-sirikit-park.jpg",
    credit: "Welcome to Thailand · CC0",
    source: "https://commons.wikimedia.org/wiki/File:Parcs_de_Chatuchak_9.jpg",
  },
};
type DailyReading = { date: string; pm25: number | null };

type Props = { stations: Station[]; lang?: "TH" | "EN" };
const FAVORITES_KEY = "spu-skye:favorite-parks";
const clean = (s: string) => String(s ?? "").replace(/^เขต/, "").trim();


const color = (value: number | null) => getThaiAqiMeta(value ?? NaN).color;

function ParkAirMood({ value }: { value: number | null }) {
  const level = value == null || !Number.isFinite(value) ? undefined : getThaiAqiMeta(value);
  if (!level) return null;
  return (
    <span className="ml-auto flex shrink-0 flex-col items-center gap-1 text-[11px] font-semibold text-slate-800">
      <AirQualityExpression pm25={value} className="h-10 w-10" />
      {level.thaiLabel}
    </span>
  );
}

const distance = (a: number, b: number, c: number, d: number) => { const r = Math.PI / 180; const x = (c - a) * r, y = (d - b) * r; const h = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2; return 12742 * Math.asin(Math.min(1, Math.sqrt(h))); };
const featureName = (p: Record<string, unknown>) =>
  clean(
    String(
      p.name_t ??
      p.district ??
      p.name_th ??
      p.dname ??
      p.NAME_TH ??
      p.name ??
      ""
    )
  );
export default function ParkAirQuality({ stations, lang = "TH" }: Props) {
  const element = useRef<HTMLDivElement>(null);
  const parkPanel = useRef<HTMLElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const districtLayer = useRef<Leaflet.GeoJSON | null>(null);
  const parkLayer = useRef<Leaflet.LayerGroup | null>(null);
  const fittedOnce = useRef(false);
  const [ready, setReady] = useState(false);
  const [boundaries, setBoundaries] = useState<FeatureCollection | null>(null);
  const [parks, setParks] = useState<Park[]>([]);
  const [liveStations, setLiveStations] = useState<Station[]>([]);
  const [stationFeedError, setStationFeedError] = useState(false);

  const [district, setDistrict] = useState<string | null>(null);
  const [showAirLayer, setShowAirLayer] = useState(true);
  const [suggestionOrder, setSuggestionOrder] = useState<"air" | "nearby">("air");
  const [park, setPark] = useState<Park | null>(null);
  useEffect(() => {
    if (!park) return;
    const panel = parkPanel.current;
    if (!panel) return;
    panel.scrollTop = 0;
    if (window.matchMedia("(max-width: 839px)").matches) {
      panel.scrollIntoView({ block: "nearest" });
    }
  }, [park]);
  const [ranking, setRanking] = useState<"low" | "high">("low");
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  type RoadRoute = { distance: number; duration: number; coordinates: [number, number][] };
  const [roadRoute, setRoadRoute] = useState<RoadRoute | null>(null);
  const [routeStatus, setRouteStatus] = useState<"idle" | "loading" | "error">("idle");
  const routeRequest = useRef<AbortController | null>(null);
  const lastRouteRequest = useRef(0);

  useEffect(() => {
    setRoadRoute(null);
    setRouteStatus("idle");
    return () => {
      routeRequest.current?.abort();
      routeRequest.current = null;
    };
  }, [park?.id, userLocation]);

  useEffect(() => {
    if (!roadRoute) return;
    let active = true;
    let routeLayer: Leaflet.Polyline | undefined;
    void import("leaflet").then(({ default: L }) => {
      if (!active || !map.current) return;
      routeLayer = L.polyline(roadRoute.coordinates.map(([lng, lat]) => [lat, lng]), {
        color: "#00796B", weight: 5, opacity: 0.88, interactive: false,
      }).addTo(map.current);
      map.current.fitBounds(routeLayer.getBounds(), { padding: [45, 45], maxZoom: 16 });
    });
    return () => { active = false; routeLayer?.remove(); };
  }, [roadRoute]);

  async function findRoadRoute() {
    if (!park || !userLocation || routeRequest.current || Date.now() - lastRouteRequest.current < 1000) return;
    const controller = new AbortController();
    routeRequest.current = controller;
    lastRouteRequest.current = Date.now();
    setRouteStatus("loading");
    setRoadRoute(null);
    try {
      const endpoint = process.env.NEXT_PUBLIC_PARK_ROUTER_URL ||
        "https://routing.openstreetmap.de/routed-car/route/v1/driving";
      const from = `${userLocation.lng.toFixed(5)},${userLocation.lat.toFixed(5)}`;
      const to = `${park.lng.toFixed(5)},${park.lat.toFixed(5)}`;
      const response = await fetch(endpoint.replace(/\/+$/, "") + "/" + from + ";" + to +
        "?overview=simplified&geometries=geojson", {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        referrerPolicy: "strict-origin-when-cross-origin",
      });
      if (!response.ok) throw new Error("Route unavailable");
      const data = await response.json();
      const route = data.routes?.[0];
      const coords: [number, number][] | undefined = route?.geometry?.coordinates;
      if (data.code !== "Ok" || !Number.isFinite(route?.distance) || route.distance < 0 ||
          !Number.isFinite(route.duration) || route.duration < 0 || !Array.isArray(coords) ||
          coords.length < 2 || !coords.every(point =>
            Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))) {
        throw new Error("Invalid route");
      }
      if (!controller.signal.aborted) {
        setRoadRoute({ distance: route.distance, duration: route.duration, coordinates: coords });
        setRouteStatus("idle");
      }
    } catch {
      if (!controller.signal.aborted) setRouteStatus("error");
    } finally {
      if (routeRequest.current === controller) routeRequest.current = null;
    }
  }

  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");

  const userMarker = useRef<Leaflet.CircleMarker | null>(null);
  const [search, setSearch] = useState("");
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const favoritesPanel = useRef<HTMLDetailsElement>(null);
  const [favoritesReady, setFavoritesReady] = useState(false);
  const [favoritesStorageError, setFavoritesStorageError] = useState(false);

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]");
      if (Array.isArray(saved)) {
        setFavoriteIds([...new Set(saved.filter((id): id is string => typeof id === "string"))]);
      }
    } catch {
      setFavoritesStorageError(true);
    } finally {
      setFavoritesReady(true);
    }
  }, []);

  useEffect(() => {
    if (!favoritesReady || favoritesStorageError) return;
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteIds));
    } catch {
      setFavoritesStorageError(true);
    }
  }, [favoriteIds, favoritesReady, favoritesStorageError]);

  const toggleFavorite = (id: string) => {
    setFavoriteIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);
  };

  const [error, setError] = useState("");



  useEffect(() => {
    let cancelled = false;

    async function loadAirQuality() {
      try {
        let readings: Station[];
        try {
          const origin = (process.env.NEXT_PUBLIC_STATION_API_URL ||
            "http://127.0.0.1:8001").replace(/\/+$/, "");
          const response = await fetch(origin + "/api/v1/stations", {
            cache: "no-store", signal: AbortSignal.timeout(8000),
          });
          if (!response.ok) throw new Error(`Station service HTTP ${response.status}`);
          const data = await response.json();
          if (!Array.isArray(data.stations)) throw new Error("Invalid station response");
          readings = data.stations.map(({
            lon, currentPM25, ...station
          }: Omit<Station, "lng" | "pm25"> & { lon: number; currentPM25: number | null }) =>
            ({ ...station, lng: lon, pm25: currentPM25 }));
        } catch {
          if (cancelled) return;
          const response = await fetch("/api/air-quality", {
            cache: "no-store", signal: AbortSignal.timeout(12000),
          });
          if (!response.ok) throw new Error(`Air quality HTTP ${response.status}`);
          const data = await response.json();
          if (!Array.isArray(data.stations)) throw new Error("Invalid station response");
          readings = data.stations;
        }
        if (!cancelled) {
          setLiveStations(readings);
          setStationFeedError(false);
        }
      } catch {
        if (!cancelled) setStationFeedError(true);
      }
    }

    loadAirQuality();

    const timer = setInterval(loadAirQuality, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);


  const valid = useMemo(() => {
    if (!boundaries) return [];

    // รวมข้อมูลที่ส่งมาจากหน้าอื่นกับข้อมูล API
    const allStations = [...stations, ...liveStations];

    // ป้องกันสถานีเดียวกันถูกนับซ้ำ
    const unique = new Map<string, Station>();

    for (const station of allStations) {
      if (
        !Number.isFinite(station.lat) ||
        !Number.isFinite(station.lng) ||
        typeof station.pm25 !== "number" ||
        !Number.isFinite(station.pm25) ||
        station.pm25 < 0 ||
        station.isStale
      ) {
        continue;
      }

      // ข้อมูลจาก API ต้องมีเวลาที่ตรวจวัด
      if (!station.observedAt?.trim()) {
        continue;
      }

      const key = station.id.trim().toUpperCase();
      if (!key) continue;

      unique.set(key, station);
    }

    const result: Station[] = [];

    for (const station of unique.values()) {
      const location = point([station.lng, station.lat]);

      const matchedFeature = boundaries.features.find((feature) => {
        if (
          feature.geometry?.type !== "Polygon" &&
          feature.geometry?.type !== "MultiPolygon"
        ) {
          return false;
        }

        return booleanPointInPolygon(
          location,
          feature as GeoJSON.Feature<
            GeoJSON.Polygon | GeoJSON.MultiPolygon
          >
        );
      });

      if (!matchedFeature) continue;

      const districtName = featureName(
        (matchedFeature.properties ?? {}) as Record<string, unknown>
      );

      if (!districtName) continue;

      result.push({
        ...station,
        district: districtName,
      });
    }

    return result;
  }, [stations, liveStations, boundaries]);



  const stats = useMemo(() => {
    const groups = new Map<string, number[]>();

    for (const s of valid) {
      const k = clean(s.district);
      groups.set(k, [
        ...(groups.get(k) ?? []),
        s.pm25!,
      ]);
    }

    return new Map(
      [...groups].map(([k, values]) => [
        k,
        {
          pm25: values.reduce((a, b) => a + b, 0) / values.length,
          count: values.length,
        },
      ])
    );
  }, [valid]);

  const selectedDistrictStats = useMemo(() => {
    if (!district) return null;

    const data = stats.get(clean(district));

    const districtStations = valid.filter(
      (station) => clean(station.district) === clean(district)
    );

    const timestamps = districtStations
      .map((station) => Date.parse(station.observedAt ?? ""))
      .filter((time) => Number.isFinite(time));

    return {
      name: district,
      pm25: data?.pm25 ?? null,
      count: data?.count ?? 0,
      latestObservedAt:
        timestamps.length > 0
          ? new Date(Math.max(...timestamps)).toLocaleString("th-TH", {
            timeZone: "Asia/Bangkok",
            dateStyle: "medium",
            timeStyle: "short",
          })
          : null,
    };
  }, [district, stats, valid]);


  // ✅ จุดที่ 3 วางตรงนี้
  useEffect(() => {
    const numericStations = liveStations.filter(
      (s) => typeof s.pm25 === "number" &&
        Number.isFinite(s.pm25) &&
        s.pm25 >= 0
    );

    console.log("สถานีจาก API:", liveStations.length);
    console.table(
      liveStations.slice(0, 5).map((s) => ({
        id: s.id,
        name: s.name,
        lat: s.lat,
        lng: s.lng,
        pm25: s.pm25,
        observedAt: s.observedAt,
        isStale: s.isStale,
      }))
    );
    console.log("สถานีที่มีค่า PM2.5:", numericStations.length);
    console.log("สถานีที่ผ่านการจับคู่เขต:", valid.length);

    console.table(
      [...stats.entries()].map(([district, data]) => ({
        district,
        pm25: data.pm25.toFixed(1),
        stations: data.count,
      }))
    );
  }, [liveStations, valid, stats]);


  const visible = useMemo(() => parks.filter(p => (!district || clean(p.district) === district) && p.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [parks, district, search]);
  const favoriteParks = useMemo(() => parks.filter(item => favoriteIds.includes(item.id)), [parks, favoriteIds]);
  const closestByPark = useMemo(() => {
    const closest = new Map<string, { station: Station; km: number }>();
    for (const item of parks) {
      for (const station of valid) {
        const km = distance(item.lat, item.lng, station.lat, station.lng);
        if (km < (closest.get(item.id)?.km ?? Infinity)) closest.set(item.id, { station, km });
      }
    }
    return closest;
  }, [parks, valid]);
  const nearest = park ? closestByPark.get(park.id) ?? null : null;
  const historyStation = nearest?.station.id;
  const [parkHistory, setParkHistory] = useState<{ station: string; points: DailyReading[] } | null>(null);
  useEffect(() => {
    if (!historyStation) return;
    const controller = new AbortController();
    const origin = (process.env.NEXT_PUBLIC_STATION_API_URL || "http://127.0.0.1:8001").replace(/\/+$/, "");
    void (async () => {
      try {
        const response = await fetch(origin + "/api/v1/stations/" +
          encodeURIComponent(historyStation) + "/history/daily", {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        });
        if (!response.ok) throw new Error("Daily history unavailable");
        const { points }: { points: DailyReading[] } = await response.json();
        if (!Array.isArray(points)) throw new Error("Invalid history response");
        if (!controller.signal.aborted) setParkHistory({ station: historyStation, points });
      } catch {
        if (!controller.signal.aborted) setParkHistory({ station: historyStation, points: [] });
      }
    })();
    return () => controller.abort();
  }, [historyStation]);
  const history = parkHistory?.station === historyStation ? parkHistory?.points ?? [] : [];
  const hasHistory = history.some(point => point.pm25 != null);
  const historyMax = Math.max(10, ...history.map(point => point.pm25 ?? 0));

  const groupsByLowPm25 = useMemo(() => {
    const groups = new Map<string, { station: Station; parks: { park: Park; km: number }[] }>();
    for (const item of visible) {
      const reference = closestByPark.get(item.id);
      if (!reference) continue;
      const { station, km } = reference;
      let group = groups.get(station.id);
      if (!group) {
        group = { station, parks: [] };
        groups.set(station.id, group);
      }
      group.parks.push({ park: item, km });
    }
    return [...groups.values()].sort((a, b) =>
      a.station.pm25! - b.station.pm25! || a.station.name.localeCompare(b.station.name, "th")
    ).map(group => ({
      ...group, parks: group.parks.sort((a, b) => a.km - b.km || a.park.name.localeCompare(b.park.name, "th")),
    }));
  }, [closestByPark, visible]);
  const rankedGroups = (ranking === "low" ? groupsByLowPm25 : [...groupsByLowPm25].reverse()).slice(0, 10);
  const nearbySuggestions = useMemo(() => {
    if (!userLocation) return [];
    return visible.map(item => ({
      item, userKm: distance(userLocation.lat, userLocation.lng, item.lat, item.lng),
      reference: closestByPark.get(item.id),
    })).sort((a, b) => a.userKm - b.userKm).slice(0, 3);
  }, [userLocation, visible, closestByPark]);
  const suggestions = suggestionOrder === "nearby" ? nearbySuggestions
    : groupsByLowPm25.slice(0, 3).map(({ station, parks: [closestPark] }) => ({
      item: closestPark.park, userKm: null,
      reference: { station, km: closestPark.km },
    }));
  useEffect(() => {
    async function loadData() {
      try {
        const response = await fetch(
          "/data/bangkok-districts.geojson"
        );

        if (!response.ok) {
          throw new Error("ไม่พบไฟล์ GeoJSON");
        }

        const geojson = await response.json();

        if (geojson.type !== "FeatureCollection") {
          throw new Error("GeoJSON ไม่ใช่ FeatureCollection");
        }

        setBoundaries(geojson);
        setError("");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "โหลดแผนที่ไม่สำเร็จ"
        );
      }


      try {
        const response = await fetch("/data/bangkok-parks.json");

        if (!response.ok) {
          throw new Error(`โหลดข้อมูลสวนไม่สำเร็จ: ${response.status}`);
        }

        const data: unknown = await response.json();

        if (!Array.isArray(data)) {
          throw new Error("ข้อมูลสวนต้องเป็น Array");
        }

        const validParks: Park[] = data
          .filter((item): item is Park => {
            return (
              item !== null &&
              typeof item === "object" &&
              typeof item.id === "string" &&
              typeof item.name === "string" &&
              typeof item.district === "string" &&
              typeof item.lat === "number" &&
              typeof item.lng === "number" &&
              Number.isFinite(item.lat) &&
              Number.isFinite(item.lng) &&
              item.lat >= 13 &&
              item.lat <= 15 &&
              item.lng >= 99 &&
              item.lng <= 102
            );
          })
          .map((item) => ({
            ...item,
            district: clean(item.district),
          }));

        setParks(validParks);

        console.log("🌳 จำนวนสวนทั้งหมด:", validParks.length);
        console.log("🌳 ตัวอย่างข้อมูลสวน:", validParks.slice(0, 5));

      } catch (err) {
        console.error("โหลดข้อมูลสวนไม่สำเร็จ:", err);
        setParks([]);
      }

    }

    loadData();
  }, []);


  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;

    import("leaflet").then(({ default: L }) => {
      if (cancelled || !element.current || map.current) return;



      const instance = L.map(element.current, {
        center: [13.7563, 100.5018],
        zoom: 10,
        zoomControl: true,
        scrollWheelZoom: true,

        zoomAnimation: true,
        fadeAnimation: true,
        markerZoomAnimation: true,

        zoomSnap: 1,
        zoomDelta: 1,
        maxZoom: L.Browser.retina ? 18 : 19,
        wheelPxPerZoomLevel: 100,
      });






      L.tileLayer(process.env.NEXT_PUBLIC_PARK_MAP_TILES ||
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
        detectRetina: true,
      }).addTo(instance);

      map.current = instance;
      setReady(true);

      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
          if (!cancelled) instance.invalidateSize({ pan: false });
        });
        resizeObserver.observe(instance.getContainer());
      }
    });
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();

      map.current?.remove();
      map.current = null;
    };
  }, []);




  useEffect(() => {
    if (!ready || !boundaries || !map.current) return;

    let cancelled = false;

    import("leaflet").then(({ default: L }) => {
      if (cancelled || !map.current) return;

      const currentMap = map.current;

      districtLayer.current?.remove();

      const layer = L.geoJSON(boundaries, {


        style: (feature) => {
          const name = featureName(
            (feature?.properties ?? {}) as Record<string, unknown>
          );

          const isSelected = district === name;
          const isDimmed = district !== null && !isSelected;
          const pm25 = stats.get(name)?.pm25 ?? null;

          return {
            // สีของพื้นที่
            fillColor: isDimmed
              ? "#E4E9ED"
              : color(pm25),

            // Keep roads and place names visible under the air quality layer.
            fillOpacity: showAirLayer ? (isSelected ? 0.3 : isDimmed ? 0.1 : 0.24) : 0,
            // เส้นแบ่งเขตบาง ๆ แบบ Minimal
            stroke: true,
            color: isSelected ? "#00796B" : "#64748B",
            weight: isSelected ? 1.6 : 0.7,
            opacity: isSelected ? 0.8 : 0.65,

            // ทำให้รอยต่อเส้นดูนุ่มขึ้น
            lineCap: "round" as const,
            lineJoin: "round" as const,
            smoothFactor: 0,

            // ให้คลิกเลือกเขตได้เหมือนเดิม
            interactive: true,
          };
        },



        onEachFeature: (feature, layer) => {
          const name = featureName(
            (feature.properties ?? {}) as Record<string, unknown>
          );

          const stationData = stats.get(name);

          layer.bindTooltip(
            `เขต${name}: ${stationData
              ? stationData.pm25.toFixed(1) + " µg/m³"
              : "ไม่มีข้อมูล"
            }`
          );


          layer.on("click", () => {
            // Remove the mouse-focus rectangle from the clicked district SVG.
            const svgPath = (layer as Leaflet.Polygon).getElement();
            if (svgPath instanceof HTMLElement || svgPath instanceof SVGSVGElement) {
              svgPath.blur();
            }
            setDistrict(name);
            setPark(null);

            // ซูมเข้าไปยังเขตที่เลือก
            if (layer instanceof L.Polygon) {
              currentMap.fitBounds(layer.getBounds(), {
                padding: [60, 60],
                maxZoom: 13,
                animate: true,
                duration: 0.7,
              });
            }
          });

        },
      }).addTo(currentMap);

      districtLayer.current = layer;

      if (!fittedOnce.current && layer.getBounds().isValid()) {
        currentMap.invalidateSize();

        currentMap.fitBounds(layer.getBounds(), {
          padding: [30, 30],
          maxZoom: 11,
        });

        fittedOnce.current = true;
      }
    });

    return () => {
      cancelled = true;
    };
  }, [ready, boundaries, stats, district, showAirLayer]);


  useEffect(() => {
    if (!ready || !map.current) return;
    let cancelled = false;
    import("leaflet").then(({ default: L }) => {
      if (cancelled || !map.current) return;
      parkLayer.current?.remove();
      const group = L.layerGroup().addTo(map.current);

      
for (const p of visible) {
  const isSelected = park?.id === p.id;
  const isDimmed = park !== null && !isSelected;

  const size = isSelected ? 23 : 9;
  const fill = isSelected ? "#005A50" : "#15816B";

  const treeIcon = L.divIcon({
    html: `
      <div style="
        width: ${size}px;
        height: ${size}px;
        box-sizing: border-box;
        background: ${fill};
        border: ${isSelected ? 3 : 1}px solid #FFFFFF;
        border-radius: 50%;
        opacity: ${isDimmed ? 0.25 : 1};
        box-shadow: ${
          isSelected
            ? "0 0 0 5px rgba(16,185,129,0.18), 0 4px 12px rgba(0,0,0,0.2)"
            : "0 1px 5px rgba(0,0,0,0.15)"
        };
        cursor: pointer;
      "></div>
    `,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });

  L.marker([p.lat, p.lng], { icon: treeIcon, title: p.name, alt: p.name, zIndexOffset: isSelected ? 500 : 0 })
    .bindTooltip(p.name)
    .on("click", () => {
      setPark(p);
      map.current?.flyTo([p.lat, p.lng], 14, {
        duration: 0.8,
      });
    })
    .addTo(group);
}


      parkLayer.current = group;
    });
    return () => { cancelled = true; };
  }, [ready, visible, park]);


  const locateMe = () => {
    if (!navigator.geolocation) {
      setLocationError("เบราว์เซอร์ไม่รองรับ GPS");
      return;
    }

    setLocating(true);
    setLocationError("");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        setUserLocation({ lat, lng });
        setLocating(false);

        if (!map.current) return;

        import("leaflet").then(({ default: L }) => {
          if (!map.current) return;

          // ลบหมุดตำแหน่งเดิม
          userMarker.current?.remove();

          // เพิ่มหมุดสีน้ำเงิน
          userMarker.current = L.circleMarker([lat, lng], {
            radius: 9,
            color: "#FFFFFF",
            weight: 3,
            fillColor: "#2563EB",
            fillOpacity: 1,
          })
            .bindTooltip("ตำแหน่งของฉัน")
            .addTo(map.current);

          // ซูมเข้าตำแหน่งปัจจุบัน
          map.current.flyTo([lat, lng], 15, {
            duration: 1.2,
          });
        });
      },
      (error) => {
        setLocating(false);

        if (error.code === 1) {
          setLocationError("กรุณาอนุญาตให้เว็บไซต์เข้าถึงตำแหน่ง");
        } else if (error.code === 2) {
          setLocationError("ไม่สามารถตรวจหาตำแหน่งได้");
        } else {
          setLocationError("ค้นหาตำแหน่งไม่สำเร็จ กรุณาลองอีกครั้ง");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 30000,
      }
    );
  };


  return <section id="main-content" className="bangkok-ui-font mx-auto max-w-[1440px] space-y-4 px-3 pb-4 pt-1 sm:space-y-5 sm:px-6 sm:py-7 lg:px-7">
    <style>{`
      .parks-layout {
        --park-map-height: clamp(340px, 63dvh, 590px);
      }
      .parks-layout .park-air-map {
        height: var(--park-map-height);
      }
      .parks-side {
        border-top: 1px solid #d9e5df;
        scroll-margin-top: 12px;
      }
      .park-air-map .leaflet-control-zoom a {
        width: 39px;
        height: 39px;
        line-height: 39px;
      }
      @media (min-width: 600px) {
        .parks-layout { --park-map-height: clamp(400px, 58dvh, 560px); }
      }
      @media (min-width: 840px) {
        .parks-layout {
          --park-map-height: clamp(390px, 67dvh, 660px);
          grid-template-columns: minmax(0, 1fr) minmax(300px, 32%);
          align-items: start;
        }
        .parks-side {
          border-top: 0;
          border-left: 1px solid #d9e5df;
          max-height: calc(var(--park-map-height) + 90px);
          overflow-y: auto;
          overscroll-behavior-y: contain;
        }
      }
      /* Leaflet SVG districts: no rectangular outline after a mouse click. */
      .park-air-map path.leaflet-interactive:focus:not(:focus-visible) {
        outline: none !important;
      }
    `}</style>
    
<h1 className="sr-only">{lang === "TH" ? "สำรวจสวนกรุงเทพฯ" : "Explore Bangkok parks"}</h1>



{error && (
  <div
    role="alert"
    className="flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-700"
  >
    <span className="text-lg">⚠️</span>
    <p className="min-w-0 flex-1">{error}</p>
  </div>
)}


    <div className="parks-layout isolate grid overflow-hidden rounded-[1.25rem] border border-[#d9e5df] bg-white shadow-[0_8px_30px_#254a3610] sm:rounded-[1.5rem]">
      <div className="relative min-w-0 overflow-hidden">
  <details ref={favoritesPanel} className="absolute right-3 top-[4.4rem] z-[1100]">
    <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl border border-[#d9e5df] bg-white px-3 py-2 text-sm font-semibold text-[#005A50] shadow-sm hover:bg-emerald-50 [&::-webkit-details-marker]:hidden">
      <Heart size={18} weight={favoriteParks.length ? "fill" : "regular"} aria-hidden />
      สวนที่ชื่นชอบ
      {favoriteParks.length > 0 && <span className="tabular-nums">{favoriteParks.length}</span>}
    </summary>
    <div className="absolute right-0 top-full mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-[#d9e5df] bg-white p-3 shadow-xl">
      {!favoriteParks.length ? (
        <p className="p-2 text-sm text-slate-600">
          {!favoritesReady || favoriteIds.length ? "กำลังโหลดสวนที่บันทึกไว้" : "กดหัวใจที่สวนเพื่อบันทึกไว้ที่นี่"}
        </p>
      ) : (
        <ul className="max-h-[38dvh] divide-y divide-slate-100 overflow-auto">
          {favoriteParks.map(item => (
            <li key={item.id} className="flex items-center gap-2 py-1">
              <button type="button" className="min-w-0 flex-1 rounded-lg p-2 text-left hover:bg-emerald-50"
                onClick={() => {
                  setPark(item);
                  setSearch("");
                  if (district !== clean(item.district)) setDistrict(null);
                  if (favoritesPanel.current) favoritesPanel.current.open = false;
                  map.current?.flyTo([item.lat, item.lng], 14, { duration: 0.8 });
                }}>
                <span className="block font-semibold text-slate-900">{item.name}</span>
                <span className="text-xs text-slate-600">เขต{clean(item.district)}</span>
              </button>
              <button type="button" onClick={() => toggleFavorite(item.id)}
                aria-label={"เอาออกจากสวนที่ชื่นชอบ " + item.name}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#005A50] hover:bg-emerald-50">
                <Heart size={19} weight="fill" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {favoritesStorageError && <p role="status" className="p-2 text-sm text-amber-700">
        เบราว์เซอร์ไม่สามารถบันทึกรายการข้ามการเปิดหน้าได้
      </p>}
    </div>
  </details>


        <div className="absolute left-[3.25rem] right-[3.85rem] top-3 z-[1000] flex min-w-0 gap-1 rounded-2xl bg-white/95 p-1 shadow-md backdrop-blur sm:right-auto sm:w-[min(20rem,calc(100%_-_8rem))] sm:gap-2">
          <select
            aria-label="เลือกเขตกรุงเทพมหานคร"
            value={district ?? ""}
            onChange={(e) => {
              const name = e.target.value;

              setDistrict(name || null);
              setPark(null);

              if (!name) {
                const bounds = districtLayer.current?.getBounds();

                if (bounds?.isValid()) {
                  map.current?.fitBounds(bounds, {
                    padding: [30, 30],
                    maxZoom: 11,
                  });
                }
                return;
              }

              districtLayer.current?.eachLayer((layer) => {
                const polygon = layer as Leaflet.Polygon & {
                  feature?: GeoJSON.Feature;
                };

                const feature = polygon.feature;
                if (!feature) return;

                const layerName = featureName(
                  (feature.properties ?? {}) as Record<string, unknown>
                );

                if (layerName === name) {
                  map.current?.fitBounds(polygon.getBounds(), {
                    padding: [60, 60],
                    maxZoom: 13,
                  });
                }
              });
            }}
            className="min-h-11 min-w-0 flex-1 truncate rounded-xl bg-slate-100 px-2 text-sm text-slate-900 sm:px-3"
          >
            <option value="">ทุกเขตกรุงเทพมหานคร</option>

            {boundaries?.features
              .map((feature) =>
                featureName(
                  (feature.properties ?? {}) as Record<string, unknown>
                )
              )
              .filter(Boolean)
              .sort((a, b) => a.localeCompare(b, "th"))
              .map((name) => (
                <option key={name} value={name}>
                  เขต{name}
                </option>
              ))}
          </select>

          <button
            type="button"
            title="รีเฟรชแผนที่"
            onClick={() => {
              setDistrict(null);
              setPark(null);
              setSearch("");

              const bounds = districtLayer.current?.getBounds();

              if (bounds?.isValid()) {
                map.current?.fitBounds(bounds, {
                  padding: [30, 30],
                  maxZoom: 11,
                  animate: true,
                });
              }
            }}
            className="grid h-11 w-10 shrink-0 place-items-center rounded-xl text-[#005A50] hover:bg-slate-100"
          >
            <ArrowClockwise size={19} aria-hidden />
          </button>

        </div>

        <div className="relative">
          <div
            ref={element}
            className="park-air-map w-full bg-[#e8eeeb]"
          />

          <button
            type="button"
            onClick={locateMe}
            disabled={locating}
            title="ค้นหาตำแหน่งปัจจุบัน"
            className="absolute right-2 top-3 z-[1000] sm:right-4
      flex h-11 w-11 items-center justify-center
      rounded-xl border border-slate-200 bg-white
      text-[#005A50] shadow-md transition
      hover:bg-blue-50 disabled:opacity-50"
          >
            {locating ? (
              <span className="animate-spin">◌</span>
            ) : (
              <NavigationArrow size={21} weight="fill" aria-hidden />
            )}
          </button>

          {locationError && (
            <div className="absolute bottom-4 left-4 right-4 z-[1000]
      rounded-xl bg-white p-3 text-sm text-red-600 shadow-lg">
              {locationError}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[#d9e5df] bg-white px-3 py-2.5">
          <div role="group" aria-label="ชั้นแผนที่" className="inline-flex rounded-lg bg-[#edf3ef] p-0.5">
            {[true, false].map(show => (
              <button key={String(show)} type="button" aria-pressed={showAirLayer === show}
                onClick={() => setShowAirLayer(show)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${showAirLayer === show
                  ? "bg-white text-[#005A50] shadow-sm" : "text-slate-600"}`}>
                {show ? "แผนที่ฝุ่น" : "แผนที่สวน"}
              </button>
            ))}
          </div>
          {showAirLayer && (
            <details className="text-xs text-slate-700">
              <summary className="cursor-pointer rounded-md px-2 py-1.5 font-semibold text-[#005A50] hover:bg-emerald-50">
                เกณฑ์สี PM2.5
              </summary>
              <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1.5 px-2 pb-1 sm:grid-cols-3" aria-label="ระดับ PM2.5 หน่วยไมโครกรัมต่อลูกบาศก์เมตร">
                {([
                  [15, "0–15"], [25, "มากกว่า 15–25"], [37.5, "มากกว่า 25–37.5"],
                  [75, "มากกว่า 37.5–75"], [76, "มากกว่า 75"], [null, "ไม่มีข้อมูล"],
                ] as const).map(([value, label]) => (
                  <li key={label} className="flex items-center gap-1.5">
                    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color(value) }} />
                    {label}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
      
<aside ref={parkPanel} className="parks-side min-w-0 space-y-4 bg-white p-4 sm:p-5">
  {/* PARK LIST */}




  {!district && !search.trim() && !park && (
    <section className="space-y-3 border-t border-[#e3ebe6] pt-4" aria-labelledby="park-suggestions-heading">
      <h2 id="park-suggestions-heading" className="text-base font-bold text-slate-900">สำรวจสวน</h2>
      <div role="group" aria-label="เลือกสวนแนะนำ" className="grid grid-cols-2 gap-1 rounded-xl bg-[#edf3ef] p-1">
        {(["air", "nearby"] as const).map(order => (
          <button key={order} type="button" aria-pressed={suggestionOrder === order}
            onClick={() => setSuggestionOrder(order)}
            className={`rounded-lg px-2 py-2 text-sm font-semibold ${suggestionOrder === order
              ? "bg-white text-[#005A50] shadow-sm" : "text-slate-600"}`}>
            {order === "air" ? "ใกล้สถานีฝุ่นต่ำ" : "ใกล้ฉัน"}
          </button>
        ))}
      </div>
      {suggestionOrder === "nearby" && !userLocation ? (
        <div className="rounded-2xl border border-[#dbe8e0] bg-[#f5f9f6] p-4">
          <p className="text-sm text-slate-700">ใช้ตำแหน่งของคุณเพื่อหาสวนที่อยู่ใกล้ที่สุด</p>
          <button type="button" onClick={locateMe} disabled={locating}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#005A50] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
            <NavigationArrow size={16} aria-hidden /> {locating ? "กำลังหาตำแหน่ง…" : "ใช้ตำแหน่งปัจจุบัน"}
          </button>
        </div>
      ) : suggestions.length ? (
        <ul className="space-y-2">
          {suggestions.map(({ item, userKm, reference }, index) => {
            const photo = PARK_PHOTOS[item.id];
            const featured = index === 0;
            return (
            <li key={item.id} className={featured ? "overflow-hidden rounded-2xl border border-[#dbe8e0] bg-[#f1f8f1]" : ""}>
              <button type="button"
                className={`block w-full text-left transition hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 ${featured
                  ? "" : "rounded-2xl border border-[#dbe8e0] bg-[#f7faf8]"}`}
                onClick={() => {
                  setPark(item);
                  map.current?.flyTo([item.lat, item.lng], 14, { duration: 0.8 });
                }}>
                {featured && photo && <img src={photo.url} alt={item.name}
                  width={960} height={720} className="h-36 w-full object-cover sm:h-40" />}
                <span className="flex w-full items-start gap-3 p-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-[#005A50]">
                  <Tree size={19} weight="duotone" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block font-bold text-[#005A50] ${featured ? "text-base" : "text-sm"}`}>{item.name}</span>
                  {userKm !== null && <span className="mt-1 block text-xs text-slate-700">
                    ห่างจากคุณ {userKm.toFixed(2)} กม. ทางตรง
                  </span>}
                  {reference && <span className="mt-1 block text-xs text-slate-600">
                    สถานี {reference.station.name} · {reference.km.toFixed(2)} กม. จากสวน
                  </span>}
                  {reference?.station.observedAt && <time className="mt-1 block text-xs text-slate-600" dateTime={reference.station.observedAt}>
                    {new Date(reference.station.observedAt).toLocaleTimeString("th-TH", {
                      hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok",
                    })} น.
                  </time>}
                </span>
                {reference && <span className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold tabular-nums text-slate-950"
                    style={{ backgroundColor: getThaiAqiMeta(reference.station.pm25 ?? NaN).bgTint }}>
                  {reference.station.pm25?.toFixed(1)} µg/m³
                </span>}
                </span>
                {featured && <span className="block px-3 pb-3 text-xs font-semibold text-[#005A50]">ดูบนแผนที่ →</span>}
              </button>
              {featured && photo && <a href={photo.source} target="_blank" rel="noreferrer"
                className="block px-3 pb-2 text-[11px] text-slate-600 underline">{photo.credit}</a>}
            </li>
            );
          })}
        </ul>
      ) : (
        <p role="status" className="text-sm text-slate-600">ยังไม่มีข้อมูลสวนในรายการนี้</p>
      )}
      {suggestionOrder === "air" && suggestions.length > 0 &&
        <a href="#park-air-ranking-title" className="inline-block text-sm font-semibold text-[#005A50] hover:underline">
          ดู 10 อันดับทั้งหมด <span aria-hidden>↓</span>
        </a>}
    </section>
  )}

  {selectedDistrictStats && !park && (
    <section className="space-y-4" aria-labelledby="selected-district-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="selected-district-heading" className="text-xl font-bold text-slate-900">เขต{selectedDistrictStats.name}</h2>
        <button type="button" onClick={() => {
          setDistrict(null);
          setSearch("");
          const bounds = districtLayer.current?.getBounds();
          if (bounds?.isValid()) map.current?.fitBounds(bounds, { padding: [30, 30], maxZoom: 11 });
        }} className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
          ดูทุกเขต
        </button>
      </div>
      <div className="rounded-2xl bg-slate-50 p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color(selectedDistrictStats.pm25) }} />
          PM2.5 เฉลี่ยของเขต
        </p>
        <p className="mt-2 text-3xl font-bold tabular-nums text-slate-900">
          {selectedDistrictStats.pm25 === null ? "—" : selectedDistrictStats.pm25.toFixed(1)}
          <span className="ml-2 text-sm font-medium text-slate-600">µg/m³</span>
        </p>
        <p className="mt-2 text-xs text-slate-600">{selectedDistrictStats.count
          ? `เฉลี่ยจาก ${selectedDistrictStats.count} สถานีตรวจวัดภายในเขต`
          : stationFeedError ? "เชื่อมต่อข้อมูลสถานีไม่ได้ชั่วคราว" : "ไม่มีค่าตรวจวัดในเขตนี้"}</p>
        {selectedDistrictStats.latestObservedAt && <p className="mt-1 text-xs text-slate-600">
          Air4Thai · {selectedDistrictStats.latestObservedAt}
        </p>}
      </div>
    </section>
  )}

  {!park && (
  <section className="space-y-3" aria-labelledby="park-search-heading">
    <div className="flex items-center justify-between gap-2">
      <h2 id="park-search-heading" className="text-lg font-bold text-slate-900">
        {district ? "สวนในเขตนี้" : search.trim() ? "ผลการค้นหาสวน" : "ค้นหาสวน"}
      </h2>
      {(district || search.trim()) && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
        {visible.length} แห่ง
      </span>}
    </div>

    <div className="relative">
      <MagnifyingGlass size={18} weight="bold" aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#005A50]" />
    <input
      aria-label="ค้นหาสวนสาธารณะ"
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      placeholder="ค้นหาชื่อสวน..."
      className="w-full rounded-xl bg-[#edf3ef] py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
    />
    </div>
    {(district || search.trim()) && <div className="max-h-80 space-y-2 overflow-y-auto p-1">
      {!visible.length && <p className="px-2 py-4 text-sm text-slate-600">ไม่พบสวนที่ตรงกับคำค้น</p>}

      {visible.map((p) => {
        const saved = favoriteIds.includes(p.id);
        return (
          <div key={p.id} className="relative">
          <button
            type="button"
            onClick={() => {
              setPark(p);
              map.current?.flyTo([p.lat, p.lng], 14, {
                duration: 0.8,
              });
            }}
            className="flex w-full min-w-0 items-center gap-3 rounded-2xl border border-slate-100 bg-white py-3 pl-3 pr-12 text-left transition hover:border-emerald-200 hover:bg-emerald-50"
          >
            {p.imageUrl ? (
              <img
                src={p.imageUrl}
                alt={p.name}
                className="h-14 w-14 shrink-0 rounded-xl object-cover"
              />
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-[#005A50]">
                <Tree size={21} weight="fill" aria-hidden />
              </span>
            )}

            <span className="min-w-0 flex-1">
              <strong className="block break-words text-sm font-semibold text-slate-900">
                {p.name}
              </strong>
              <small className="mt-1 block text-xs text-slate-500">
                เขต{clean(p.district)}
              </small>
            </span>

          </button>
          <button type="button" aria-pressed={saved} disabled={!favoritesReady}
            aria-label={"บันทึกสวนที่ชื่นชอบ " + p.name}
            onClick={() => toggleFavorite(p.id)}
            className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-[#005A50] hover:bg-emerald-100">
            <Heart size={20} weight={saved ? "fill" : "regular"} aria-hidden />
          </button>
          </div>
        );
      })}
    </div>}
  </section>
  )}

  {/* SELECTED PARK DETAILS */}
  {park && (
    <div className="space-y-4 border-t border-slate-100 pt-5">
      {park.imageUrl && (
        <img
          src={park.imageUrl}
          alt={park.name}
          className="h-44 w-full rounded-2xl object-cover"
        />
      )}

      <div>
        <div className="flex items-start justify-between gap-2">
          <h3 className="mt-1 break-words text-lg font-bold text-slate-900">{park.name}</h3>
          <button type="button" disabled={!favoritesReady} aria-pressed={favoriteIds.includes(park.id)}
            aria-label={"บันทึกสวนที่ชื่นชอบ " + park.name}
            onClick={() => toggleFavorite(park.id)}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-50 text-[#005A50] hover:bg-emerald-100">
            <Heart size={21} weight={favoriteIds.includes(park.id) ? "fill" : "regular"} aria-hidden />
          </button>
          <button type="button" onClick={() => setPark(null)} aria-label="ปิดรายละเอียดสวน"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-600 hover:bg-slate-100">
            <X size={19} aria-hidden />
          </button>
        </div>
      </div>

      {park.description && (
        <p className="text-sm leading-6 text-slate-600">
          {park.description}
        </p>
      )}

      {nearest ? (
        <div className="rounded-2xl border p-4" style={{ backgroundColor: "color-mix(in srgb, " + getThaiAqiMeta(nearest.station.pm25 ?? NaN).bgTint + " 64%, white)", borderColor: color(nearest.station.pm25) + "40" }}>
          <p className="text-xs font-medium text-slate-800">
            PM2.5 จากสถานีใกล้สวน
          </p>
          <div className="mt-2 flex items-center gap-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums text-slate-950">{nearest.station.pm25?.toFixed(1)}</span>
              <span className="text-sm text-slate-900">µg/m³</span>
            </div>
            <ParkAirMood value={nearest.station.pm25} />
          </div>
          <p className="mt-2 text-xs text-slate-700">{nearest.station.name} · ห่าง {nearest.km.toFixed(2)} กม.</p>
          {nearest.station.observedAt && (
            <time className="mt-1 block text-xs text-slate-600" dateTime={nearest.station.observedAt}>
              {new Date(nearest.station.observedAt).toLocaleString("th-TH", {
                day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok",
              })} น.
            </time>
          )}
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          ไม่มีข้อมูลสถานีที่ใช้ได้
        </p>
      )}
      {hasHistory && (
        <figure className="rounded-2xl border border-[#dbe8e0] bg-white p-3">
          <figcaption className="text-sm font-bold text-slate-900">ค่าเฉลี่ย PM2.5 ย้อนหลัง 7 วัน</figcaption>
          <p className="mb-2 mt-1 text-xs text-slate-600">µg/m³ · สีตามระดับ PM2.5</p>
          <ol className="grid grid-cols-7 gap-1">
            {history.map(point => (
              <li key={point.date} className="flex min-w-0 flex-col items-center text-center text-[10px] text-slate-600"
                aria-label={`${point.date}: ${point.pm25 == null ? "ไม่มีข้อมูล" : point.pm25 + " µg/m³"}`}>
                <span className="font-semibold tabular-nums">{point.pm25?.toFixed(1) ?? "—"}</span>
                <span className="mt-1 flex h-14 w-full max-w-7 items-end rounded-sm bg-slate-100" aria-hidden>
                  {point.pm25 != null && <span className="w-full rounded-sm"
                    style={{ height: Math.max(2, point.pm25 / historyMax * 100) + "%", backgroundColor: "color-mix(in srgb, " + color(point.pm25) + " 74%, white)" }} />}
                </span>
                <time className="mt-1 tabular-nums" dateTime={point.date}>{point.date.slice(8)}/{point.date.slice(5, 7)}</time>
              </li>
            ))}
          </ol>
        </figure>
      )}

      {Number.isFinite(park.lat) && Number.isFinite(park.lng) && (
        <section aria-label={lang === "TH" ? "การเดินทางไปสวน" : "Directions to the park"}
          className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-1.5 px-1">
            <h3 className="text-sm font-bold text-slate-900">{lang === "TH" ? "การเดินทางไปสวน" : "Directions to the park"}</h3>
            <span className="text-xs font-medium text-slate-600">Google Maps <span aria-hidden="true">↗</span></span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {([
              { mode: "driving", label: lang === "TH" ? "ขับรถ" : "Driving", Icon: Car },
              { mode: "transit", label: lang === "TH" ? "รถสาธารณะ" : "Public transit", Icon: Bus },
            ] as const).map(({ mode, label, Icon }) => (
              <a key={mode}
                href={"https://www.google.com/maps/dir/?" + new URLSearchParams({
                  api: "1",
                  destination: `${park.lat},${park.lng}`,
                  travelmode: mode,
                })}
                className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-emerald-900/15 bg-white px-2 py-2 text-center text-sm font-semibold text-[#005A50] hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
                <Icon size={20} className="shrink-0" aria-hidden="true" />
                <span>{label}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <details className="rounded-xl border border-slate-200 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-[#005A50]">{lang === "TH" ? "คำนวณระยะขับรถในเว็บ" : "Estimate driving distance here"}</summary>

        {roadRoute && (
          <div className="mt-2">
            <p className="text-2xl font-bold text-blue-900">
              {roadRoute.distance < 1000 ? `${Math.round(roadRoute.distance)} เมตร`
                : `${(roadRoute.distance / 1000).toFixed(2)} กม.`}
            </p>
            <p className="text-sm text-slate-600">ประมาณ {Math.max(1, Math.round(roadRoute.duration / 60))} นาที</p>
          </div>
        )}
        {routeStatus === "error" && <p role="status" className="mt-2 text-sm text-red-700">
          หาเส้นทางตามถนนไม่ได้ในขณะนี้ ลองใหม่ได้ครับ
        </p>}
        <button type="button" onClick={userLocation ? findRoadRoute : locateMe}
          disabled={locating || routeStatus === "loading"}
          className="mt-3 rounded-xl bg-[#005A50] px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
          {locating ? "กำลังหาตำแหน่ง…" : routeStatus === "loading" ? "กำลังหาเส้นทาง…"
            : userLocation ? roadRoute ? "คำนวณเส้นทางอีกครั้ง" : "หาเส้นทางขับรถ" : "เปิด GPS"}
        </button>
        <p className="mt-2 text-xs text-slate-600">
          เมื่อกดหาเส้นทาง ระบบจะส่งพิกัดต้นทางและปลายทางไปยัง OSRM ของ FOSSGIS
        </p>
        {roadRoute && <p className="mt-1 text-xs text-slate-600">
          ข้อมูลถนน © OpenStreetMap contributors ·{" "}
          <a href="https://www.openstreetmap.org/fixthemap" className="underline">แจ้งแก้ไขแผนที่</a>
        </p>}
      </details>
    </div>
  )}
</aside>

    </div>

{!district && !park && (
<section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
  aria-labelledby="park-air-ranking-title">
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h2 id="park-air-ranking-title" className="text-xl font-bold text-slate-900">
        {lang === "TH" ? "10 อันดับสวนตามค่าฝุ่นใกล้เคียง" : "Top 10 park groups by nearby PM2.5"}
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        {lang === "TH"
          ? "ใช้ค่าจากสถานีใกล้สวน · สวนที่ใช้สถานีเดียวกันอยู่ในอันดับเดียวกัน"
          : "Parks sharing a station are grouped. Readings are taken at the station."}
      </p>
    </div>
    <div role="group" aria-label={lang === "TH" ? "เรียงตามค่าฝุ่น" : "Sort by PM2.5"}
      className="inline-flex rounded-xl bg-slate-100 p-1">
      {(["low", "high"] as const).map(order => (
        <button key={order} type="button" aria-pressed={ranking === order}
          onClick={() => setRanking(order)}
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${ranking === order
            ? "bg-[#005A50] text-white" : "text-slate-700 hover:bg-white"}`}>
          {lang === "TH" ? order === "low" ? "ฝุ่นต่ำสุด" : "ฝุ่นสูงสุด"
            : order === "low" ? "Lowest PM2.5" : "Highest PM2.5"}
        </button>
      ))}
    </div>
  </div>
  {!rankedGroups.length ? (
    <p role="status" className="mt-4 text-sm text-slate-600">
      {lang === "TH" ? "ยังไม่มีสวนที่มีข้อมูลสถานีอ้างอิงในรายการนี้"
        : "No parks with nearby readings in this selection."}
    </p>
  ) : (
    <ol className="mt-4 grid gap-3 min-[560px]:grid-cols-2 xl:grid-cols-3">
      {rankedGroups.map(({ station, parks: nearby }, index) => {
        const [first, ...others] = nearby;
        const showPark = ({ park: item }: typeof first) => {
          setPark(item);
          if (window.matchMedia("(min-width: 840px)").matches) {
            element.current?.scrollIntoView({ block: "nearest" });
          }
          map.current?.flyTo([item.lat, item.lng], 14, { duration: 0.8 });
        };
        const parkButton = (item: typeof first) => (
          <button key={item.park.id} type="button" onClick={() => showPark(item)}
            className="block max-w-full text-left text-sm font-semibold text-[#005A50] hover:underline">
            {item.park.name} · {item.km.toFixed(2)} {lang === "TH" ? "กม." : "km"}
          </button>
        );
        return (
          <li key={station.id} className="rounded-2xl border border-[#deebe2] bg-[#f7faf8] p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-2">
                <span className="grid h-6 min-w-6 shrink-0 place-items-center rounded-full bg-white text-xs font-bold text-[#005A50]">
                  {index + 1}
                </span>
                {parkButton(first)}
              </div>
              <span className="shrink-0 rounded-lg px-2 py-1 text-sm font-bold tabular-nums text-slate-950"
                style={{ backgroundColor: getThaiAqiMeta(station.pm25 ?? NaN).bgTint }}>
                {station.pm25?.toFixed(1)} µg/m³
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-600">{lang === "TH" ? "สถานี " : "Station "}{station.name}</p>
            {station.observedAt && <time dateTime={station.observedAt} className="mb-1 block text-xs text-slate-600">
              {new Date(station.observedAt).toLocaleString(lang === "TH" ? "th-TH" : "en-GB", {
                dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok",
              })}
            </time>}
            {!!others.length && <details className="mt-1 text-sm text-slate-600">
              <summary className="cursor-pointer">
                {lang === "TH" ? `ดูอีก ${others.length} สวน` : `Show ${others.length} more parks`}
              </summary>
              <div className="mt-1 space-y-1">{others.map(parkButton)}</div>
            </details>}
          </li>
        );
      })}
    </ol>
  )}
</section>
)}
  </section>;
}
