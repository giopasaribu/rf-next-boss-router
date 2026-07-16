// Data model.
//
// The whole app state is one JSON document (see db.ts). The operator edits it
// through the UI. Everything time-related is UTC+7 (WIB).

/** A Discord webhook belonging to a guild. */
export interface Webhook {
  id: string;
  label: string; // e.g. "#boss-alerts"
  url: string;
}

/** A guild with one or more webhooks. */
export interface Guild {
  id: string;
  name: string; // e.g. "RISEvGGI"
  webhooks: Webhook[];
}

/** A reusable boss definition (catalog). Level is a default; a spawn may override it. */
export interface Boss {
  id: string;
  name: string; // e.g. "Mech Warbeast"
  level: string; // e.g. "61" (string so "?"/ranges are allowed)
}

/** One boss spawning within a timing, assigned to one or more guilds. */
export interface Spawn {
  id: string;
  bossName: string; // denormalized from the catalog (editable per spawn)
  level: string;
  guildIds: string[]; // guilds this boss is announced to (can be many)
}

/** A timing = a boss group: everything spawning at one time. */
export interface Timing {
  id: string;
  time: string; // "HH:MM" (WIB)
  spawns: Spawn[];
}

/** How a watchlist target is reached. */
export type WatchKind = "discord" | "telegram";

/**
 * An extra destination that mirrors activity regardless of guild routing —
 * e.g. your personal Telegram, or a monitoring channel. It receives every
 * timing's group reminder (and optionally the initial announcement).
 */
export interface WatchTarget {
  id: string;
  label: string;
  kind: WatchKind;
  url: string; // Discord webhook URL (kind === "discord")
  botToken: string; // Telegram bot token (kind === "telegram")
  chatId: string; // Telegram chat id (kind === "telegram")
  receiveAnnouncement: boolean;
  receiveReminders: boolean;
}

/** How the manual announcement is laid out. */
export type SendMode = "per_guild" | "concatenated";

export interface Settings {
  reminderLeadMinutes: number; // fire this many minutes before each spawn
  sendMode: SendMode; // default layout for the Announce action
  scheduleTitle: string; // optional header line, e.g. "SCHEDULE FIELD BOSS TODAY"
}

/** The entire persisted app state. */
export interface DB {
  guilds: Guild[];
  bosses: Boss[];
  schedule: Timing[];
  watchlist: WatchTarget[];
  settings: Settings;
}
