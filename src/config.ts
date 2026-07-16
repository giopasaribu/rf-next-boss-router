// Configuration module.
//
// Responsibilities:
//   1. Load environment variables from `.env` (via dotenv).
//   2. Build the ROUTES table (guild x type -> webhook URLs) from those vars.
//   3. Expose the known-guild set used by the validation gate.
//   4. Resolve the static `public/` directory in a way that works in both dev
//      (running from src/ via tsx) and production (running from dist/).
//
// Design note: per CLAUDE.md the routing table lives in config, NOT in logic.
// Adding a guild or a channel should be an edit here + new env vars, nothing else.

import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Small helper: read an env var and throw a clear error if it is required but
 * missing. We fail loudly at startup rather than mysteriously at fan-out time.
 */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

/** Read an optional env var; returns undefined if unset/blank. */
function optional(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return undefined;
  return value;
}

// --- Server -----------------------------------------------------------------

export const PORT: number = Number(process.env.PORT ?? 3000);

// The network interface to bind. Default 0.0.0.0 (all interfaces) for a normal
// VPS deployment behind a reverse proxy/firewall. Set HOST=127.0.0.1 to make
// the server reachable ONLY from the box itself — useful for the very first
// on-server test (reach it over an SSH tunnel) before exposing it publicly.
export const HOST: string = process.env.HOST ?? "0.0.0.0";

// --- LLM (Groq cloud API) --------------------------------------------------

// We use Groq's free, OpenAI-compatible chat-completions API to parse the raw
// announcement. This keeps the server tiny (no local model / heavy RAM) while
// giving fast, high-quality JSON extraction. The API key is REQUIRED so we fail
// fast at startup rather than at the first /preview.
export const GROQ_API_KEY: string = required("GROQ_API_KEY");
export const GROQ_URL: string =
  process.env.GROQ_URL ?? "https://api.groq.com/openai/v1/chat/completions";
export const GROQ_MODEL: string = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

// The shared secret that gates every endpoint. Required — refusing to start
// without it is a feature, not a bug (an open fan-out endpoint is dangerous).
export const APP_SHARED_SECRET: string = required("APP_SHARED_SECRET");

// --- Telegram (developer's personal copy) ----------------------------------

export const TELEGRAM_BOT_TOKEN: string | undefined = optional("TELEGRAM_BOT_TOKEN");
export const TELEGRAM_CHAT_ID: string | undefined = optional("TELEGRAM_CHAT_ID");

// --- Discord: the #needs-review fallback channel ---------------------------

export const WEBHOOK_NEEDS_REVIEW: string | undefined = optional("WEBHOOK_NEEDS_REVIEW");

// --- Routing table ---------------------------------------------------------

/** One guild's routing configuration. */
export interface GuildRoute {
  webhooks: string[]; // webhook URLs this guild's announcements fan out to
  rolePing?: string; // optional, e.g. "<@&123...>", prepended to the message
}

/**
 * Build a guild's route from env vars. An undefined/blank webhook URL is dropped
 * so a half-configured guild simply routes nowhere (surfaced as a warning at
 * fan-out) rather than posting to a literal "undefined" URL. The webhook list
 * makes it trivial to fan a guild out to more than one channel later.
 */
function buildRoute(webhookVar: string, rolePingVar: string): GuildRoute {
  const webhook = optional(webhookVar);
  return {
    webhooks: webhook ? [webhook] : [],
    rolePing: optional(rolePingVar),
  };
}

/**
 * The routing table. Keyed by the canonical guild tag. To add a guild:
 *   1. add its env vars to .env(.example)
 *   2. add a line here
 *   3. (nothing in the logic changes)
 */
export const ROUTES: Record<string, GuildRoute> = {
  RISEvGGI: buildRoute("WEBHOOK_GGI", "ROLE_ID_GGI"),
  RISEvEMPEROR: buildRoute("WEBHOOK_EMP", "ROLE_ID_EMP"),
  RISEvEMPIRE: buildRoute("WEBHOOK_EMPIRE", "ROLE_ID_EMPIRE"),
};

/**
 * The canonical set of known guild tags, derived from the routing table so the
 * two can never drift apart. The validation gate uses this to decide whether a
 * guild the LLM produced is real.
 */
export const KNOWN_GUILDS: string[] = Object.keys(ROUTES);

// --- Static assets ---------------------------------------------------------

// Resolve the public directory relative to THIS module's compiled location so
// it works both in dev (src/public) and after build (dist/public, populated by
// scripts/copy-assets.mjs).
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR: string = path.join(moduleDir, "public");
