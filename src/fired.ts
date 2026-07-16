// "Fired today" log for reminders.
//
// The schedule is a RECURRING daily template: each timing fires a reminder every
// day. To avoid firing the same timing twice in a day (the scheduler ticks every
// 30s), we record a key per (WIB day + timing) once fired, and only keep today's
// keys. Persisted so a restart doesn't re-fire an already-sent reminder.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { FIRED_PATH } from "./config.js";

interface FiredFile {
  day: string; // WIB day key these entries belong to
  keys: string[]; // fired timing ids for that day
}

function load(): FiredFile {
  try {
    const parsed = JSON.parse(readFileSync(FIRED_PATH, "utf8")) as FiredFile;
    if (typeof parsed.day === "string" && Array.isArray(parsed.keys)) return parsed;
  } catch {
    /* fall through */
  }
  return { day: "", keys: [] };
}

function save(data: FiredFile): void {
  mkdirSync(path.dirname(FIRED_PATH), { recursive: true });
  writeFileSync(FIRED_PATH, JSON.stringify(data), "utf8");
}

/** Has this timing already fired on the given WIB day? */
export function hasFired(day: string, timingId: string): boolean {
  const data = load();
  if (data.day !== day) return false; // a new day resets everything
  return data.keys.includes(timingId);
}

/** Mark a timing as fired for the given WIB day (resetting on a new day). */
export function markFired(day: string, timingId: string): void {
  const data = load();
  if (data.day !== day) {
    save({ day, keys: [timingId] });
    return;
  }
  if (!data.keys.includes(timingId)) {
    data.keys.push(timingId);
    save(data);
  }
}
