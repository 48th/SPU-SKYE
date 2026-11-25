"use client";

import React, { useEffect, useRef, useState } from "react";
import { getAirQualityExpression } from "@/components/CivicIllustrationAssets";
import {
  getThaiAqiMeta,
  formatReading,
  formatObservedAt,
  type District,
  type DistrictStation,
} from "@/lib/forecastService";

const LONGDO_API_KEY = "e5b86bcad18d760d87dff873ab6174f4";
const LONGDO_SCRIPT_URL = `https://api.longdo.com/map/?key=${LONGDO_API_KEY}`;

const BANGKOK_CENTER = {
  lat: 13.7563,
  lon: 100.5018,
};

const DEFAULT_ZOOM = 12;

interface LongdoLocation {
  lon: number;
  lat: number;
}

interface LongdoMarkerOptions {
  title?: string;
  detail?: string;
  icon?: {
    html: string;
    offset?: { x: number; y: number };
  };
}

interface LongdoCircleOptions {
  lineWidth?: number;
  lineColor?: string;
  fillColor?: string;
}

interface LongdoOverlays {
  add: (overlay: unknown) => void;
  clear?: () => void;
}

interface LongdoUiWidget {
  visible?: (show: boolean) => void;
}

interface LongdoMapInstance {
  Overlays: LongdoOverlays;
  Event?: {
    bind: (eventName: string, handler: (overlay: unknown) => void) => void;
    unbind?: (eventName: string, handler: (overlay: unknown) => void) => void;
  };
  Ui?: {
    DPad?: LongdoUiWidget;
    Zoombar?: LongdoUiWidget;
    Geolocation?: LongdoUiWidget;
    Toolbar?: LongdoUiWidget;
    LayerSelector?: LongdoUiWidget;
    Fullscreen?: LongdoUiWidget;
    Crosshair?: LongdoUiWidget;
    Scale?: LongdoUiWidget;
  };
  location: (loc?: LongdoLocation, smooth?: boolean) => LongdoLocation;
  zoom: (level?: number, smooth?: boolean) => number;
  resize?: () => void;
}

interface LongdoNamespace {
  UiComponent?: { None: number };
  Map: new (options: {
    placeholder: HTMLElement;
    location?: LongdoLocation;
    zoom?: number;
    lastView?: boolean;
    ui?: number;
  }) => LongdoMapInstance;
  Marker: new (
    location: LongdoLocation,
    options?: LongdoMarkerOptions
  ) => unknown;
  Circle?: new (
    location: LongdoLocation,
    radius: number,
    options?: LongdoCircleOptions
  ) => unknown;
}

declare global {
  interface Window {
    longdo?: LongdoNamespace;
  }
}

export interface LongdoPM25MapProps {
  stations?: DistrictStation[];
  selectedStationId?: District | null;
  lang?: "TH" | "EN";
  centerLat?: number;
  centerLon?: number;
  zoom?: number;
  resetSignal?: number;
  showPmLayer?: boolean;
  showWindLayer?: boolean;
  sensorTitle?: string;
  sensorReading?: number;
  onSelectStation?: (station: DistrictStation) => void;
  onZoomChange?: (nextZoom: number) => void;
  className?: string;
}

type MarkerDensityMode = "full" | "compact" | "mini";

function getMarkerDensityMode(zoomLevel: number): MarkerDensityMode {
  if (zoomLevel >= 15) return "full";
  if (zoomLevel >= 13) return "compact";
  return "mini";
}


function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildAirQualityFace(pm25: number, size: number): string {
  const face = getAirQualityExpression(pm25);
  const iconSize = Math.round(size * 0.8);
  const icon = face.image ? `<img src="${face.image}" width="${iconSize}" height="${iconSize}" alt="">` : "–";
  return `<span aria-hidden="true" style="display:grid;place-items:center;width:${size}px;height:${size}px;border-radius:50%;background:${face.tint};color:#334155;">${icon}</span>`;
}

function buildStationMarkerHtml(
  station: DistrictStation,
  lang: "TH" | "EN",
  isSelected: boolean,
  showWindLayer: boolean,
  density: MarkerDensityMode,
  mobileNumbers: boolean
): string {
  const meta = getThaiAqiMeta(station.currentPM25);
  const pillText = meta.tier === "Moderate" ? "#0F172A" : "#FFFFFF";
  const label = escapeHtml((lang === "TH" ? station.nameTh : station.nameEn) + (station.district ? ` · เขต${station.district}` : "") + (station.isStale ? " · ข้อมูลเก่า" : ""));

  if (mobileNumbers) {
    const size = isSelected ? 36 : 29;
    return `
      <div title="${label} · ${formatReading(station.currentPM25)} µg/m³"
        style="display:grid;place-items:center;width:${size}px;height:${size}px;transform:translate(-50%,-50%);border-radius:50%;border:2px solid white;box-shadow:${isSelected ? "0 0 0 2px #0f172a" : "0 1px 5px #0f172a45"};background:${meta.color};color:${pillText};font-family:var(--bangkok-ui-font,system-ui);font-size:10px;font-weight:700;font-variant-numeric:tabular-nums;cursor:pointer;">
        ${formatReading(station.currentPM25)}
      </div>
    `;
  }

  if (!isSelected && density !== "full") {
    const dotSize = density === "mini" ? 9 : 12;
    const wind = showWindLayer && density === "compact" && Number.isFinite(station.windSpeedMs)
      ? `<span style="position:absolute;left:100%;top:50%;transform:translateY(-50%);padding:1px 4px;border-radius:5px;background:#fff;color:#334155;font-size:9px;font-weight:600;white-space:nowrap;">${formatReading(station.windSpeedMs)} m/s</span>`
      : "";
    return `
      <div title="${label} · ${formatReading(station.currentPM25)} µg/m³" style="position:relative;display:grid;place-items:center;width:22px;height:22px;transform:translate(-50%,-50%);cursor:pointer;">
        <span style="width:${dotSize}px;height:${dotSize}px;border-radius:50%;background:${meta.color};border:1.5px solid #fff;box-shadow:0 0 0 1px #1e293b66,0 1px 3px #1e293b38;"></span>
        ${wind}
      </div>
    `;
  }

  // Show the name only for the selected station.
  const ringStyle = isSelected
    ? "box-shadow:0 0 0 3px #005A50, 2px 2px 0px #0f172a;"
    : "box-shadow:0 2px 5px #0f172a38;";
  const windBadge = showWindLayer && Number.isFinite(station.windSpeedMs)
    ? `<span style="position:absolute;top:-7px;right:-14px;background:rgba(255,255,255,0.92);border:1px solid #334155;border-radius:9999px;padding:0px 5px;font-family:var(--bangkok-ui-font, system-ui);font-size:9px;font-weight:700;color:#0284C7;box-shadow:1.5px 1.5px 0px #0f172a;white-space:nowrap;">${formatReading(station.windSpeedMs)} m/s</span>`
    : "";

  return `
    <div title="${label} · ${formatReading(station.currentPM25)} µg/m³" style="display:inline-flex;flex-direction:column;align-items:center;gap:2px;transform:translate(-50%,-50%);cursor:pointer;user-select:none;white-space:nowrap;">
      <div style="position:relative;width:${isSelected ? 29 : 24}px;height:${isSelected ? 29 : 24}px;border-radius:9999px;background:rgba(255,255,255,0.65);border:1px solid #334155;display:flex;align-items:center;justify-content:center;${ringStyle}">
        ${buildAirQualityFace(station.currentPM25, isSelected ? 24 : 20)}
        ${windBadge}
      </div>
      <div style="padding:0px 6px;border-radius:9999px;background:${meta.color};color:${pillText};border:1px solid #334155;font-family:var(--bangkok-ui-font, system-ui);font-size:10px;font-weight:700;font-variant-numeric:tabular-nums;box-shadow:1.5px 1.5px 0px #0f172a;white-space:nowrap;">
        ${formatReading(station.currentPM25)}
      </div>
      ${isSelected ? `<div style="padding:2px 6px;border-radius:7px;background:#fff;color:#17312e;font-size:11px;font-weight:600;box-shadow:0 2px 8px #17312e28;">${label}</div>` : ""}
    </div>
  `;
}

export default function LongdoPM25Map({
  stations,
  selectedStationId = null,
  lang = "TH",
  centerLat = BANGKOK_CENTER.lat,
  centerLon = BANGKOK_CENTER.lon,
  zoom = DEFAULT_ZOOM,
  resetSignal = 0,
  showPmLayer = true,
  showWindLayer = false,
  sensorTitle = "Bangkok PM2.5 Monitoring Station",
  sensorReading = NaN,
  onSelectStation,
  onZoomChange,
  className = "",
}: LongdoPM25MapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<LongdoMapInstance | null>(null);
  const markerStationMapRef = useRef<Map<unknown, DistrictStation>>(new Map());
  const onSelectStationRef = useRef(onSelectStation);
  onSelectStationRef.current = onSelectStation;
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [liveZoom, setLiveZoom] = useState<number>(zoom);
  const densityMode = getMarkerDensityMode(liveZoom);
  const [mobile, setMobile] = useState(false);
  const mobileNumbers = mobile && liveZoom >= 12;

  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // Initialize Longdo Map script and mount the map instance once
  useEffect(() => {
    let isCancelled = false;
    const containerNode = mapContainerRef.current;

    const handleOverlayClick = (overlay: unknown) => {
      const station = markerStationMapRef.current.get(overlay);
      if (station && onSelectStationRef.current) {
        onSelectStationRef.current(station);
      }
    };

    const handleMapZoom = () => {
      const map = mapInstanceRef.current;
      if (!map) return;
      try {
        const nextZoom = map.zoom();
        if (typeof nextZoom === "number" && Number.isFinite(nextZoom)) {
          setLiveZoom(nextZoom);
          onZoomChangeRef.current?.(Math.round(nextZoom));
        }
      } catch {
        // Ignore transient zoom reads
      }
    };

    const initializeMap = () => {
      if (isCancelled || !containerNode) return;
      if (mapInstanceRef.current) return;

      const longdo = window.longdo;
      if (!longdo?.Map || !longdo?.Marker) {
        setStatus("error");
        setErrorMessage("Longdo Map SDK failed to initialize.");
        return;
      }

      try {
        const map = new longdo.Map({
          placeholder: containerNode,
          location: { lon: centerLon, lat: centerLat },
          zoom,
          lastView: false,
          ui: stations !== undefined ? longdo.UiComponent?.None : undefined,
        });

        // Hide overlapping built-in Longdo controls when custom dashboard controls are present
        if (stations !== undefined) {
          try {
            map.Ui?.DPad?.visible?.(false);
            map.Ui?.Zoombar?.visible?.(false);
            map.Ui?.Geolocation?.visible?.(false);
            map.Ui?.Toolbar?.visible?.(false);
            map.Ui?.LayerSelector?.visible?.(false);
            map.Ui?.Fullscreen?.visible?.(false);
            map.Ui?.Crosshair?.visible?.(false);
          } catch {
            // Keep default UI controls if individual widget visibility calls are unsupported
          }
        }

        map.Event?.bind("overlayClick", handleOverlayClick);
        map.Event?.bind("zoom", handleMapZoom);
        mapInstanceRef.current = map;
        setLiveZoom(zoom);
        setStatus("ready");
        setErrorMessage(null);
      } catch (err) {
        const detail =
          err instanceof Error ? err.message : "Unable to render Longdo Map.";
        setStatus("error");
        setErrorMessage(detail);
      }
    };

    if (window.longdo?.Map) {
      initializeMap();
    } else {
      let scriptEl = document.querySelector<HTMLScriptElement>(
        'script[data-longdo-map="true"]'
      );

      const handleLoad = () => {
        if (scriptEl) {
          scriptEl.dataset.loaded = "true";
        }
        initializeMap();
      };

      const handleError = () => {
        if (!isCancelled) {
          setStatus("error");
          setErrorMessage("Failed to load Longdo Map script.");
        }
      };

      if (!scriptEl) {
        scriptEl = document.createElement("script");
        scriptEl.src = LONGDO_SCRIPT_URL;
        scriptEl.async = true;
        scriptEl.dataset.longdoMap = "true";
        scriptEl.addEventListener("load", handleLoad);
        scriptEl.addEventListener("error", handleError);
        document.head.appendChild(scriptEl);
      } else if (scriptEl.dataset.loaded === "true") {
        initializeMap();
      } else {
        scriptEl.addEventListener("load", handleLoad);
        scriptEl.addEventListener("error", handleError);
      }

      return () => {
        isCancelled = true;
        if (scriptEl) {
          scriptEl.removeEventListener("load", handleLoad);
          scriptEl.removeEventListener("error", handleError);
        }
        if (mapInstanceRef.current) {
          mapInstanceRef.current.Event?.unbind?.("overlayClick", handleOverlayClick);
          mapInstanceRef.current.Event?.unbind?.("zoom", handleMapZoom);
          try {
            mapInstanceRef.current.Overlays.clear?.();
          } catch {
            // Ignore overlay disposal errors during teardown
          }
        }
        markerStationMapRef.current.clear();
        mapInstanceRef.current = null;
        if (containerNode) {
          containerNode.innerHTML = "";
        }
      };
    }

    return () => {
      isCancelled = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.Event?.unbind?.("overlayClick", handleOverlayClick);
        mapInstanceRef.current.Event?.unbind?.("zoom", handleMapZoom);
        try {
          mapInstanceRef.current.Overlays.clear?.();
        } catch {
          // Ignore overlay disposal errors during teardown
        }
      }
      markerStationMapRef.current.clear();
      mapInstanceRef.current = null;
      if (containerNode) {
        containerNode.innerHTML = "";
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render station markers and optional PM2.5 coverage circles whenever overlay data changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    const longdo = window.longdo;
    if (status !== "ready" || !map || !longdo?.Marker) return;

    try {
      map.Overlays.clear?.();
    } catch {
      // Proceed cleanly if clear is unavailable
    }
    markerStationMapRef.current.clear();

    if (stations && stations.length > 0) {
      // Render non-selected stations first so the active station marker sits on top
      const orderedStations = [...stations].sort((a, b) => {
        if (a.id === selectedStationId) return 1;
        if (b.id === selectedStationId) return -1;
        return 0;
      });

      orderedStations.forEach((station) => {
        if (!Number.isFinite(station.lat) || !Number.isFinite(station.lon)) return;
        const meta = getThaiAqiMeta(station.currentPM25);
        const isSelected = selectedStationId === station.id;

        const marker = new longdo.Marker(
          { lon: station.lon, lat: station.lat },
          {
            title: lang === "TH" ? station.nameTh : station.nameEn,
            detail: `${escapeHtml(station.stationTh)} · ${escapeHtml(formatObservedAt(station.observedAt))} · ${station.isStale ? "ข้อมูลเก่า · " : ""}${formatReading(station.currentPM25)} µg/m³ · ${
              lang === "TH" ? meta.thaiLabel : meta.englishLabel
            }`,
            icon: {
              html: buildStationMarkerHtml(
                station,
                lang,
                isSelected,
                showWindLayer,
                densityMode,
                mobileNumbers || (mobile && isSelected)
              ),
              offset: { x: 0, y: 0 },
            },
          }
        );

        markerStationMapRef.current.set(marker, station);
        map.Overlays.add(marker);
      });
    } else if (stations === undefined && Number.isFinite(sensorReading)) {
      const sensorMarker = new longdo.Marker(
        { lon: centerLon, lat: centerLat },
        {
          title: sensorTitle,
          detail: `Observed PM2.5: ${sensorReading.toFixed(1)} µg/m³`,
        }
      );
      map.Overlays.add(sensorMarker);
    }
  }, [
    status,
    stations,
    selectedStationId,
    lang,
    showPmLayer,
    showWindLayer,
    densityMode,
    mobile,
    mobileNumbers,
    centerLat,
    centerLon,
    sensorTitle,
    sensorReading,
  ]);

  // Synchronize zoom level changes cleanly without recreating the map
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (status !== "ready" || !map) return;
    try {
      const current = map.zoom();
      if (typeof current !== "number" || Math.abs(current - zoom) > 0.25) {
        map.zoom(zoom, true);
      }
      setLiveZoom(zoom);
    } catch {
      // Ignore transient zoom call errors
    }
  }, [status, zoom]);

  // Pan smoothly to the newly selected station
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (status !== "ready" || !map || !selectedStationId || !stations?.length) {
      return;
    }
    const target = stations.find((st) => st.id === selectedStationId);
    if (target) {
      try {
        map.location({ lon: target.lon, lat: target.lat }, true);
      } catch {
        // Ignore transient pan call errors
      }
    }
  }, [status, selectedStationId, stations]);

  // Re-center on Bangkok when the map reset control is triggered
  useEffect(() => {
    if (resetSignal === 0) return;
    const map = mapInstanceRef.current;
    if (status !== "ready" || !map) return;
    try {
      map.location({ lon: centerLon, lat: centerLat }, true);
      map.zoom(DEFAULT_ZOOM, true);
      setLiveZoom(DEFAULT_ZOOM);
    } catch {
      // Ignore transient reset call errors
    }
  }, [status, resetSignal, centerLat, centerLon]);

  // Reflow Longdo Map tiles when container resizes across mobile and tablet breakpoints
  useEffect(() => {
    const containerNode = mapContainerRef.current;
    const map = mapInstanceRef.current;
    if (status !== "ready" || !containerNode || !map || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      try {
        map.resize?.();
      } catch {
        // Ignore transient resize errors
      }
    });
    observer.observe(containerNode);
    return () => observer.disconnect();
  }, [status]);

  return (
    <div className={`relative w-full h-full bg-[#F1F5F9] ${className}`}>
      {/* Target container managed directly by the Longdo Map SDK */}
      <div
        ref={mapContainerRef}
        className="w-full h-full"
        aria-label={
          lang === "TH"
            ? "แผนที่ Longdo แสดงจุดตรวจวัดฝุ่น PM2.5 กรุงเทพมหานคร"
            : "Longdo interactive Bangkok PM2.5 monitoring map"
        }
        aria-busy={status === "loading"}
      />

      {/* Loading overlay */}
      {status === "loading" && (
        <div
          role="status"
          className="absolute inset-0 z-10 flex items-center justify-center bg-[#F8FAFC]/90"
        >
          <span className="rounded-xl border-2 border-slate-900 bg-white px-4 py-2 body-4 text-slate-900 shadow-[3px_3px_0px_#0f172a]">
            {lang === "TH"
              ? "กำลังโหลดแผนที่ Longdo กรุงเทพมหานคร..."
              : "Loading Bangkok Longdo Map..."}
          </span>
        </div>
      )}

      {/* Error overlay */}
      {status === "error" && errorMessage && (
        <div
          role="alert"
          className="absolute inset-0 z-10 flex items-center justify-center bg-red-50/95 p-6"
        >
          <div className="max-w-sm rounded-xl border-2 border-slate-900 bg-white p-4 text-center shadow-[4px_4px_0px_#0f172a]">
            <p className="body-4 text-slate-900">
              {lang === "TH" ? "ไม่สามารถโหลดแผนที่ได้" : "Map Initialization Error"}
            </p>
            <p className="caption-4 text-slate-700 mt-1">{errorMessage}</p>
          </div>
        </div>
      )}
    </div>
  );
}