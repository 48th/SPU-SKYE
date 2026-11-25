"use client";
import { useStationFavorites } from "@/lib/stationFavorites";


import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ArrowClockwise,
  CaretDown,
  CaretLeft,
  CaretRight,
  MagnifyingGlass,
  Heart,
  Plus,
  Minus,
  Crosshair,
  Stack,
  Wind,
  Bell,
  WifiSlash,
  X,
  MapPin,
} from "@phosphor-icons/react";
import {
  BangkokSkylineBackdrop,
  AirQualityExpression,
  NearbyStationBadge,
  TopTenBadge,
  MiniDustIcon,
  MiniThermometerIcon,
  MiniWindIcon,
} from "@/components/CivicIllustrationAssets";
import DistrictAnalyticsDrawer, {
  type DrawerSection,
} from "@/components/DistrictAnalyticsDrawer";
import LongdoPM25Map from "@/components/LongdoPM25Map";
import {
  BANGKOK_STATIONS,
  EMPTY_STATION,
  formatReading,
  formatObservedAt,
  THAI_AQI_TIERS,
  fetchForecast,
  fetchLiveStations,
  getThaiAqiMeta,
  type District,
  type DistrictStation,
  type ForecastHorizon,
  type ForecastResponse,
  type FetchStatus,
} from "@/lib/forecastService";

type NavKey = "map" | "hourly" | "shap" | "standards";
type SidebarTab = "nearby" | "top10";



function DashboardSkeleton() {
  return (
    <div
      className="rounded-2xl border border-neutral-300/70 bg-white/75 shadow-sm overflow-hidden p-4 sm:p-6 flex flex-col gap-4"
      aria-busy="true"
      aria-label="Loading Bangkok air quality map dashboard"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 flex flex-col gap-3">
          <div className="skeleton h-12 rounded-xl" />
          <div className="skeleton h-10 rounded-xl" />
          <div className="skeleton h-28 rounded-2xl" />
          <div className="skeleton h-28 rounded-2xl" />
          <div className="skeleton h-28 rounded-2xl" />
        </div>
        <div className="lg:col-span-8 flex flex-col gap-4 justify-between">
          <div className="skeleton h-[320px] sm:h-[440px] w-full rounded-2xl" />
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="skeleton h-20 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PM25Dashboard() {
  const [lang, setLang] = useState<"TH" | "EN">("TH");
  const [activeNav, setActiveNav] = useState<NavKey>("map");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileStationsOpen, setMobileStationsOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("nearby");
  const [districtFilter, setDistrictFilter] = useState<"ALL" | District>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const { ids: favorites, toggle: toggleStationFavorite } = useStationFavorites();

  // Map interactive states
  const [zoom, setZoom] = useState(12);
  const [resetSignal, setResetSignal] = useState(0);
  const [showPmLayer, setShowPmLayer] = useState(true);
  const [showWindLayer, setShowWindLayer] = useState(false);
  const [showAlertsPopover, setShowAlertsPopover] = useState(false);
  const [showStandardsModal, setShowStandardsModal] = useState(false);

  // Live Bangkok stations and selected station drawer
  const [stations, setStations] = useState<DistrictStation[]>(BANGKOK_STATIONS);
  const [selectedStation, setSelectedStation] = useState<DistrictStation>(
    EMPTY_STATION
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerSection, setDrawerSection] = useState<DrawerSection>("all");
  const [horizon, setHorizon] = useState<ForecastHorizon>("24h");

  // API states
  const [initialLoading, setInitialLoading] = useState(true);
  const [drawerStatus, setDrawerStatus] = useState<FetchStatus>("idle");
  const [forecastData, setForecastData] = useState<ForecastResponse | null>(
    null
  );
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string>("");

  const abortRef = useRef<AbortController | null>(null);

  const tomorrow = forecastData?.district === selectedStation.id ? forecastData?.tomorrow : undefined;

  const syncLiveStations = useCallback(async (forceRefresh = false) => {

    setInitialLoading(false);
    const updated = await fetchLiveStations(forceRefresh);
    if (!updated) { setIsOffline(true); return; }
    setIsOffline(false);
    setLastSyncedAt(new Date().toISOString());
    setStations(updated);
    setSelectedStation((prev) => updated.find((s) => s.id === prev.id) ?? updated[0] ?? EMPTY_STATION);
  }, []);

  const loadStationForecast = useCallback(
    async (
      station: DistrictStation,
      nextHorizon: ForecastHorizon,
      forceRefresh = false
    ) => {
      if (!station.id) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setDrawerStatus("loading");
      setDrawerError(null);

      try {
        const result = await fetchForecast(
          station.id,
          nextHorizon,
          controller.signal,
          forceRefresh
        );
        if (controller.signal.aborted) return;

        if (result.status === "error") {
          setDrawerError(result.error ?? "Unable to fetch forecast.");
          setDrawerStatus("error");
          return;
        }

        if (result.data) {
          setForecastData(result.data);
          setIsOffline(result.isOffline);
          setLastSyncedAt(result.data.fetchedAt);
          setDrawerStatus("success");
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setDrawerError("Unable to load district forecast.");
        setDrawerStatus("error");
      } finally {
        setInitialLoading(false);
      }
    },
    []
  );

  // Initial sync on mount
  useEffect(() => {
    syncLiveStations(false);
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedStation.id) void loadStationForecast(selectedStation, horizon);
  }, [selectedStation.id, horizon, loadStationForecast]);

  const handleOpenStation = useCallback(
    (station: DistrictStation, section: DrawerSection = "all") => {
      setSelectedStation(station);
      setMobileStationsOpen(false);
      setDrawerSection(section);
      setDrawerOpen(true);
      setActiveNav(section === "hourly" ? "hourly" : section === "shap" ? "shap" : "map");
      if (station.id === selectedStation.id) void loadStationForecast(station, horizon);
    },
    [horizon, loadStationForecast, selectedStation.id]
  );

  useEffect(() => {
    function openTool() {
      const hash = window.location.hash;
      if (hash === "#standards") {
        setActiveNav("standards");
        setDrawerOpen(false);
        setShowStandardsModal(true);
      } else if (hash === "#shap" && selectedStation.id) {
        setShowStandardsModal(false);
        handleOpenStation(selectedStation, "shap");
      } else {
        return;
      }
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
    openTool();
    window.addEventListener("hashchange", openTool);
    return () => window.removeEventListener("hashchange", openTool);
  }, [handleOpenStation, selectedStation]);

  const handleHorizonChange = useCallback(
    (nextH: ForecastHorizon) => {
      setHorizon(nextH);
      loadStationForecast(selectedStation, nextH);
    },
    [selectedStation, loadStationForecast]
  );

  const handleManualRefresh = useCallback(() => {
    syncLiveStations(true);
    loadStationForecast(selectedStation, horizon, true);
  }, [selectedStation, horizon, loadStationForecast, syncLiveStations]);

  const handleLoadFallback = useCallback(() => {
    handleManualRefresh();
  }, [handleManualRefresh]);

  const toggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    toggleStationFavorite(id);
  };

  // Filtered and sorted district cards
  const visibleStations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = stations.filter((st) => {
      if (districtFilter !== "ALL" && st.district !== districtFilter) return false;
      if (!query) return true;
      return (
        (st.district ?? "").toLowerCase().includes(query) ||
        st.id.toLowerCase().includes(query) ||
        st.nameEn.toLowerCase().includes(query) ||
        st.nameTh.toLowerCase().includes(query) ||
        st.stationEn.toLowerCase().includes(query) ||
        st.stationTh.toLowerCase().includes(query)
      );
    });

    const sorted = [...filtered];
    if (sidebarTab === "top10") {
      sorted.sort((a, b) => (Number.isFinite(b.currentPM25) ? b.currentPM25 : -Infinity) - (Number.isFinite(a.currentPM25) ? a.currentPM25 : -Infinity));
      return sorted.slice(0, 10);
    } else {
      sorted.sort((a, b) => a.nameTh.localeCompare(b.nameTh, "th"));
    }
    return sorted;
  }, [stations, districtFilter, searchQuery, sidebarTab]);

  const alertStations = useMemo(
    () =>
      stations
        .filter((s) => s.currentPM25 > 37.5)
        .sort((a, b) => b.currentPM25 - a.currentPM25),
    [stations]
  );

  const navItems: {
    key: NavKey;
    labelTh: string;
    labelEn: string;
    shortTh: string;
    shortEn: string;
  }[] = [
    { key: "map", labelTh: "แผนที่คุณภาพอากาศ", labelEn: "Air Quality Map", shortTh: "แผนที่", shortEn: "Map" },
    { key: "hourly", labelTh: "พยากรณ์รายชั่วโมง", labelEn: "Hourly Forecast", shortTh: "รายชั่วโมง", shortEn: "Hourly" },
    { key: "shap", labelTh: "วิเคราะห์ปัจจัย SHAP", labelEn: "SHAP Analysis", shortTh: "ปัจจัย SHAP", shortEn: "SHAP" },
    { key: "standards", labelTh: "ดัชนีมาตรฐาน", labelEn: "AQI Standards", shortTh: "มาตรฐาน", shortEn: "AQI" },
  ];

  const handleNavClick = (key: NavKey) => {
    setActiveNav(key);
    if (key === "map") {
      setDrawerOpen(false);
      setShowStandardsModal(false);
    } else if (key === "hourly") {
      setShowStandardsModal(false);
      handleOpenStation(selectedStation, "hourly");
    } else if (key === "shap") {
      setShowStandardsModal(false);
      handleOpenStation(selectedStation, "shap");
    } else if (key === "standards") {
      setDrawerOpen(false);
      setShowStandardsModal(true);
    }
  };

  const isRefreshing = drawerStatus === "loading";

  return (
    <div className="bangkok-ui-font min-h-screen flex flex-col bg-gradient-to-br from-white via-neutral-100 to-neutral-200">
      {/* ── Top Civic Navigation Header layered over Cel-Shaded BangkokSkylineBackdrop ── */}
      <header className="relative z-30 hidden sm:block bg-white/65 backdrop-blur-xl border-b border-neutral-300/70 overflow-hidden">
        <BangkokSkylineBackdrop className="absolute inset-x-0 bottom-0 h-24 w-full pointer-events-none opacity-15 grayscale" />

        <div className="relative max-w-[1440px] mx-auto px-3 sm:px-6 py-2.5 sm:py-4 flex flex-wrap items-center justify-between gap-2 sm:gap-3 xl:gap-4">
          {/* Left: Circle Logo + SPU SKYE Wordmark + Subtitle */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 xl:flex-initial">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full overflow-hidden shrink-0 shadow-sm">
              <img
                src="/Logo/Circle_Logo.png"
                alt="SPU SKYE Logo"
                width={48}
                height={48}
                className="w-full h-full object-contain"
              />
            </div>
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 bg-white/75 backdrop-blur-md border border-neutral-300/70 rounded-2xl px-2.5 sm:px-3 py-1 sm:py-1.5 shadow-sm">
              {/* Stacked SPU / SKYE Logo Text matching brand lockup */}
              <div
                className="font-logo inline-flex flex-col items-stretch shrink-0 select-none"
                aria-label="SPU SKYE"
              >
                <span className="text-[19px] sm:text-[23px] font-extrabold leading-[0.86] tracking-[0.03em] text-[#1F242B]">
                  SPU
                </span>
                <span
                  aria-hidden="true"
                  className="self-end w-[31%] h-[3px] my-[2px] rounded-[1px] bg-[#C81E6E]"
                />
                <span className="text-[12px] sm:text-[14.5px] font-bold leading-[0.9] tracking-[0.075em] text-[#C81E6E]">
                  SKYE
                </span>
              </div>

              <div className="hidden sm:block w-[2px] h-8 bg-slate-200 shrink-0 rounded-full" />

              <div className="hidden sm:flex flex-col min-w-0">
                <h1 className="text-[15px] sm:text-[17px] font-bold text-slate-900 leading-tight tracking-tight truncate">
                  PM2.5 Sentinel
                </h1>
                <p className="caption-4 text-slate-700 truncate">
                  {lang === "TH"
                    ? "ระบบพยากรณ์คุณภาพอากาศกรุงเทพฯ"
                    : "Bangkok Civic Air Quality"}
                </p>
              </div>
            </div>
          </div>

          {/* Center: Single-Row Pill Nav (Scrollable Compact on Mobile, 4-col on iPad, Pill on Desktop) */}
          <nav
            aria-label="Primary civic portal navigation"
            className="order-3 xl:order-2 w-full xl:w-auto bg-neutral-200/65 backdrop-blur-md text-slate-800 rounded-full p-1 border border-neutral-300/70 shadow-sm flex overflow-x-auto no-scrollbar sm:grid sm:grid-cols-4 xl:inline-flex items-center gap-1"
          >
            {navItems.map((item) => {
              const isActive = activeNav === item.key;
              const label = (
                <>
                  <span className="sm:hidden">{lang === "TH" ? item.shortTh : item.shortEn}</span>
                  <span className="hidden sm:inline">{lang === "TH" ? item.labelTh : item.labelEn}</span>
                </>
              );
              const navClass = `flex-1 sm:flex-initial px-2.5 sm:px-3 xl:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-semibold text-center whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-800 ${
                isActive
                  ? "bg-neutral-800 text-white border border-transparent shadow-sm"
                  : "text-slate-700 border border-transparent hover:bg-white"
              }`;
              return (
                <button key={item.key} type="button" onClick={() => handleNavClick(item.key)}
                  aria-current={isActive ? "page" : undefined} className={navClass}>
                  {label}
                </button>
              );
            })}
          </nav>

          {/* Right: Language switcher TH | EN + Manual Refresh */}
          <div className="order-2 xl:order-3 flex items-center gap-1.5 sm:gap-2 shrink-0">
            <div
              role="group"
              aria-label="Language switcher"
              className="inline-flex rounded-full border border-neutral-300/70 bg-white/75 p-0.5 shadow-sm"
            >
              {(["TH", "EN"] as const).map((code) => {
                const active = lang === code;
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setLang(code)}
                    aria-pressed={active}
                    className={`px-2 sm:px-3 py-1 rounded-full caption-3 transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600 active:scale-[0.98] ${
                      active
                        ? "bg-neutral-800 text-white"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {code}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              aria-label={
                lang === "TH" ? "อัปเดตข้อมูลล่าสุด" : "Refresh air quality data"
              }
              className="btn-outline button-sm bg-white/75 px-2.5 py-1.5 sm:px-3 sm:py-2 shadow-sm"
            >
              <ArrowClockwise
                size={16}
                weight="bold"
                className={isRefreshing ? "animate-spin text-neutral-700" : "text-neutral-700"}
                aria-hidden
              />
              <span className="hidden sm:inline">
                {lang === "TH" ? "รีเฟรช" : "Refresh"}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* ── Inline FastAPI Offline Status Banner ── */}
      {isOffline && (
        <div
          role="status"
          aria-live="polite"
          className="bg-amber-50 border-b border-neutral-300/70 text-amber-950"
        >
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 caption-4">
            <div className="flex items-center gap-2">
              <WifiSlash size={16} weight="bold" className="text-amber-700 shrink-0" aria-hidden />
              <span>
                {lang === "TH"
                  ? "เชื่อมต่อข้อมูลสถานีไม่ได้ ข้อมูลที่แสดงอาจเป็นข้อมูลจากการโหลดครั้งก่อน"
                  : "Station service unavailable. Previously loaded readings may be out of date."}
              </span>
            </div>
            {lastSyncedAt && (
              <span className="caption-5 text-amber-900 tabular-nums">
                Synced{" "}
                {new Date(lastSyncedAt).toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Main Content Area ── */}
      <main
        id="main-content"
        className="flex-1 w-full max-w-[1440px] mx-auto sm:px-6 sm:py-6 flex flex-col sm:gap-6"
      >
        {initialLoading ? (
          <DashboardSkeleton />
        ) : (
          /* Main Split-View Map Container */
          <section
            aria-label={
              lang === "TH"
                ? "แผนที่คุณภาพอากาศและรายการสถานีกรุงเทพมหานคร"
                : "Bangkok interactive air quality map and station list"
            }
            className="relative overflow-hidden flex flex-col sm:rounded-2xl sm:border sm:border-neutral-300/70 sm:bg-white/75 sm:shadow-sm xl:block xl:min-h-[760px]"
          >
            {/* Full-bleed Interactive Longdo Bangkok District Map Canvas */}
            <div className="relative w-full h-dvh mobile-map-viewport min-h-[18rem] sm:h-[420px] lg:h-[560px] xl:h-[760px] overflow-hidden bg-neutral-200">
<style>{"@media (max-width: 639px) { .mobile-map-viewport .ldmap_bottomright, .mobile-map-viewport .ldmap_bottomleft { bottom: calc(4.8rem + env(safe-area-inset-bottom, 0px)) !important; } }"}</style>
              <LongdoPM25Map
                stations={stations}
                selectedStationId={selectedStation.id}
                lang={lang}
                zoom={zoom}
                resetSignal={resetSignal}
                showPmLayer={showPmLayer}
                showWindLayer={showWindLayer}
                onSelectStation={(station) => handleOpenStation(station, "all")}
                onZoomChange={setZoom}
              />

              {/* Map Top-Right Legend / Selected Pill */}
              <div className="hidden sm:flex absolute top-4 right-20 z-10 items-center gap-2 bg-white/75 backdrop-blur-md border border-neutral-300/70 rounded-full px-3 py-2 shadow-sm">
                <MapPin size={14} weight="fill" className="text-neutral-700" aria-hidden />
                <span className="caption-4 text-slate-900">
                  {lang === "TH"
                    ? "เลือกสถานีเพื่อดูค่าฝุ่นและพยากรณ์"
                    : "Click any Bangkok station pin for ML forecast and SHAP insights"}
                </span>
              </div>

              <div className="absolute right-3 top-3 z-20 grid gap-2 sm:hidden">
                <button type="button" aria-label="ค้นหาและกรองสถานี" aria-expanded={mobileStationsOpen}
                  onClick={() => setMobileStationsOpen(value => !value)}
                  className="grid h-12 w-12 place-items-center rounded-2xl border border-neutral-200 bg-white/95 text-slate-800 shadow-md">
                  <MagnifyingGlass size={23} aria-hidden="true" />
                </button>
                <button type="button" aria-label="กลับมุมมองกรุงเทพฯ"
                  onClick={() => { setZoom(12); setResetSignal(value => value + 1); }}
                  className="grid h-12 w-12 place-items-center rounded-2xl border border-neutral-200 bg-white/95 text-slate-800 shadow-md">
                  <Crosshair size={22} aria-hidden="true" />
                </button>
              </div>
              {/* Floating Map Controls */}
              <div className="absolute right-2 top-2 z-20 hidden sm:flex gap-1.5 sm:right-4 sm:top-4 sm:flex-col sm:gap-3">
                <div className="bg-white/75 backdrop-blur-md border border-neutral-300/70 rounded-xl p-0.5 sm:p-1 flex sm:flex-col gap-0.5 sm:gap-1 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.min(16, z + 1))}
                    aria-label="Zoom in map"
                    className="h-11 w-11 sm:h-10 sm:w-10 rounded-md sm:rounded-lg flex items-center justify-center text-slate-900 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600 active:scale-[0.98]"
                  >
                    <Plus className="w-4 h-4 sm:w-[18px] sm:h-[18px]" weight="bold" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.max(8, z - 1))}
                    aria-label="Zoom out map"
                    className="h-11 w-11 sm:h-10 sm:w-10 rounded-md sm:rounded-lg flex items-center justify-center text-slate-900 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600 active:scale-[0.98]"
                  >
                    <Minus className="w-4 h-4 sm:w-[18px] sm:h-[18px]" weight="bold" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setZoom(12);
                      setResetSignal((n) => n + 1);
                    }}
                    aria-label="Reset map zoom"
                    className="h-11 w-11 sm:h-10 sm:w-10 rounded-md sm:rounded-lg flex items-center justify-center text-slate-900 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600 active:scale-[0.98]"
                  >
                    <Crosshair className="w-4 h-4 sm:w-[18px] sm:h-[18px]" weight="bold" aria-hidden />
                  </button>
                </div>

                <div className="bg-white/75 backdrop-blur-md border border-neutral-300/70 rounded-xl p-0.5 sm:p-1 flex sm:flex-col gap-0.5 sm:gap-1 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setShowPmLayer((v) => !v)}
                    aria-pressed={showPmLayer}
                    aria-label="Toggle PM2.5 coverage layer"
                    title={lang === "TH" ? "ชั้นข้อมูล PM2.5" : "PM2.5 layer"}
                    className={`h-11 w-11 sm:h-10 sm:w-10 rounded-md sm:rounded-lg flex items-center justify-center transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600 active:scale-[0.98] ${
                      showPmLayer
                        ? "bg-neutral-800 text-white border border-slate-900"
                        : "text-slate-800 hover:bg-slate-100"
                    }`}
                  >
                    <Stack className="w-4 h-4 sm:w-[18px] sm:h-[18px]" weight="bold" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowWindLayer((v) => !v)}
                    aria-pressed={showWindLayer}
                    aria-label="Toggle wind layer"
                    title={lang === "TH" ? "ชั้นข้อมูลทิศทางลม" : "Wind layer"}
                    className={`h-11 w-11 sm:h-10 sm:w-10 rounded-md sm:rounded-lg flex items-center justify-center transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600 active:scale-[0.98] ${
                      showWindLayer
                        ? "bg-[#0284C7] text-white border border-slate-900"
                        : "text-slate-800 hover:bg-slate-100"
                    }`}
                  >
                    <Wind className="w-4 h-4 sm:w-[18px] sm:h-[18px]" weight="bold" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAlertsPopover((v) => !v)}
                    aria-expanded={showAlertsPopover}
                    aria-label="Toggle dust alerts"
                    title={lang === "TH" ? "แจ้งเตือนค่าฝุ่นเกินเกณฑ์" : "Dust alerts"}
                    className={`relative h-11 w-11 sm:h-10 sm:w-10 rounded-md sm:rounded-lg flex items-center justify-center transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600 active:scale-[0.98] ${
                      showAlertsPopover
                        ? "bg-[#F97316] text-white border border-slate-900"
                        : "text-slate-800 hover:bg-slate-100"
                    }`}
                  >
                    <Bell className="w-4 h-4 sm:w-[18px] sm:h-[18px]" weight="bold" aria-hidden />
                    {alertStations.length > 0 && (
                      <span className="absolute top-0.5 right-0.5 sm:top-1 sm:right-1 w-2 h-2 rounded-full bg-[#EF4444] border border-slate-900" />
                    )}
                  </button>
                </div>

                {/* Alert Popover */}
                {showAlertsPopover && (
                  <div
                    role="region"
                    aria-label="High PM2.5 alerts"
                    className="fixed inset-x-4 top-24 z-40 sm:inset-x-auto sm:right-6 sm:top-24 sm:w-80 lg:absolute lg:right-16 lg:top-24 lg:w-72 bg-white/75 border border-neutral-300/70 rounded-2xl p-4 shadow-sm flex flex-col gap-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="title-4 text-slate-900">
                        {lang === "TH"
                          ? `เขตเฝ้าระวังเกิน 37.5 (${alertStations.length})`
                          : `Stations above 37.5 (${alertStations.length})`}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowAlertsPopover(false)}
                        className="text-slate-700 hover:text-slate-900 p-1 rounded-md border border-slate-900"
                        aria-label="Close alerts"
                      >
                        <X size={14} weight="bold" aria-hidden />
                      </button>
                    </div>
                    <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
                      {alertStations.map((st) => {
                        const m = getThaiAqiMeta(st.currentPM25);
                        return (
                          <button
                            key={st.id}
                            type="button"
                            onClick={() => {
                              setShowAlertsPopover(false);
                              handleOpenStation(st, "all");
                            }}
                            className="flex items-center justify-between gap-2 p-2 rounded-xl border border-neutral-300/70 bg-white/75 hover:bg-neutral-100/70 shadow-sm text-left"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <AirQualityExpression pm25={st.currentPM25} className="h-8 w-8" />
                              <div className="min-w-0">
                                <p className="body-5 text-slate-900 truncate">
                                  {lang === "TH" ? st.nameTh : st.nameEn}
                                </p>
                                <p className="caption-5 text-slate-600 truncate">
                                  {lang === "TH" ? m.thaiLabel : m.englishLabel}
                                </p>
                              </div>
                            </div>
                            <span
                              className="caption-3 text-white px-2 py-0.5 rounded-md border border-slate-900 tabular-nums shrink-0"
                              style={{ backgroundColor: m.color, color: m.tier === "Moderate" ? "#0F172A" : "#FFFFFF" }}
                            >
                              {formatReading(st.currentPM25)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Collapsible Floating Left Sidebar / Mobile & iPad Station Panel ── */}
            <div
              className={`max-sm:absolute max-sm:inset-x-2 max-sm:bottom-2 max-sm:max-h-[65%] max-sm:z-40 ${mobileStationsOpen ? "max-sm:flex" : "max-sm:hidden"} lg:absolute lg:top-4 lg:left-4 lg:bottom-4 xl:bottom-44 z-20 p-0 flex items-start transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                sidebarOpen ? "lg:translate-x-0" : "lg:-translate-x-[calc(100%-3rem)]"
              }`}
            >
              <div className="w-full lg:w-[344px] xl:w-[376px] h-full bg-white/70 backdrop-blur-xl border-t lg:border border-neutral-300/70 rounded-none lg:rounded-2xl max-sm:rounded-2xl max-sm:max-h-[52dvh] max-sm:bg-white max-sm:shadow-xl shadow-sm flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-3 pt-2 sm:hidden">
                  <h2 className="text-sm font-bold">ค้นหาสถานี</h2>
                  <button type="button" onClick={() => setMobileStationsOpen(false)} aria-label="ปิดรายการสถานี" className="grid h-11 w-11 place-items-center rounded-xl text-slate-700"><X size={20} aria-hidden="true" /></button>
                </div>
                {/* Station list tabs */}
                <div className="p-2.5 sm:p-3 bg-neutral-100/70 border-b border-neutral-300/70 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSidebarTab("nearby")}
                    aria-pressed={sidebarTab === "nearby"}
                    className={`flex items-center justify-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl border border-neutral-300/70 button-sm transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600 active:scale-[0.98] ${
                      sidebarTab === "nearby"
                        ? "bg-neutral-800 text-white shadow-sm"
                        : "bg-white/75 text-slate-900 hover:bg-slate-100"
                    }`}
                  >
                    <NearbyStationBadge size={18} />
                    <span>{lang === "TH" ? "สถานีตามชื่อ" : "Stations"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSidebarTab("top10")}
                    aria-pressed={sidebarTab === "top10"}
                    className={`flex items-center justify-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl border border-neutral-300/70 button-sm transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600 active:scale-[0.98] ${
                      sidebarTab === "top10"
                        ? "bg-neutral-800 text-white shadow-sm"
                        : "bg-white/75 text-slate-900 hover:bg-slate-100"
                    }`}
                  >
                    <TopTenBadge size={18} />
                    <span>{lang === "TH" ? "10 อันดับสูงสุด" : "Top 10"}</span>
                  </button>
                </div>

                {/* District Dropdown + Search Input (Side-by-Side on iPad Portrait) */}
                <div className="p-2.5 sm:p-3 border-b border-neutral-300/70 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-2 bg-white/75">
                  <div className="relative">
                    <select
                      value={districtFilter}
                      onChange={(e) =>
                        setDistrictFilter(e.target.value as "ALL" | District)
                      }
                      aria-label={lang === "TH" ? "เลือกเขตในกรุงเทพฯ" : "Filter by district"}
                      className="w-full appearance-none pl-3 pr-8 py-1.5 sm:py-2 rounded-xl border border-neutral-300/70 bg-neutral-100/70 body-5 text-slate-900 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600"
                    >
                      <option value="ALL">
                        {lang === "TH" ? "ทุกเขตในกรุงเทพมหานคร" : "All Bangkok Districts"}
                      </option>
                      {[...new Set(stations.map((s) => s.district).filter((d): d is string => Boolean(d)))].sort((a, b) => a.localeCompare(b, "th")).map((d) => {
                        return (
                          <option key={d} value={d}>
                            {lang === "TH" ? `เขต${d}` : d}
                          </option>
                        );
                      })}
                    </select>
                    <CaretDown
                      size={14}
                      weight="bold"
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-900"
                      aria-hidden
                    />
                  </div>

                  <div className="relative">
                    <MagnifyingGlass
                      size={16}
                      weight="bold"
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-700"
                      aria-hidden
                    />
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={
                        lang === "TH"
                          ? "ค้นหาเขตหรือสถานี"
                          : "Search district or station"
                      }
                      aria-label={
                        lang === "TH"
                          ? "ค้นหาเขตหรือสถานี"
                          : "Search district or station"
                      }
                      className="w-full pl-9 sm:pl-10 pr-3 py-1.5 sm:py-2 rounded-xl border border-neutral-300/70 bg-white/75 body-6 text-slate-900 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600"
                    />
                  </div>
                </div>

                {/* Scrollable Cel-Shaded White District Cards (2 Columns on iPad Portrait) */}
                <div className="flex-1 overflow-y-auto p-2.5 sm:p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-2.5 sm:gap-3 max-h-[360px] md:max-h-[440px] lg:max-h-none bg-neutral-100/45">
                  {visibleStations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center py-10 px-4 gap-3 bg-white/75 border border-neutral-300/70 rounded-2xl shadow-sm">
                      <AirQualityExpression tier="Very Good" className="h-14 w-14" />
                      <div>
                        <p className="body-4 text-slate-900">
                          {lang === "TH"
                            ? "ไม่พบสถานีที่ตรงกับการค้นหา"
                            : "No matching stations found"}
                        </p>
                        <p className="caption-5 text-slate-600 mt-1">
                          {lang === "TH"
                            ? "ลองเปลี่ยนคำค้นหาหรือเลือกดูทุกเขตในกรุงเทพฯ"
                            : "Try another search keyword or show all districts."}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setDistrictFilter("ALL");
                          setSearchQuery("");
                        }}
                        className="btn-outline button-sm"
                      >
                        {lang === "TH" ? "แสดงทุกเขต" : "Show all districts"}
                      </button>
                    </div>
                  ) : (
                    visibleStations.map((station) => {
                      const meta = getThaiAqiMeta(station.currentPM25);
                      const isFav = favorites.includes(station.id.toLowerCase());
                      const isSelected = selectedStation.id === station.id && drawerOpen;
                      const badgeTextColor = meta.tier === "Moderate" ? "#0F172A" : "#FFFFFF";

                      return (
                        <div
                          title={`${station.stationTh} · ${formatObservedAt(station.observedAt)}`}
                          key={station.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleOpenStation(station, "all")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleOpenStation(station, "all");
                            }
                          }}
                          className={`bg-white/75 border border-neutral-300/70 rounded-xl sm:rounded-2xl p-2.5 sm:p-3 text-left cursor-pointer transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600 focus-visible:ring-offset-2 active:scale-[0.98] flex flex-col gap-2 sm:gap-3 ${
                            isSelected
                              ? "ring-2 ring-neutral-600 shadow-sm"
                              : "shadow-sm"
                          }`}
                        >
                          <div className="flex items-start gap-2.5 sm:gap-3">
                            <AirQualityExpression pm25={station.currentPM25} className="h-11 w-11 sm:h-[52px] sm:w-[52px]" />

                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <h3 className="body-1 text-slate-900 truncate">
                                    {lang === "TH" ? station.nameTh : station.nameEn}
                                  </h3>
                                  <p className="caption-4 text-slate-600 truncate">
                                    {lang === "TH"
                                      ? station.stationTh
                                      : station.stationEn}
                                  </p>
                                  <p className="text-xs text-slate-500 mt-1">
                                    {formatObservedAt(station.observedAt)}
                                    {station.isStale ? (lang === "TH" ? " · ข้อมูลเก่า" : " · Stale") : ""}
                                  </p>
                                </div>

                                <button
                                  type="button"
                                  onClick={(e) => toggleFavorite(station.id, e)}
                                  aria-pressed={isFav}
                                  aria-label={
                                    isFav
                                      ? `Remove ${station.nameEn} from favorites`
                                      : `Add ${station.nameEn} to favorites`
                                  }
                                  className={`w-8 h-8 rounded-full border border-neutral-300/70 shadow-sm flex items-center justify-center shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600 ${
                                    isFav
                                      ? "bg-red-50 text-[#EF4444]"
                                      : "bg-white/75 text-slate-600 hover:bg-slate-100"
                                  }`}
                                >
                                  <Heart
                                    size={16}
                                    weight={isFav ? "fill" : "bold"}
                                    aria-hidden
                                  />
                                </button>
                              </div>

                              {/* Solid color-coded AQI tier indicator */}
                              <div className="mt-2 flex items-center gap-2">
                                <span
                                  className="inline-flex items-center px-2 py-0.5 rounded-full border border-neutral-300/70 caption-3 shadow-sm"
                                  style={{ backgroundColor: meta.color, color: badgeTextColor }}
                                >
                                  {lang === "TH" ? meta.thaiLabel : meta.englishLabel}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* 3 crisp comic-outlined metric pills */}
                          <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                            <div className="bg-neutral-100/70 border-[1.5px] sm:border border-neutral-300/70 rounded-full px-1.5 sm:px-2 py-0.5 sm:py-1 shadow-sm flex items-center justify-center gap-1 text-slate-900 min-w-0">
                              <MiniDustIcon size={13} />
                              <span className="caption-3 tabular-nums truncate">
                                {formatReading(station.currentPM25)}
                              </span>
                              <span className="caption-5 text-slate-600">µg</span>
                            </div>

                            <div className="bg-neutral-100/70 border-[1.5px] sm:border border-neutral-300/70 rounded-full px-1.5 sm:px-2 py-0.5 sm:py-1 shadow-sm flex items-center justify-center gap-1 text-slate-900 min-w-0">
                              <MiniThermometerIcon size={13} />
                              <span className="caption-3 tabular-nums truncate">
                                {formatReading(station.temperatureC)}
                              </span>
                              <span className="caption-5 text-slate-600">°C</span>
                            </div>

                            <div className="bg-neutral-100/70 border-[1.5px] sm:border border-neutral-300/70 rounded-full px-1.5 sm:px-2 py-0.5 sm:py-1 shadow-sm flex items-center justify-center gap-1 text-slate-900 min-w-0">
                              <MiniWindIcon size={13} />
                              <span className="caption-3 tabular-nums truncate">
                                {formatReading(station.windSpeedMs)}
                              </span>
                              <span className="caption-5 text-slate-600">m/s</span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Desktop Sidebar Collapse Toggle */}
              <button
                type="button"
                onClick={() => setSidebarOpen((v) => !v)}
                aria-expanded={sidebarOpen}
                aria-label={sidebarOpen ? "Collapse station sidebar" : "Expand station sidebar"}
                className="hidden lg:flex ml-2 mt-4 w-10 h-10 rounded-full bg-white/75 border border-neutral-300/70 shadow-sm items-center justify-center text-slate-900 hover:bg-neutral-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600 active:scale-[0.98]"
              >
                {sidebarOpen ? (
                  <CaretLeft size={18} weight="bold" aria-hidden />
                ) : (
                  <CaretRight size={18} weight="bold" aria-hidden />
                )}
              </button>
            </div>

            {/* ── Bottom 7 Day Bangkok Forecast Strip (Mobile Swipe + iPad Grid + Desktop Dock) ── */}
            <div className="mx-2.5 my-2.5 sm:mx-4 sm:mb-4 lg:mt-4 xl:m-0 xl:absolute xl:bottom-4 xl:inset-x-4 z-20 bg-white/80 backdrop-blur-xl border border-neutral-300/70 rounded-xl sm:rounded-2xl p-2.5 sm:p-3 shadow-sm hidden sm:flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 px-0.5 sm:px-1">
                <h2 className="title-4 text-slate-900">{lang === "TH" ? "พยากรณ์วันพรุ่งนี้" : "Tomorrow’s forecast"}</h2>
                {forecastData?.modelName && tomorrow && <span className="caption-5 text-slate-700">{forecastData.modelName}</span>}
              </div>
              <div className="mt-2 flex items-center gap-3 rounded-xl bg-neutral-200/55 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">{selectedStation.nameTh}</p>
                  <p className="text-sm text-slate-600">{tomorrow ? tomorrow.date
                    : drawerStatus === "loading" ? (lang === "TH" ? "กำลังโหลดพยากรณ์…" : "Loading forecast…")
                    : (lang === "TH" ? "ยังไม่มีพยากรณ์วันพรุ่งนี้สำหรับสถานีนี้" : "Tomorrow’s forecast is unavailable for this station")}</p>
                </div>
                {tomorrow && <p className="shrink-0 font-bold tabular-nums text-neutral-700">
                  {formatReading(tomorrow.pm25)} <span className="text-xs font-normal">µg/m³</span>
                </p>}
              </div>
            </div>
          </section>
        )}

        {/* Footer */}
        <footer className="pt-2 hidden sm:flex flex-wrap items-center justify-between gap-4">
          <p className="caption-5 text-slate-600">
            PM2.5 Sentinel ·{" "}
            {lang === "TH"
              ? "พอร์ทัลข้อมูลคุณภาพอากาศกรุงเทพมหานคร"
              : "Bangkok Civic Environmental Portal"}
          </p>
          <p className="caption-5 text-slate-600">
            {forecastData?.modelName ?? "Bangkok Multi Horizon GBDT"} ·{" "}
            <span className="tabular-nums">
              {new Date().getFullYear()}
            </span>
          </p>
        </footer>
      </main>

      {/* ── Slide-Over District Analytics Drawer (Tuned Random Forest + SHAP) ── */}
      <DistrictAnalyticsDrawer
        isOpen={drawerOpen}
        station={selectedStation}
        lang={lang}
        horizon={horizon}
        focusSection={drawerSection}
        status={drawerStatus}
        data={forecastData}
        error={drawerError}
        onClose={() => {
          setDrawerOpen(false);
          setActiveNav("map");
        }}
        onHorizonChange={handleHorizonChange}
        onRefresh={handleManualRefresh}
        onLoadFallback={handleLoadFallback}
      />

      {/* ── Thai AQI 5 Tier Standards Reference Modal ── */}
      {showStandardsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"
          role="dialog"
          aria-modal="true"
          aria-label={lang === "TH" ? "เกณฑ์ดัชนีคุณภาพอากาศ 5 ระดับ" : "Thai AQI 5 Tier Standards"}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowStandardsModal(false);
              setActiveNav("map");
            }
          }}
        >
          <div className="w-full max-w-2xl bg-white/95 backdrop-blur-md border border-neutral-300/70 rounded-2xl p-6 shadow-sm flex flex-col gap-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="heading-6 text-slate-900">
                  {lang === "TH"
                    ? "เกณฑ์มาตรฐานคุณภาพอากาศ PM2.5 (ประเทศไทย)"
                    : "Thailand 5 Tier PM2.5 Standard Reference"}
                </h2>
                <p className="caption-4 text-slate-600 mt-0.5">
                  {lang === "TH"
                    ? "ค่าเฉลี่ย 24 ชั่วโมงในหน่วยไมโครกรัมต่อลูกบาศก์เมตร (µg/m³)"
                    : "24 hour average concentration in µg/m³"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowStandardsModal(false);
                  setActiveNav("map");
                }}
                aria-label="Close AQI standards"
                className="btn-outline button-sm"
              >
                <X size={16} weight="bold" aria-hidden />
              </button>
            </div>

            <div className="flex flex-col gap-3">
              {THAI_AQI_TIERS.map((tier) => {
                return (
                  <div
                    key={tier.tier}
                    style={{ backgroundColor: tier.bgTint, borderLeftColor: tier.color }}
                    className="rounded-xl border border-l-4 border-neutral-900/10 shadow-sm p-3 flex items-center gap-3"
                  >
                    <AirQualityExpression tier={tier.tier} className="h-12 w-12" />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="body-4 text-slate-900">
                          {lang === "TH" ? tier.thaiLabel : tier.englishLabel}
                        </span>
                        <span
                          className="caption-3 px-2.5 py-1 rounded-full border border-neutral-900/15 text-neutral-950 tabular-nums"
                          style={{ backgroundColor: tier.color, color: tier.tier === "Moderate" ? "#0F172A" : "#FFFFFF" }}
                        >
                          {tier.rangeLabel} µg/m³
                        </span>
                      </div>
                      <p className="caption-4 text-slate-800 mt-1">
                        {lang === "TH" ? tier.adviceTh : tier.adviceEn}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}