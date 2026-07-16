// POST /api/announce — manually post the current schedule to channels.
//
// Body: { mode?: "per_guild" | "concatenated", targetGuildIds?: string[], dryRun?: boolean }
//   - dryRun true  -> return the planned messages (labels + text, no webhook URLs)
//   - dryRun false -> actually send, return per-destination status
//
// Reads the saved state fresh each call, so it always posts exactly what's saved.
// Reminders are separate (automatic) — this endpoint is only the manual post.

import type { FastifyPluginAsync } from "fastify";
import { loadDb } from "../db.js";
import { planAnnouncement } from "../messages.js";
import { deliver } from "../sender.js";
import type { SendMode } from "../types.js";

interface AnnounceBody {
  mode?: SendMode;
  targetGuildIds?: string[];
  dryRun?: boolean;
}

const announceRoute: FastifyPluginAsync = async function announceRoute(fastify) {
  fastify.post<{ Body: AnnounceBody }>("/api/announce", async function announce(request, reply) {
    const db = loadDb();
    const body = request.body ?? {};
    const mode: SendMode = body.mode === "concatenated" || body.mode === "per_guild"
      ? body.mode
      : db.settings.sendMode;

    const plan = planAnnouncement(db, mode, body.targetGuildIds);

    if (body.dryRun) {
      // Never expose webhook URLs to the browser.
      return { mode, plan: plan.map((p) => ({ label: p.label, message: p.message })) };
    }

    if (plan.length === 0) {
      return reply.code(400).send({ error: "Nothing to send — no matching channels/webhooks configured." });
    }

    const result = await deliver(plan);
    return { mode, allOk: result.allOk, statuses: result.statuses };
  });
};

export default announceRoute;
