// POST /preview
//
// Body: { raw: "<pasted text>" }
//
// Steps:
//   1. Send raw text to the LLM (Groq) -> parsed Announcement (llm.ts).
//   2. Run the validation gate (validate.ts).
//   3. Build the delivery plan (router.ts) so we can show the operator exactly
//      what will post where.
//   4. Store the validated result under a random pendingId with a short TTL.
//   5. Return an operator-facing preview (NO webhook URLs) + the pendingId.

import type { FastifyPluginAsync } from "fastify";
import { requireSecret } from "../auth.js";
import { parseAnnouncement } from "../llm.js";
import { validateAnnouncement } from "../validate.js";
import { planDeliveries } from "../router.js";
import { putPending } from "../pending.js";

// JSON schema for the request body. Fastify validates this before our handler
// runs, so we can trust `raw` is a non-empty string of reasonable length.
const previewBodySchema = {
  type: "object",
  required: ["raw"],
  additionalProperties: false,
  properties: {
    raw: { type: "string", minLength: 1, maxLength: 5000 },
  },
} as const;

interface PreviewBody {
  raw: string;
}

const previewRoute: FastifyPluginAsync = async function previewRoute(fastify) {
  fastify.post<{ Body: PreviewBody }>(
    "/preview",
    {
      preHandler: requireSecret,
      schema: { body: previewBodySchema },
      // Rate-limit ONLY this endpoint (it calls the LLM). See server.ts where
      // rate-limit is registered with global:false.
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
    },
    async function handlePreview(request, reply) {
      const { raw } = request.body;

      // 1. LLM parse. If the API is unreachable or returns garbage, surface 502.
      let announcement;
      try {
        announcement = await parseAnnouncement(raw);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        request.log.error({ err }, "LLM parse failed");
        return reply.code(502).send({
          error: "Failed to parse the announcement with the LLM.",
          detail: msg,
        });
      }

      // 2. Validate.
      const result = validateAnnouncement(announcement);

      // 3. Plan deliveries (used to describe the preview).
      const plan = planDeliveries(result);

      // 4. Store for /confirm.
      const pendingId = putPending(result);

      // 5. Build the operator-facing preview. Strip webhook URLs — the browser
      //    never needs them and they shouldn't leave the server.
      const deliveries = plan.discord.map(function sanitize(post) {
        return {
          label: post.label,
          message: post.message,
          isNeedsReview: post.isNeedsReview,
        };
      });

      return reply.send({
        pendingId,
        announcement: result.announcement,
        warnings: result.warnings,
        needsReview: result.needsReview,
        deliveries,
        telegram: plan.telegram ? { message: plan.telegram.message } : null,
        planNotes: plan.planNotes,
      });
    },
  );
};

export default previewRoute;
