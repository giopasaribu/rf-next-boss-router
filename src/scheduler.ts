// Reminder scheduler + schedule cleanup.
//
// Every ~30s it:
//   1. removes timings whose spawn time has PASSED (and their reminder), so the
//      schedule always shows only upcoming bosses — the reset time is irrelevant;
//   2. for each upcoming timing whose reminder is due (fireAt ≤ now < spawn) and
//      not yet fired, sends ONE reminder per destination and records it.
//
// Runs once on boot so anything due while the process was down is handled.

import type { FastifyBaseLogger } from "fastify";
import { loadDb, saveDb } from "./db.js";
import { planReminder } from "./messages.js";
import { deliver } from "./sender.js";
import { hasFired, markFired, retainFired } from "./fired.js";
import { wibToEpoch } from "./wib.js";

const TICK_MS = 30_000;

async function tick(log: FastifyBaseLogger): Promise<void> {
  const now = Date.now();
  const db = loadDb();
  const leadMs = db.settings.reminderLeadMinutes * 60 * 1000;

  const kept: typeof db.schedule = [];
  let removed = 0;

  for (const timing of db.schedule) {
    const spawnAt = wibToEpoch(timing.when);

    // Invalid datetime — keep it so the operator can fix it in the UI.
    if (spawnAt === null) {
      kept.push(timing);
      continue;
    }

    // Passed — drop the timing (and, implicitly, its reminder).
    if (now >= spawnAt) {
      removed++;
      continue;
    }

    kept.push(timing);

    // Fire the reminder if it's due and hasn't fired yet.
    if (timing.spawns.length === 0) continue;
    const fireAt = spawnAt - leadMs;
    if (now < fireAt) continue;
    if (hasFired(timing.id)) continue;

    const plan = planReminder(db, timing);
    markFired(timing.id); // one reminder per timing, no retry (avoids double-post)
    if (plan.length === 0) continue;

    try {
      const result = await deliver(plan);
      if (result.allOk) log.info({ when: timing.when, count: plan.length }, "reminder sent");
      else {
        const failed = result.statuses.filter((s) => !s.ok).map((s) => s.destination);
        log.warn({ when: timing.when, failed }, "reminder partially delivered");
      }
    } catch (err) {
      log.error({ when: timing.when, err }, "reminder delivery failed");
    }
  }

  if (removed > 0) {
    db.schedule = kept;
    saveDb(db);
    log.info({ removed }, "removed passed timings");
  }
  retainFired(kept.map((t) => t.id));
}

export function startScheduler(log: FastifyBaseLogger): NodeJS.Timeout {
  const run = () => {
    tick(log).catch((err) => log.error({ err }, "reminder tick failed"));
  };
  run();
  return setInterval(run, TICK_MS);
}
