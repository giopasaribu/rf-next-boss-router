// POST /confirm
//
// Body: { pendingId }
//
// Looks up the validated result stored by /preview and fans it out. It does NOT
// re-run the LLM — it posts exactly what was previewed. The pendingId is a
// one-shot capability token: taking it from the store removes it, so a
// double-click can't double-post.

import type { FastifyPluginAsync } from "fastify";
import { requireSecret } from "../auth.js";
import { takePending } from "../pending.js";
import { planDeliveries, fanOut } from "../router.js";

const confirmBodySchema = {
  type: "object",
  required: ["pendingId"],
  additionalProperties: false,
  properties: {
    pendingId: { type: "string", minLength: 1, maxLength: 100 },
  },
} as const;

interface ConfirmBody {
  pendingId: string;
}

const confirmRoute: FastifyPluginAsync = async function confirmRoute(fastify) {
  fastify.post<{ Body: ConfirmBody }>(
    "/confirm",
    {
      preHandler: requireSecret,
      schema: { body: confirmBodySchema },
    },
    async function handleConfirm(request, reply) {
      const { pendingId } = request.body;

      // One-shot lookup: removes the entry so it can only be confirmed once.
      const result = takePending(pendingId);
      if (result === undefined) {
        return reply.code(410).send({
          error: "This preview expired or was already sent. Please paste again.",
        });
      }

      // Rebuild the plan deterministically from the stored, validated result
      // (same inputs -> same plan the operator saw) and execute it.
      const plan = planDeliveries(result);
      const fanResult = await fanOut(plan);

      return reply.send({
        allOk: fanResult.allOk,
        statuses: fanResult.statuses,
      });
    },
  );
};

export default confirmRoute;
