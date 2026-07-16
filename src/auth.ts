// Shared-secret gate.
//
// A deliberately simple protection (per CLAUDE.md this is a small internal
// tool): every protected endpoint requires the caller to send the shared secret
// in the `x-app-secret` header. The single-page form collects it from the
// operator and attaches it to its /preview and /confirm fetches.
//
// GET / (the form shell) is intentionally left open — it contains no secrets
// and no ability to post anywhere; the secret is only needed to actually drive
// the LLM and the fan-out.

import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { APP_SHARED_SECRET } from "./config.js";

/**
 * Constant-time string comparison to avoid leaking the secret via timing.
 * Returns false quickly for length mismatches (length is not itself secret).
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Fastify preHandler that rejects the request with 401 unless the correct
 * shared secret is present in the `x-app-secret` header.
 */
export async function requireSecret(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const provided = request.headers["x-app-secret"];
  const value = Array.isArray(provided) ? provided[0] : provided;

  if (typeof value !== "string" || !safeEqual(value, APP_SHARED_SECRET)) {
    await reply.code(401).send({ error: "Unauthorized. Check the shared secret." });
  }
}
