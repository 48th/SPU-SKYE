"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartBar, House, MapTrifold, Tree } from "@phosphor-icons/react";
import { useState } from "react";

const tabs = [
  { href: "/", label: "หน้าฝุ่น", Icon: House },
  { href: "/map", label: "แผนที่", Icon: MapTrifold },
  { href: "/parks", label: "สวน", Icon: Tree },
] as const;

export default function MobileAirNavigation() {
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const active = path === "/pm25-forecast" || path === "/station-forecast" ? "/" : path;
  if (!tabs.some(tab => tab.href === active)) return null;
  const item = "flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[11px] font-semibold focus-visible:outline-emerald-700";

  return (
    <>
      {active === "/parks" && <div className="h-[calc(5rem+env(safe-area-inset-bottom,0px))] sm:hidden" aria-hidden="true" />}
      <nav aria-label="เมนูหลักบนมือถือ" className="bangkok-ui-font fixed inset-x-3 z-30 mx-auto max-w-sm sm:hidden [bottom:calc(.65rem+env(safe-area-inset-bottom,0px))]">
        {menuOpen && (
          <div id="mobile-insights-menu" className="absolute inset-x-0 bottom-full mb-2 rounded-2xl border border-neutral-200 bg-white p-2 shadow-lg">
            <a href="/map#shap" onClick={() => setMenuOpen(false)} className="block rounded-xl px-3 py-3 text-sm font-semibold hover:bg-neutral-100">วิเคราะห์ปัจจัย SHAP</a>
            <a href="/map#standards" onClick={() => setMenuOpen(false)} className="block rounded-xl px-3 py-3 text-sm font-semibold hover:bg-neutral-100">เกณฑ์มาตรฐาน PM2.5</a>
          </div>
        )}
        <div className="grid grid-cols-4 gap-1 rounded-2xl border border-neutral-200 bg-white/95 p-1 shadow-[0_3px_14px_#0f172a1c] backdrop-blur-lg">
          {tabs.map(({href, label, Icon}) => (
            <Link key={href} href={href} aria-current={active === href ? "page" : undefined}
              onClick={() => setMenuOpen(false)}
              className={item + (active === href ? " bg-emerald-100 text-emerald-950" : " text-slate-700")}>
              <Icon size={21} weight={active === href ? "fill" : "regular"} aria-hidden="true" />{label}
            </Link>
          ))}
          <button type="button" aria-expanded={menuOpen} aria-controls={menuOpen ? "mobile-insights-menu" : undefined}
            onClick={() => setMenuOpen(value => !value)} className={item + (menuOpen ? " bg-emerald-100 text-emerald-950" : " text-slate-700")}>
            <ChartBar size={21} aria-hidden="true" />วิเคราะห์
          </button>
        </div>
      </nav>
    </>
  );
}
