// Message building + delivery planning.
//
// Pure/deterministic: given the DB state it produces the exact text and the list
// of destinations for an announcement or a timing's reminder. No I/O here
// (sender.ts does the posting).
//
// Reminder granularity: ONE reminder per timing (boss group) per destination —
// never one per boss. A guild that has several bosses in a 12:00 group gets a
// single 12:00 reminder listing all of them.

import { WIB_LABEL } from "./config.js";
import { parseHhmm } from "./wib.js";
import type { DB, Guild, Spawn, Timing, WatchTarget } from "./types.js";

// Short inline tag + a one-line footer with the full timezone description, so we
// don't repeat the long label on every timing line.
const TIME_NOTE = `🌏 Times are ${WIB_LABEL}`;

// A concrete place to send a message to.
export type Destination =
  | { kind: "discord"; label: string; url: string }
  | { kind: "telegram"; label: string; botToken: string; chatId: string };

/** One planned delivery: a destination + the exact message for it. */
export interface PlanItem {
  label: string; // human-friendly, shown in the preview (no secrets)
  message: string;
  destination: Destination;
}

// --- small helpers ---------------------------------------------------------

function guildById(db: DB, id: string): Guild | undefined {
  return db.guilds.find((g) => g.id === id);
}

function guildNames(db: DB, spawn: Spawn): string {
  const names = spawn.guildIds
    .map((id) => guildById(db, id)?.name)
    .filter((n): n is string => Boolean(n));
  return names.join(", ");
}

/** "Mech Warbeast Lv 61" (level omitted if blank). */
function bossLabel(spawn: Spawn): string {
  const lvl = spawn.level.trim();
  return lvl === "" ? spawn.bossName : `${spawn.bossName} Lv ${lvl}`;
}

/** Timings sorted by WIB time; invalid times sink to the end. */
export function sortedSchedule(db: DB): Timing[] {
  return [...db.schedule].sort((a, b) => {
    const pa = parseHhmm(a.time);
    const pb = parseHhmm(b.time);
    const va = pa ? pa.hh * 60 + pa.mm : 9999;
    const vb = pb ? pb.hh * 60 + pb.mm : 9999;
    return va - vb;
  });
}

function guildDestinations(guild: Guild): Destination[] {
  const live = guild.webhooks.filter((w) => w.url.trim() !== "");
  // Label by guild name; disambiguate with an index only when there are several.
  return live.map((w, i) => ({
    kind: "discord" as const,
    label: live.length > 1 ? `${guild.name} (${i + 1})` : guild.name,
    url: w.url,
  }));
}

function watchDestination(w: WatchTarget): Destination | null {
  if (w.kind === "discord") {
    if (w.url.trim() === "") return null;
    return { kind: "discord", label: `watch: ${w.label}`, url: w.url };
  }
  if (w.botToken.trim() === "" || w.chatId.trim() === "") return null;
  return { kind: "telegram", label: `watch: ${w.label}`, botToken: w.botToken, chatId: w.chatId };
}

// --- text builders ---------------------------------------------------------

/** Per-guild announcement: only this guild's bosses, across all its timings. */
export function buildGuildAnnouncement(db: DB, guild: Guild): string {
  const lines: string[] = [];
  if (db.settings.scheduleTitle.trim() !== "") lines.push(db.settings.scheduleTitle.trim());

  let any = false;
  for (const timing of sortedSchedule(db)) {
    const mine = timing.spawns.filter((s) => s.guildIds.includes(guild.id));
    if (mine.length === 0) continue;
    any = true;
    lines.push(`🕛 ${timing.time} WIB`);
    for (const s of mine) lines.push(`• ${bossLabel(s)}`);
  }
  if (!any) return "(no bosses assigned)";
  lines.push("", TIME_NOTE);

  return lines.join("\n").trim();
}

/** Concatenated announcement: the whole schedule, each boss tagged with its guilds. */
export function buildFullAnnouncement(db: DB): string {
  const lines: string[] = [];
  if (db.settings.scheduleTitle.trim() !== "") lines.push(db.settings.scheduleTitle.trim());

  let any = false;
  for (const timing of sortedSchedule(db)) {
    if (timing.spawns.length === 0) continue;
    any = true;
    lines.push(`🕛 ${timing.time} WIB`);
    for (const s of timing.spawns) {
      const g = guildNames(db, s);
      lines.push(`• ${bossLabel(s)}${g ? ` — ${g}` : ""}`);
    }
  }
  if (!any) return "(empty schedule)";
  lines.push("", TIME_NOTE);

  return lines.join("\n").trim();
}

/** Reminder for a timing, limited to one guild's bosses. */
export function buildGuildReminder(db: DB, timing: Timing, guild: Guild, leadMin: number): string {
  const mine = timing.spawns.filter((s) => s.guildIds.includes(guild.id));
  const lines = [`⏰ Reminder — boss group spawns at ${timing.time} WIB (in ~${leadMin} min)`];
  for (const s of mine) lines.push(`• ${bossLabel(s)}`);
  return lines.join("\n");
}

/** Reminder for a timing showing the full group (used for watchlist). */
export function buildGroupReminder(db: DB, timing: Timing, leadMin: number): string {
  const lines = [`⏰ Reminder — boss group spawns at ${timing.time} WIB (in ~${leadMin} min)`];
  for (const s of timing.spawns) {
    const g = guildNames(db, s);
    lines.push(`• ${bossLabel(s)}${g ? ` — ${g}` : ""}`);
  }
  return lines.join("\n");
}

// --- planners --------------------------------------------------------------

/**
 * When an announcement plan comes out empty, work out the most useful reason so
 * the UI can tell the operator exactly what to fix (rather than a vague error).
 */
export function diagnoseEmptyAnnouncement(
  db: DB,
  mode: DB["settings"]["sendMode"],
  targetGuildIds?: string[],
): string {
  if (db.guilds.length === 0) {
    return "No guilds yet — add a guild and paste its Discord webhook URL.";
  }
  const guildsWithWebhook = db.guilds.filter((g) => g.webhooks.some((w) => w.url.trim() !== ""));
  if (guildsWithWebhook.length === 0) {
    return "No guild has a webhook URL — add a Discord webhook URL under a guild.";
  }
  const totalSpawns = db.schedule.reduce((n, t) => n + t.spawns.length, 0);
  if (totalSpawns === 0) {
    return "The schedule has no bosses — add a timing and at least one boss.";
  }
  const anyAssigned = db.schedule.some((t) => t.spawns.some((s) => s.guildIds.length > 0));
  if (!anyAssigned) {
    return "No boss is assigned to a guild — tick the guild checkbox(es) on your bosses.";
  }

  if (mode === "per_guild") {
    const ok = db.guilds.some(
      (g) =>
        g.webhooks.some((w) => w.url.trim() !== "") &&
        db.schedule.some((t) => t.spawns.some((s) => s.guildIds.includes(g.id))),
    );
    if (!ok) {
      return "The guild(s) your bosses are assigned to have no webhook URL — the guild with a webhook and the guild with bosses must be the same one.";
    }
  } else {
    const targets =
      targetGuildIds && targetGuildIds.length > 0
        ? db.guilds.filter((g) => targetGuildIds.includes(g.id))
        : db.guilds;
    if (targets.length === 0) return "No target channels selected for the concatenated announcement.";
    if (!targets.some((g) => g.webhooks.some((w) => w.url.trim() !== ""))) {
      return "The selected target guild(s) have no webhook URL.";
    }
  }

  return "Nothing matched — double-check webhook URLs and guild assignments.";
}

/**
 * Plan the manual announcement. `mode` overrides settings.sendMode; for
 * concatenated mode, `targetGuildIds` limits which guild channels receive the
 * full schedule (default: all guilds).
 */
export function planAnnouncement(
  db: DB,
  mode: DB["settings"]["sendMode"],
  targetGuildIds?: string[],
): PlanItem[] {
  const items: PlanItem[] = [];

  if (mode === "per_guild") {
    for (const guild of db.guilds) {
      const hasSpawns = db.schedule.some((t) => t.spawns.some((s) => s.guildIds.includes(guild.id)));
      if (!hasSpawns) continue;
      const message = buildGuildAnnouncement(db, guild);
      for (const dest of guildDestinations(guild)) items.push({ label: dest.label, message, destination: dest });
    }
  } else {
    const message = buildFullAnnouncement(db);
    const targets = targetGuildIds && targetGuildIds.length > 0
      ? db.guilds.filter((g) => targetGuildIds.includes(g.id))
      : db.guilds;
    for (const guild of targets) {
      for (const dest of guildDestinations(guild)) items.push({ label: dest.label, message, destination: dest });
    }
  }

  // Watchlist: full announcement to anyone opted in.
  const full = buildFullAnnouncement(db);
  for (const w of db.watchlist) {
    if (!w.receiveAnnouncement) continue;
    const dest = watchDestination(w);
    if (dest) items.push({ label: dest.label, message: full, destination: dest });
  }

  return items;
}

/**
 * Plan the reminder for a single timing: one message per guild that has bosses
 * in it (to that guild's webhooks), plus the full-group message to each opted-in
 * watchlist target. One reminder per destination.
 */
export function planReminder(db: DB, timing: Timing, leadMin: number): PlanItem[] {
  const items: PlanItem[] = [];

  for (const guild of db.guilds) {
    const has = timing.spawns.some((s) => s.guildIds.includes(guild.id));
    if (!has) continue;
    const message = buildGuildReminder(db, timing, guild, leadMin);
    for (const dest of guildDestinations(guild)) items.push({ label: dest.label, message, destination: dest });
  }

  const groupMsg = buildGroupReminder(db, timing, leadMin);
  for (const w of db.watchlist) {
    if (!w.receiveReminders) continue;
    const dest = watchDestination(w);
    if (dest) items.push({ label: dest.label, message: groupMsg, destination: dest });
  }

  return items;
}
