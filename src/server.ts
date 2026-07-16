// Fastify application entry point.
//
// Wires together: the static form (GET /), the two API endpoints (/preview,
// /confirm), the shared-secret gate (applied per-route in the route modules),
// and light rate-limiting scoped to /preview only.
//
// Startup will THROW if APP_SHARED_SECRET is missing (see config.ts) — we
// refuse to run an unprotected fan-out service.

import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";

import { PORT, HOST, PUBLIC_DIR } from "./config.js";
import indexRoute from "./routes/index.js";
import previewRoute from "./routes/preview.js";
import confirmRoute from "./routes/confirm.js";

async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
    // Announcements are small; cap body size to keep the endpoint cheap to abuse.
    bodyLimit: 64 * 1024,
  });

  // Rate limiting registered with global:false so it applies ONLY where a route
  // opts in via config.rateLimit (currently just /preview, which calls the LLM).
  await fastify.register(rateLimit, { global: false });

  // Static file serving for any future assets under public/. The form itself is
  // returned explicitly by indexRoute, but this makes e.g. /favicon.ico work.
  await fastify.register(fastifyStatic, {
    root: PUBLIC_DIR,
    prefix: "/static/",
  });

  // A tiny health check for the VPS / systemd / uptime monitors. Unprotected on
  // purpose — it reveals nothing sensitive.
  fastify.get("/healthz", async function health() {
    return { ok: true };
  });

  // Routes.
  await fastify.register(indexRoute);
  await fastify.register(previewRoute);
  await fastify.register(confirmRoute);

  return fastify;
}

async function main() {
  const fastify = await buildServer();
  try {
    // Host is configurable (default 0.0.0.0). Put a reverse proxy / firewall in
    // front per the README, or bind 127.0.0.1 for a private first test.
    await fastify.listen({ port: PORT, host: HOST });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
