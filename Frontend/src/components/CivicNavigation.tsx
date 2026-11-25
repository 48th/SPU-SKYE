"use client";

import Link from "next/link";

export type MapNavKey = "map" | "hourly" | "standards";

const navItems = [
  { key: "map", href: "/map", th: "แผนที่คุณภาพอากาศ", en: "Air Quality Map", shortTh: "แผนที่", shortEn: "Map" },
  { key: "hourly", href: "/map#hourly", th: "พยากรณ์รายชั่วโมง", en: "Hourly Forecast", shortTh: "รายชั่วโมง", shortEn: "Hourly" },
  { key: "standards", href: "/map#standards", th: "ดัชนีมาตรฐาน", en: "AQI Standards", shortTh: "มาตรฐาน", shortEn: "AQI" },
  { key: "parks", href: "/parks", th: "สวนสาธารณะ", en: "Parks", shortTh: "สวน", shortEn: "Parks" },
] as const;

type Props = {
  lang: "TH" | "EN";
  active: MapNavKey | "parks";
  onMapNavigate?: (key: MapNavKey) => void;
};

export default function CivicNavigation({ lang, active, onMapNavigate }: Props) {
  return (
    <nav aria-label={lang === "TH" ? "เมนูหลัก" : "Main navigation"}
      className="order-3 xl:order-2 grid w-full grid-cols-4 items-center gap-1 overflow-x-auto rounded-full border border-neutral-300/70 bg-neutral-200/65 p-1 text-slate-800 shadow-sm backdrop-blur-md no-scrollbar xl:inline-flex xl:w-auto">
      {navItems.map(({ key, href, th, en, shortTh, shortEn }) => {
        const current = key === active ? "page" : undefined;
        const label = (
          <>
            <span className="md:hidden">{lang === "TH" ? shortTh : shortEn}</span>
            <span className="hidden md:inline">{lang === "TH" ? th : en}</span>
          </>
        );
        const className = "whitespace-nowrap rounded-full border border-transparent px-3 py-2 text-center text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-700 xl:px-4 " +
          (current ? "bg-neutral-800 text-white shadow-sm" : "text-slate-700 hover:bg-white");

        if (onMapNavigate && key !== "parks") {
          return <button key={key} type="button" onClick={() => onMapNavigate(key)} aria-current={current} className={className}>{label}</button>;
        }
        return <Link key={key} href={href} aria-current={current} className={className}>{label}</Link>;
      })}
    </nav>
  );
}
