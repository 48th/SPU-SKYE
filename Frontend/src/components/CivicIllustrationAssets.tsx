"use client";

import React from "react";
import { getThaiAqiMeta, THAI_AQI_TIERS, type ThaiAqiTier } from "@/lib/forecastService";

// ── 1. BangkokSkylineBackdrop (Cel-Shaded Toon Style) ───────────────────────
// Bold dark outlines (#0F172A, strokeWidth=2.5) + flat solid base fills
// overlaid with hard-edged polygonal shadow bands (zero blur, zero gradients).

export function BangkokSkylineBackdrop({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1440 128"
      fill="none"
      preserveAspectRatio="xMidYMax slice"
      className={className}
      aria-hidden="true"
    >
      {/* Cel-shaded comic clouds (flat white fill + hard #BAE6FD lower shadow band + #0F172A outline) */}
      <g stroke="#0F172A" strokeWidth="2.5" strokeLinejoin="round">
        {/* Cloud 1 */}
        <path
          d="M116 54C111 54 106 49 107 43C108 37 113 33 119 33C122 24 131 19 141 20C150 21 157 28 159 36C166 36 171 42 170 48C169 52 165 54 160 54H116Z"
          fill="#FFFFFF"
        />
        <path
          d="M113 48H167C166 51 163 53 160 53H116C114 53 113 51 113 48Z"
          fill="#BAE6FD"
          stroke="none"
        />

        {/* Cloud 2 */}
        <path
          d="M522 44C517 44 513 40 514 35C515 30 519 26 524 26C527 18 535 14 544 15C552 16 558 22 559 29C565 29 569 34 568 39C567 42 564 44 560 44H522Z"
          fill="#FFFFFF"
        />
        <path
          d="M519 39H566C565 42 562 43 560 43H522C520 43 519 41 519 39Z"
          fill="#BAE6FD"
          stroke="none"
        />

        {/* Cloud 3 */}
        <path
          d="M982 52C977 52 973 48 974 42C975 36 980 32 986 32C989 23 998 18 1008 19C1017 20 1024 27 1025 35C1032 35 1037 41 1036 47C1035 50 1031 52 1026 52H982Z"
          fill="#FFFFFF"
        />
        <path
          d="M979 46H1033C1032 49 1029 51 1026 51H982C980 51 979 49 979 46Z"
          fill="#BAE6FD"
          stroke="none"
        />
      </g>

      {/* Modern Bangkok High-rises with right-side hard shadow bands */}
      <g>
        {/* Tower group left */}
        <rect x="44" y="64" width="38" height="64" fill="#E2E8F0" stroke="#0F172A" strokeWidth="2.5" />
        <polygon points="70,65 81,65 81,127 70,127" fill="#94A3B8" />
        <rect x="90" y="48" width="46" height="80" fill="#F1F5F9" stroke="#0F172A" strokeWidth="2.5" />
        <polygon points="122,49 135,49 135,127 122,127" fill="#CBD5E1" />
        <rect x="144" y="72" width="32" height="56" fill="#E2E8F0" stroke="#0F172A" strokeWidth="2.5" />
        <polygon points="166,73 175,73 175,127 166,127" fill="#94A3B8" />

        {/* Tower group center */}
        <rect x="615" y="50" width="44" height="78" fill="#E2E8F0" stroke="#0F172A" strokeWidth="2.5" />
        <polygon points="645,51 658,51 658,127 645,127" fill="#94A3B8" />
        <rect x="668" y="34" width="52" height="94" fill="#F1F5F9" stroke="#0F172A" strokeWidth="2.5" />
        <polygon points="704,35 719,35 719,127 704,127" fill="#CBD5E1" />
        <rect x="684" y="20" width="20" height="14" fill="#CBD5E1" stroke="#0F172A" strokeWidth="2.5" />
        <rect x="728" y="58" width="40" height="70" fill="#E2E8F0" stroke="#0F172A" strokeWidth="2.5" />
        <polygon points="755,59 767,59 767,127 755,127" fill="#94A3B8" />

        {/* Stepped Pixel Tower (MahaNakhon-inspired) */}
        <path
          d="M840 128V30H876V46H868V58H880V74H872V86H882V128H840Z"
          fill="#E0F2FE"
          stroke="#0F172A"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <polygon points="864,31 875,31 875,45 867,45 867,59 879,59 879,73 871,73 871,87 881,87 881,127 864,127" fill="#7DD3FC" />

        {/* Tower group right */}
        <rect x="1140" y="52" width="48" height="76" fill="#E2E8F0" stroke="#0F172A" strokeWidth="2.5" />
        <polygon points="1172,53 1187,53 1187,127 1172,127" fill="#94A3B8" />
        <rect x="1196" y="38" width="56" height="90" fill="#F1F5F9" stroke="#0F172A" strokeWidth="2.5" />
        <polygon points="1234,39 1251,39 1251,127 1234,127" fill="#CBD5E1" />
        <rect x="1260" y="62" width="38" height="66" fill="#E2E8F0" stroke="#0F172A" strokeWidth="2.5" />
        <polygon points="1285,63 1297,63 1297,127 1285,127" fill="#94A3B8" />
        <rect x="1352" y="54" width="46" height="74" fill="#E2E8F0" stroke="#0F172A" strokeWidth="2.5" />
        <polygon points="1383,55 1397,55 1397,127 1383,127" fill="#94A3B8" />
      </g>

      {/* Wat Arun Prang (Cel-Shaded cream stone + hard warm-gray shadow band + thick outline) */}
      <g>
        {/* Satellite prangs */}
        <path d="M236 128V98L244 74L252 98V128H236Z" fill="#F8FAFC" stroke="#0F172A" strokeWidth="2.5" strokeLinejoin="round" />
        <polygon points="244,77 251,98 251,127 244,127" fill="#CBD5E1" />
        <path d="M308 128V98L316 74L324 98V128H308Z" fill="#F8FAFC" stroke="#0F172A" strokeWidth="2.5" strokeLinejoin="round" />
        <polygon points="316,77 323,98 323,127 316,127" fill="#CBD5E1" />

        {/* Central prang */}
        <path
          d="M256 128V92L264 86V68L272 62V44L280 24L288 44V62L296 68V86L304 92V128H256Z"
          fill="#FEF3C7"
          stroke="#0F172A"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <polygon
          points="280,27 287,44 287,62 295,68 295,86 303,92 303,127 280,127"
          fill="#FDE68A"
        />
        <line x1="280" y1="12" x2="280" y2="24" stroke="#0F172A" strokeWidth="2.5" strokeLinecap="round" />
      </g>

      {/* Rama VIII Bridge (Inverted-Y Pylon + Stay Cables + Cel-Shaded Deck) */}
      <g>
        <g stroke="#0F172A" strokeWidth="1.8" strokeLinecap="round">
          <line x1="462" y1="30" x2="366" y2="96" />
          <line x1="462" y1="36" x2="388" y2="96" />
          <line x1="462" y1="42" x2="412" y2="96" />
          <line x1="462" y1="30" x2="578" y2="96" />
          <line x1="462" y1="36" x2="554" y2="96" />
          <line x1="462" y1="42" x2="528" y2="96" />
        </g>
        <rect x="348" y="96" width="248" height="7" rx="2" fill="#FDE047" stroke="#0F172A" strokeWidth="2.5" />
        <path
          d="M442 96L458 24H466L482 96H473L462 46L451 96H442Z"
          fill="#FACC15"
          stroke="#0F172A"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      </g>

      {/* Foreground Cel-Shaded Park Trees (green base + hard dark-green shadow crescent + #0F172A outline) */}
      <g>
        {[
          { cx: 32, cy: 112, r: 14 },
          { cx: 212, cy: 115, r: 13 },
          { cx: 342, cy: 114, r: 13 },
          { cx: 598, cy: 114, r: 13 },
          { cx: 804, cy: 112, r: 15 },
          { cx: 1114, cy: 114, r: 14 },
          { cx: 1316, cy: 115, r: 13 },
          { cx: 1412, cy: 112, r: 14 },
        ].map((t, idx) => (
          <g key={idx}>
            <circle cx={t.cx} cy={t.cy} r={t.r} fill="#4ADE80" stroke="#0F172A" strokeWidth="2.5" />
            <path
              d={`M ${t.cx + 2} ${t.cy - t.r + 3} A ${t.r - 2} ${t.r - 2} 0 0 1 ${t.cx + t.r - 2} ${t.cy + 2} A ${t.r - 2} ${t.r - 2} 0 0 1 ${t.cx - 3} ${t.cy + t.r - 3} A ${t.r} ${t.r} 0 0 0 ${t.cx + 2} ${t.cy - t.r + 3} Z`}
              fill="#16A34A"
            />
          </g>
        ))}
      </g>
    </svg>
  );
}

// ── 2. SentinelCivicCrest (Cel-Shaded Emblem) ──────────────────────────────

export function SentinelCivicCrest({
  size = 44,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Base circle + hard cel-shaded shadow band */}
      <circle cx="24" cy="24" r="21" fill="#005A50" stroke="#0F172A" strokeWidth="2.5" />
      <path
        d="M36 8A20 20 0 0 1 11 39A19 19 0 0 0 36 8Z"
        fill="#003D36"
      />
      {/* Bold wind lines */}
      <path
        d="M11 20H27C29.5 20 31.5 18 31.5 15.5C31.5 13 29.5 11 27 11C25 11 23.4 12.2 22.8 14"
        stroke="#FFFFFF"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M11 27H31C33.8 27 36 29.2 36 32C36 34.8 33.8 37 31 37C28.8 37 27 35.5 26.4 33.5"
        stroke="#A7F3D0"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      {/* Cel-shaded leaf */}
      <path
        d="M36 12C30.8 12 26.8 16 26.8 21.2C32 21.2 36 17.2 36 12Z"
        fill="#4ADE80"
        stroke="#0F172A"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function NearbyStationBadge({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="7" cy="12.5" r="4.2" fill="#4ADE80" stroke="#0F172A" strokeWidth="2" />
      <rect x="6" y="16" width="2" height="4.5" fill="#92400E" stroke="#0F172A" strokeWidth="1.5" />
      <path
        d="M15.5 3C12.5 3 10 5.5 10 8.5C10 12.5 15.5 20 15.5 20C15.5 20 21 12.5 21 8.5C21 5.5 18.5 3 15.5 3Z"
        fill="#38BDF8"
        stroke="#0F172A"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="15.5" cy="8.5" r="2" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.5" />
    </svg>
  );
}

export function TopTenBadge({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.5" y="13" width="5" height="8" rx="1" fill="#FACC15" stroke="#0F172A" strokeWidth="2" />
      <rect x="9.5" y="8" width="5" height="13" rx="1" fill="#FB923C" stroke="#0F172A" strokeWidth="2" />
      <rect x="16.5" y="3.5" width="5" height="17.5" rx="1" fill="#EF4444" stroke="#0F172A" strokeWidth="2" />
    </svg>
  );
}

// ── 5. MiniMetricIcons (Bold Comic-Outlined Icons) ─────────────────────────

export function MiniDustIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="5" cy="5.5" r="2.6" fill="#F97316" stroke="#0F172A" strokeWidth="1.5" />
      <circle cx="11.5" cy="4.5" r="1.9" fill="#FACC15" stroke="#0F172A" strokeWidth="1.5" />
      <circle cx="10.5" cy="11" r="2.7" fill="#00B0F0" stroke="#0F172A" strokeWidth="1.5" />
      <circle cx="4.2" cy="11.8" r="1.7" fill="#38BDF8" stroke="#0F172A" strokeWidth="1.4" />
    </svg>
  );
}

export function MiniThermometerIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5C6.8 1.5 5.8 2.5 5.8 3.7V8.8C4.9 9.5 4.3 10.6 4.3 11.9C4.3 13.9 5.9 15.5 8 15.5C10.1 15.5 11.7 13.9 11.7 11.9C11.7 10.6 11.1 9.5 10.2 8.8V3.7C10.2 2.5 9.2 1.5 8 1.5Z"
        fill="#FFFFFF"
        stroke="#0F172A"
        strokeWidth="1.6"
      />
      <circle cx="8" cy="11.9" r="2.1" fill="#EF4444" />
      <rect x="7.2" y="5.2" width="1.6" height="5.5" rx="0.8" fill="#EF4444" />
    </svg>
  );
}

export function MiniWindIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.8 6H10.5C12 6 13.2 4.8 13.2 3.3C13.2 1.8 12 0.8 10.5 0.8C9.3 0.8 8.3 1.5 8 2.5"
        stroke="#0F172A"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M1.8 10H12.2C13.7 10 14.9 11.2 14.9 12.7C14.9 14.2 13.7 15.2 12.2 15.2C11 15.2 10 14.5 9.7 13.5"
        stroke="#0284C7"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

const expressionFaces = {
  "Very Good": { ink: "#084C74", eyes: "M10 14q2-3 4 0m6 0q2-3 4 0", mouth: "M11 20q6 9 12 0Z" },
  Good: { ink: "#15552C", eyes: "M12 14h.01m10 0h.01", mouth: "M12 20q5 5 10 0" },
  Moderate: { ink: "#684306", eyes: "M12 14h.01m10 0h.01", mouth: "M13 21h8" },
  "Unhealthy for Sensitive": { ink: "#792C10", eyes: "M12 15h.01m10 0h.01", mouth: "M12 23q5-5 10 0", brows: "M10 11l4-2m6 0 4 2" },
  Unhealthy: { ink: "#821A31", eyes: "M10 14l4 2m6 0 4-2", mouth: "M13 24q4-7 8 0Z", brows: "M10 10l4 2m6 0 4-2" },
} satisfies Record<string, { ink: string; eyes: string; mouth: string; brows?: string }>;

export function getAirQualityExpression(pm25?: number | null, tier?: ThaiAqiTier) {
  const level = tier ?? (typeof pm25 === "number" && Number.isFinite(pm25) ? getThaiAqiMeta(pm25).tier : undefined);
  if (!level) return { image: null };
  const face: { ink: string; eyes: string; mouth: string; brows?: string } = expressionFaces[level];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 34 34" fill="none" stroke="${face.ink}" stroke-linecap="round" stroke-linejoin="round"><path d="${face.eyes}" stroke-width="2.5"/><path d="${face.mouth}" stroke-width="1.8"/>${face.brows ? `<path d="${face.brows}" stroke-width="1.4"/>` : ""}</svg>`;
  return { tint: THAI_AQI_TIERS.find(item => item.tier === level)!.bgTint, image: "data:image/svg+xml," + encodeURIComponent(svg) };
}

export function AirQualityExpression({ pm25, tier, className = "h-9 w-9" }: {
  pm25?: number | null;
  tier?: ThaiAqiTier;
  className?: string;
}) {
  const face = getAirQualityExpression(pm25, tier);
  return (
    <span aria-hidden="true" className={"grid shrink-0 place-items-center rounded-full text-neutral-600 ring-1 ring-inset ring-black/5 " + className}
      style={{ backgroundColor: face.tint }}>
      {face.image ? <img alt="" src={face.image} className="h-4/5 w-4/5" /> : "–"}
    </span>
  );
}
