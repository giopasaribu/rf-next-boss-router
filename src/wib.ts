// WIB (UTC+7) time helpers. All boss times in this app are WIB.
//
// Implementation trick: shift an epoch by +7h and read the UTC fields — those
// then represent the WIB wall clock. Shift back to get a real UTC epoch.

import { WIB_OFFSET_MINUTES, CYCLE_RESET_HOUR } from "./config.js";

const OFFSET_MS = WIB_OFFSET_MINUTES * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

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

/** Format an epoch ms as its WIB "HH:MM". */
export function toWibHhmm(epoch: number): string {
  const wib = new Date(epoch + OFFSET_MS);
  return `${pad2(wib.getUTCHours())}:${pad2(wib.getUTCMinutes())}`;
}

/**
 * Epoch of the current game day's start: the most recent 03:00 WIB at or before
 * `now`. Before 03:00 WIB, the game day started at 03:00 the previous calendar day.
 */
function cycleAnchor(now: number): number {
  const wibNow = new Date(now + OFFSET_MS);
  let anchor =
    Date.UTC(wibNow.getUTCFullYear(), wibNow.getUTCMonth(), wibNow.getUTCDate(), CYCLE_RESET_HOUR, 0) -
    OFFSET_MS;
  if (now < anchor) anchor -= DAY_MS; // we're before today's 03:00 → previous cycle
  return anchor;
}

/**
 * Epoch ms of HH:MM within the CURRENT game day (03:00 WIB reset). A timing
 * before 03:00 (e.g. 01:00) resolves to the early morning at the END of the
 * current game day, so it's still "today's boss".
 */
export function spawnEpochForCycle(hh: number, mm: number, now: number): number {
  const anchor = cycleAnchor(now);
  const anchorWib = new Date(anchor + OFFSET_MS);
  let spawn =
    Date.UTC(anchorWib.getUTCFullYear(), anchorWib.getUTCMonth(), anchorWib.getUTCDate(), hh, mm) -
    OFFSET_MS;
  if (hh < CYCLE_RESET_HOUR) spawn += DAY_MS; // 00:00–02:59 belongs to next morning
  return spawn;
}

/** Key identifying the current game day (date of its 03:00 anchor), e.g. "2026-07-16". */
export function cycleKey(now: number): string {
  const wib = new Date(cycleAnchor(now) + OFFSET_MS);
  return `${wib.getUTCFullYear()}-${pad2(wib.getUTCMonth() + 1)}-${pad2(wib.getUTCDate())}`;
}
