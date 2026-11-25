"use client";
import { useSyncExternalStore } from "react";

const key = "spu-skye:station-favorites";
let fallback = "[]";

function snapshot() {
  try { return window.localStorage.getItem(key) ?? fallback; }
  catch { return fallback; }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(key, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(key, onChange);
  };
}

function parse(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
}

export function useStationFavorites() {
  const ids = parse(useSyncExternalStore(subscribe, snapshot, () => "[]"));
  return {
    ids,
    toggle(id: string) {
      const station = id.toLowerCase();
      const current = parse(snapshot());
      fallback = JSON.stringify(current.includes(station) ? current.filter(item => item !== station) : [...current, station]);
      try { window.localStorage.setItem(key, fallback); } catch { /* Session-only when storage is unavailable. */ }
      window.dispatchEvent(new Event(key));
    },
  };
}
