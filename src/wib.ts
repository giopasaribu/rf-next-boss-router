// WIB (UTC+7) time helpers. All boss times in this app are WIB.
//
// Implementation trick: shift an epoch by +7h and read the UTC fields — those
// then represent the WIB wall clock. Shift back to get a real UTC epoch.

import { WIB_OFFSET_MINUTES } from "./config.js";

const OFFSET_MS = WIB_OFFSET_MINUTES * 60 * 1000;

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Parse "H:MM"/"HH:MM" into {hh, mm}, or null if invalid. */
export function parseHhmm(value: string): { hh: number; mm: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return { hh, mm };
}

/** Epoch ms of TODAY's HH:MM in WIB, where "today" is determined in WIB. */
export function spawnEpochToday(hh: number, mm: number, now: number): number {
  const wibNow = new Date(now + OFFSET_MS);
  return (
    Date.UTC(wibNow.getUTCFullYear(), wibNow.getUTCMonth(), wibNow.getUTCDate(), hh, mm) -
    OFFSET_MS
  );
}

/** Format an epoch ms as its WIB "HH:MM". */
export function toWibHhmm(epoch: number): string {
  const wib = new Date(epoch + OFFSET_MS);
  return `${pad2(wib.getUTCHours())}:${pad2(wib.getUTCMinutes())}`;
}

/** A WIB calendar-day key like "2026-07-16" (for once-per-day reminder firing). */
export function wibDayKey(now: number): string {
  const wib = new Date(now + OFFSET_MS);
  return `${wib.getUTCFullYear()}-${pad2(wib.getUTCMonth() + 1)}-${pad2(wib.getUTCDate())}`;
}
