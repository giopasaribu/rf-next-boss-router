// Reminder scheduler — recurring daily.
//
// The schedule is a standing template. Every day, each timing fires ONE reminder
// (per destination) at spawn - lead. This interval ticks every 30s, reads the
// current saved state each time (so edits take effect without a restart), and
// uses the fired-today log for idempotency.

import type { FastifyBaseLogger } from "fastify";
import { loadDb } from "./db.js";
import { planReminder } from "./messages.js";
import { deliver } from "./sender.js";
import { hasFired, markFired } from "./fired.js";
import { parseHhmm, spawnEpochToday, wibDayKey } from "./wib.js";

const TICK_MS = 30_000;

async function tick(log: FastifyBaseLogger): Promise<void> {
  const now = Date.now();
  const day = wibDayKey(now);
  const db = loadDb();
  const leadMs = db.settings.reminderLeadMinutes * 60 * 1000;

  for (const timing of db.schedule) {
    if (timing.spawns.length === 0) continue;
    const parsed = parseHhmm(timing.time);
    if (!parsed) continue;

    const spawnAt = spawnEpochToday(parsed.hh, parsed.mm, now);
    const fireAt = spawnAt - leadMs;

    if (now < fireAt) continue; // not time yet
    if (now >= spawnAt) continue; // spawn already passed today — missed window
    if (hasFired(day, timing.id)) continue; // already fired today

    const plan = planReminder(db, timing, db.settings.reminderLeadMinutes);
    // Mark fired regardless of send outcome: one reminder per group, no retry
    // (retrying could double-post to destinations that already succeeded).
    markFired(day, timing.id);

    if (plan.length === 0) continue;
    try {
      const result = await deliver(plan);
      if (result.allOk) {
        log.info({ time: timing.time, count: plan.length }, "reminder sent");
      } else {
        const failed = result.statuses.filter((s) => !s.ok).map((s) => s.destination);
        log.warn({ time: timing.time, failed }, "reminder partially delivered");
      }
    } catch (err) {
      log.error({ time: timing.time, err }, "reminder delivery failed");
    }
  }
}

export function startScheduler(log: FastifyBaseLogger): NodeJS.Timeout {
  const run = () => {
    tick(log).catch((err) => log.error({ err }, "reminder tick failed"));
  };
  run();
  return setInterval(run, TICK_MS);
}
