// WIB (UTC+7) time helpers. Timings are absolute date+times entered in WIB.
//
// A timing's `when` is a wall-clock string "YYYY-MM-DDTHH:MM" with NO timezone;
// we always interpret it as WIB. Trick: build the value with Date.UTC(...) then
// subtract the WIB offset to get the real UTC epoch.

import { WIB_OFFSET_MINUTES } from "./config.js";

const OFFSET_MS = WIB_OFFSET_MINUTES * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Parse a WIB wall-clock "YYYY-MM-DDTHH:MM" (seconds optional) into an epoch ms,
 * or null if it doesn't parse.
 */
export function wibToEpoch(when: string): number | null {
  if (typeof when !== "string" || when.trim() === "") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(when.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  const epoch = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm)) - OFFSET_MS;
  return Number.isNaN(epoch) ? null : epoch;
}

/** Epoch ms -> WIB "YYYY-MM-DDTHH:MM" (for a datetime-local default value). */
export function epochToWibInput(epoch: number): string {
  const w = new Date(epoch + OFFSET_MS);
  return (
    `${w.getUTCFullYear()}-${pad2(w.getUTCMonth() + 1)}-${pad2(w.getUTCDate())}` +
    `T${pad2(w.getUTCHours())}:${pad2(w.getUTCMinutes())}`
  );
}

/** Epoch ms -> friendly WIB display like "17 Jul 12:00". */
export function formatWibDisplay(epoch: number): string {
  const w = new Date(epoch + OFFSET_MS);
  return `${pad2(w.getUTCDate())} ${MONTHS[w.getUTCMonth()]} ${pad2(w.getUTCHours())}:${pad2(w.getUTCMinutes())}`;
}
