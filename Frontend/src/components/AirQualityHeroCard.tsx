"use client";
import { AirQualityExpression } from "@/components/CivicIllustrationAssets";

import React from "react";
import { CaretDown } from "@phosphor-icons/react";
import {
  getAqiStatus,
  getAqiColor,
  getThaiAqiMeta,
  type AqiStatus,
  type ForecastResponse,
} from "@/lib/forecastService";

interface SeverityMeta {
  status: AqiStatus;
  thaiLabel: string;
  iconLabel: string;
  headline: string;
  advice: string;
  rangeLabel: string;
}

const SEVERITY_CONFIG: Record<AqiStatus, SeverityMeta> = {
  Good: {
    status: "Good",
    thaiLabel: "อากาศดีมาก",
    iconLabel: "Happy smiling face badge representing clean air",
    headline: "อากาศดีมาก สูดหายใจได้เต็มปอด",
    advice: "คุณภาพอากาศปลอดภัย เหมาะกับทุกกิจกรรมกลางแจ้ง",
    rangeLabel: "0 to 25",
  },
  Moderate: {
    status: "Moderate",
    thaiLabel: "ปานกลาง",
    iconLabel: "Calm face badge representing moderate air quality",
    headline: "คุณภาพอากาศปานกลาง เริ่มมีฝุ่นละออง",
    advice: "คนทั่วไปใช้ชีวิตได้ปกติ กลุ่มเสี่ยงควรสังเกตอาการ",
    rangeLabel: "25.1 to 37.5",
  },
  "Unhealthy for Sensitive": {
    status: "Unhealthy for Sensitive",
    thaiLabel: "เริ่มมีผลกระทบ",
    iconLabel: "Masked face badge representing elevated fine dust",
    headline: "ฝุ่นเริ่มเยอะ ควรสวมหน้ากากป้องกัน",
    advice: "ลดระยะเวลาทำกิจกรรมกลางแจ้งที่ใช้แรงมาก",
    rangeLabel: "37.6 to 75",
  },
  Unhealthy: {
    status: "Unhealthy",
    thaiLabel: "มีผลกระทบต่อสุขภาพ",
    iconLabel: "Dizzy face badge representing hazardous dust concentration",
    headline: "ฝุ่นหนาแน่นสูง อันตรายต่อสุขภาพ",
    advice: "งดกิจกรรมกลางแจ้ง ปิดประตูหน้าต่างและเปิดเครื่องฟอกอากาศ",
    rangeLabel: "Above 75",
  },
};

const SCALE_SEGMENTS: {
  status: AqiStatus;
  label: string;
  threshold: string;
}[] = [
  { status: "Good", label: "Good", threshold: "≤ 25" },
  {
    status: "Moderate",
    label: "Moderate",
    threshold: "≤ 37.5",
  },
  {
    status: "Unhealthy for Sensitive",
    label: "Sensitive",
    threshold: "≤ 75",
  },
  {
    status: "Unhealthy",
    label: "Unhealthy",
    threshold: "> 75",
  },
];

function computeScalePosition(pm25: number): number {
  let pct: number;
  if (pm25 <= 25) {
    pct = (Math.max(0, pm25) / 25) * 25;
  } else if (pm25 <= 37.5) {
    pct = 25 + ((pm25 - 25) / 12.5) * 25;
  } else if (pm25 <= 75) {
    pct = 50 + ((pm25 - 37.5) / 37.5) * 25;
  } else {
    pct = 75 + Math.min(1, (pm25 - 75) / 75) * 25;
  }
  return Math.max(4, Math.min(96, pct));
}

/**
 * AirBKK / IQAir style flat circular AQI facial expression icon.
 * Uses flat solid colors only (no gradients).
 */
interface AirQualityHeroCardProps {
  data: ForecastResponse;
}

export default function AirQualityHeroCard({ data }: AirQualityHeroCardProps) {
  const status = getAqiStatus(data.currentPM25);
  const meta = SEVERITY_CONFIG[status];
  const palette = getThaiAqiMeta(data.currentPM25);
  const markerPct = computeScalePosition(data.currentPM25);
  const stateKey = `${data.district}-${status}-${data.currentPM25.toFixed(1)}`;

  return (
    <section
      aria-label={`Current air quality status for ${data.district}: ${status}`}
      className="rounded-2xl p-6 transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
      style={{
        backgroundColor: palette.bgTint,
        borderWidth: "1px",
        borderStyle: "solid",
        borderColor: palette.color,
      }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        {/* Left Section: AirBKK style circular face icon badge & at a glance status */}
        <div className="lg:col-span-7 flex flex-col sm:flex-row items-start sm:items-center gap-4 min-w-0">
          <div
            key={stateKey}
            className="emoji-entrance w-16 h-16 rounded-full flex items-center justify-center shrink-0 select-none"
            style={{
              backgroundColor: palette.bgTint,
              borderWidth: "1px",
              borderStyle: "solid",
              borderColor: palette.color,
            }}
            role="img"
            aria-label={meta.iconLabel}
          >
            <AirQualityExpression pm25={data.currentPM25} className="h-16 w-16" />
          </div>

          <div className="flex flex-col gap-2 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-md caption-3"
                style={{
                  backgroundColor: palette.bgTint,
                  color: "#0F172A",
                  borderWidth: "1px",
                  borderStyle: "solid",
                  borderColor: palette.color,
                }}
              >
                {status} · {meta.thaiLabel}
              </span>
              <span className="caption-4 text-slate-700">
                {data.district} monitoring station
              </span>
            </div>

            <h2 className="heading-5 text-slate-900 text-balance">
              {meta.headline}
            </h2>

            <p className="body-6 text-slate-700 text-pretty">{meta.advice}</p>
          </div>
        </div>

        {/* Right Section: Live PM2.5 reading & 4 segment AQI scale bar */}
        <div className="lg:col-span-5 flex flex-col gap-4 bg-white rounded-xl p-4 border border-[#E2E8F0] min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <span className="font-mono heading-3 text-slate-900 tabular-nums">
                {data.currentPM25.toFixed(1)}
              </span>
              <span className="font-mono body-5 text-slate-500">µg/m³</span>
            </div>
            <span className="caption-4 text-slate-600">
              Band:{" "}
              <span
                className="font-mono caption-3 tabular-nums"
                style={{ color: "#0F172A" }}
              >
                {meta.rangeLabel}
              </span>
            </span>
          </div>

          {/* 4 segment color coded scale bar with active marker */}
          <div className="flex flex-col gap-1">
            {/* Active marker track (B7: animate transform only) */}
            <div className="relative h-4 w-full" aria-hidden>
              <div
                className="absolute inset-y-0 left-0 w-full transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{ transform: `translateX(${markerPct}%)` }}
              >
                <div className="absolute top-0 left-0 -translate-x-1/2 flex items-center justify-center">
                  <CaretDown
                    size={16}
                    weight="fill"
                    color={palette.color}
                    aria-hidden
                  />
                </div>
              </div>
            </div>

            {/* 4 equal color segments */}
            <div
              className="grid grid-cols-4 gap-1 w-full"
              role="img"
              aria-label={`PM2.5 scale indicator at ${data.currentPM25.toFixed(1)} micrograms per cubic meter (${status})`}
            >
              {SCALE_SEGMENTS.map((seg) => {
                const isActive = seg.status === status;
                return (
                  <div
                    key={seg.status}
                    className="h-3 rounded-sm transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                    style={{
                      backgroundColor: getAqiColor(seg.status),
                      opacity: isActive ? 1 : 0.3,
                    }}
                  />
                );
              })}
            </div>

            {/* Scale labels underneath */}
            <div className="grid grid-cols-4 gap-1 w-full pt-1">
              {SCALE_SEGMENTS.map((seg) => {
                const isActive = seg.status === status;
                return (
                  <div
                    key={seg.status}
                    className="flex flex-col items-start min-w-0"
                  >
                    <span
                      className={`caption-3 truncate max-w-full ${
                        isActive ? "text-slate-900" : "text-slate-500"
                      }`}
                    >
                      {seg.label}
                    </span>
                    <span className="font-mono caption-5 text-slate-500 tabular-nums">
                      {seg.threshold}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
