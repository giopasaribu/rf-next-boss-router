// "Already fired" log for reminders.
//
// Timings are one-off (each has an absolute date+time and is removed once it
// passes). Between fireAt and the spawn time the scheduler ticks several times,
// so we record which timing ids have already fired to avoid re-sending. Once a
// timing is removed from the schedule, its id is pruned from here too.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { FIRED_PATH } from "./config.js";

function load(): string[] {
  try {
    const parsed = JSON.parse(readFileSync(FIRED_PATH, "utf8"));
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function save(ids: string[]): void {
  mkdirSync(path.dirname(FIRED_PATH), { recursive: true });
  writeFileSync(FIRED_PATH, JSON.stringify(ids), "utf8");
}

/** Has this timing's reminder already been sent? */
export function hasFired(timingId: string): boolean {
  return load().includes(timingId);
}

/** Record that a timing's reminder was sent. */
export function markFired(timingId: string): void {
  const ids = load();
  if (!ids.includes(timingId)) {
    ids.push(timingId);
    save(ids);
  }
}

/** Drop fired entries for timings that no longer exist (housekeeping). */
export function retainFired(existingIds: string[]): void {
  const ids = load();
  const kept = ids.filter((id) => existingIds.includes(id));
  if (kept.length !== ids.length) save(kept);
}
