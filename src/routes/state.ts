// GET /api/state  — return the whole app state (for the UI to render)
// PUT /api/state  — replace the whole app state (the UI saves everything at once)
//
// Single-user app, so a coarse "load all / save all" API is the simplest thing
// that works. saveDb() normalizes, so a slightly-off payload won't corrupt state.

import type { FastifyPluginAsync } from "fastify";
import { loadDb, saveDb } from "../db.js";
import type { DB } from "../types.js";

const stateRoute: FastifyPluginAsync = async function stateRoute(fastify) {
  fastify.get("/api/state", async function getState() {
    return loadDb();
  });

  fastify.put<{ Body: DB }>("/api/state", async function putState(request, reply) {
    const body = request.body;
    if (typeof body !== "object" || body === null) {
      return reply.code(400).send({ error: "Body must be a state object." });
    }
    saveDb(body);
    return { ok: true };
  });
};

export default stateRoute;
