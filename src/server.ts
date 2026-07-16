// Fastify application entry point.
//
// Serves the single-page admin UI (GET /), the state API (/api/state), the
// manual announce endpoint (/api/announce), and starts the recurring reminder
// scheduler. No auth — run on a private server only.

import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

import { PORT, HOST, PUBLIC_DIR } from "./config.js";
import indexRoute from "./routes/index.js";
import stateRoute from "./routes/state.js";
import announceRoute from "./routes/announce.js";
import { startScheduler } from "./scheduler.js";

async function buildServer() {
  const fastify = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    // The state PUT can carry the whole app config; give it room.
    bodyLimit: 2 * 1024 * 1024,
  });

  await fastify.register(fastifyStatic, { root: PUBLIC_DIR, prefix: "/static/" });

  fastify.get("/healthz", async function health() {
    return { ok: true };
  });

  await fastify.register(indexRoute);
  await fastify.register(stateRoute);
  await fastify.register(announceRoute);

  return fastify;
}

async function main() {
  const fastify = await buildServer();
  startScheduler(fastify.log);
  try {
    await fastify.listen({ port: PORT, host: HOST });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
