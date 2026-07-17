// Configuration.
//
// This app is a single-maintainer, PRIVATE tool: no auth, run it on a private /
// non-internet-exposed server. Almost all real config (guilds, webhooks,
// bosses, schedule, watchlist, settings) lives in the JSON data store and is
// edited through the UI — env is only for process-level wiring.

import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Read an env var, treating an EMPTY/blank value as unset. Critical: `.env`
 * often has lines like `DB_PATH=` (blank). `process.env.DB_PATH ?? default`
 * would keep the empty string (only null/undefined trigger `??`), and the app
 * would try to open "" -> ENOENT. This helper falls back on blanks too.
 */
function envOr(name: string, fallback: string): string {
  const v = process.env[name];
  return v !== undefined && v.trim() !== "" ? v : fallback;
}

export const PORT: number = Number(envOr("PORT", "3000"));
export const HOST: string = envOr("HOST", "0.0.0.0");

// Resolve paths relative to the CODE location (project root), not the current
// working directory — so writes work regardless of how the process is launched
// (e.g. a systemd unit with a different/blank WorkingDirectory). moduleDir is
// <root>/dist (prod) or <root>/src (dev); its parent is the project root.
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(moduleDir);
const defaultDataDir = path.join(projectRoot, "data");

// Where the app state and the reminder "fired" log are persisted. These MUST
// live on a persistent disk so the schedule + reminders survive a restart.
export const DB_PATH: string = envOr("DB_PATH", path.join(defaultDataDir, "db.json"));
export const FIRED_PATH: string = envOr(
  "FIRED_PATH",
  path.join(defaultDataDir, "reminders-fired.json"),
);

// Fixed timezone for ALL times in this app: UTC+7 (WIB, Indonesia). No DST.
// Timings are absolute date+times (WIB); there is no reset-cycle logic.
export const WIB_OFFSET_MINUTES = 7 * 60;
export const WIB_LABEL = "UTC+7 (WIB, Indonesia)";

// Reminder lead options offered in the UI dropdown (minutes before spawn).
export const REMINDER_LEAD_OPTIONS = [5, 10, 15, 30, 60];

export const PUBLIC_DIR: string = path.join(moduleDir, "public");
