// App-state persistence — one JSON document.
//
// Single-process, single-user, low write volume, so plain synchronous
// read/write is safe and simple (no DB, no native deps). The file lives on a
// persistent disk (DB_PATH) and holds secrets (webhook URLs, Telegram tokens),
// so it must stay on a private server and out of git (see .gitignore: data/).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DB_PATH } from "./config.js";
import type { DB, Settings } from "./types.js";

const DEFAULT_SETTINGS: Settings = {
  reminderLeadMinutes: 10,
  sendMode: "per_guild",
  scheduleTitle: "",
};

function emptyDb(): DB {
  return {
    guilds: [],
    bosses: [],
    schedule: [],
    watchlist: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

/**
 * Defensively fill in any missing top-level fields so older / partial files (or
 * a hand-edited one) never crash the app.
 */
function normalize(input: unknown): DB {
  const base = emptyDb();
  if (typeof input !== "object" || input === null) return base;
  const obj = input as Partial<DB>;
  return {
    guilds: Array.isArray(obj.guilds) ? obj.guilds : base.guilds,
    bosses: Array.isArray(obj.bosses) ? obj.bosses : base.bosses,
    schedule: Array.isArray(obj.schedule) ? obj.schedule : base.schedule,
    watchlist: Array.isArray(obj.watchlist) ? obj.watchlist : base.watchlist,
    settings: { ...DEFAULT_SETTINGS, ...(obj.settings ?? {}) },
  };
}

export function loadDb(): DB {
  try {
    return normalize(JSON.parse(readFileSync(DB_PATH, "utf8")));
  } catch {
    return emptyDb();
  }
}

export function saveDb(db: DB): void {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  writeFileSync(DB_PATH, JSON.stringify(normalize(db), null, 2), "utf8");
}
