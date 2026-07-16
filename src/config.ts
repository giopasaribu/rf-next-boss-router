// Configuration.
//
// This app is a single-maintainer, PRIVATE tool: no auth, run it on a private /
// non-internet-exposed server. Almost all real config (guilds, webhooks,
// bosses, schedule, watchlist, settings) lives in the JSON data store and is
// edited through the UI — env is only for process-level wiring.

import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PORT: number = Number(process.env.PORT ?? 3000);
export const HOST: string = process.env.HOST ?? "0.0.0.0";

// Where the app state and the reminder "fired today" log are persisted. These
// MUST live on a persistent disk so the schedule + reminders survive a restart.
export const DB_PATH: string =
  process.env.DB_PATH ?? path.join(process.cwd(), "data", "db.json");
export const FIRED_PATH: string =
  process.env.FIRED_PATH ?? path.join(process.cwd(), "data", "reminders-fired.json");

// Fixed timezone for ALL times in this app: UTC+7 (WIB, Indonesia). No DST.
export const WIB_OFFSET_MINUTES = 7 * 60;
export const WIB_LABEL = "UTC+7 (WIB, Indonesia)";

// Reminder lead options offered in the UI dropdown (minutes before spawn).
export const REMINDER_LEAD_OPTIONS = [5, 10, 15, 30, 60];

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR: string = path.join(moduleDir, "public");
