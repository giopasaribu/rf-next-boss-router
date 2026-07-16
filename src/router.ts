// Router / fan-out.
//
// Two responsibilities:
//   1. Turn a validated announcement into a concrete DELIVERY PLAN — which
//      Discord channels each target posts to, the exact message text, and which
//      targets are diverted to #needs-review instead of a live channel.
//   2. Execute that plan (fan out to Discord webhooks + a Telegram copy) and
//      report per-destination delivery status.
//
// The plan is built the same way for both /preview (describe it to the
// operator) and /confirm (execute it), so what the operator sees is exactly
// what gets sent. Planning is pure/deterministic; only fanOut() does I/O.

import {
  ROUTES,
  KNOWN_GUILDS,
  WEBHOOK_NEEDS_REVIEW,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
} from "./config.js";
import type { Announcement, ValidationResult } from "./types.js";

// --- Delivery plan types ---------------------------------------------------

/** A single Discord webhook post we intend to make. */
export interface PlannedDiscordPost {
  // Human-friendly label for the preview, e.g. "RISEvGGI" or "#needs-review".
  label: string;
  // The webhook URL to POST to. Kept out of the operator-facing preview.
  url: string;
  // The exact message content that will be posted.
  message: string;
  // True when this post is a diverted / review post rather than a live channel.
  isNeedsReview: boolean;
}

/** The full plan: Discord posts + an optional Telegram copy. */
export interface DeliveryPlan {
  discord: PlannedDiscordPost[];
  telegram?: { message: string };
  // Notes that aren't validation warnings but affect delivery, e.g. a guild
  // that is configured with no webhook for the chosen type.
  planNotes: string[];
}

// --- Message formatting ----------------------------------------------------

/** One boss line for a specific guild: which group it's in, its time, content. */
interface GuildEntry {
  header: string;
  time: string;
  content: string;
}

/**
 * Collect everything a single guild should be told, across ALL groups in the
 * announcement. Only known-guild, non-empty-content lines are included (invalid
 * ones are handled by the needs-review path).
 */
function entriesForGuild(announcement: Announcement, guild: string): GuildEntry[] {
  const entries: GuildEntry[] = [];
  for (const group of announcement.groups) {
    for (const target of group.targets) {
      if (target.guild === guild && target.content.trim() !== "") {
        entries.push({ header: group.header, time: group.time, content: target.content });
      }
    }
  }
  return entries;
}

/** Build the "mention + rolePing" prefix line, or "" if neither is present. */
function prefixLine(mention: string, rolePing: string | undefined): string {
  return [mention, rolePing].filter((s) => s && s.trim() !== "").join(" ");
}

/**
 * Format one guild's Discord message. It carries the global mention (e.g. @here)
 * and title once at the top, then a block per boss group relevant to that guild:
 *
 *   {mention} {rolePing}
 *   **{title}**
 *
 *   **{group header}**
 *   Time = {time}         (omitted when time is "")
 *   Target: {content}
 *
 *   **{next group header}**
 *   ...
 */
export function formatGuildMessage(
  announcement: Announcement,
  rolePing: string | undefined,
  entries: GuildEntry[],
): string {
  const topLines: string[] = [];
  const prefix = prefixLine(announcement.mention, rolePing);
  if (prefix !== "") topLines.push(prefix);
  if (announcement.title !== "") topLines.push(`**${announcement.title}**`);

  const blocks = entries.map(function block(entry) {
    const b: string[] = [];
    if (entry.header !== "") b.push(`**${entry.header}**`);
    if (entry.time !== "") b.push(`Time = ${entry.time}`);
    b.push(`Target: ${entry.content}`);
    return b.join("\n");
  });

  // Top block (mention/title) and each group block separated by a blank line.
  const sections: string[] = [];
  if (topLines.length > 0) sections.push(topLines.join("\n"));
  sections.push(...blocks);
  return sections.join("\n\n");
}

/**
 * Format the combined diagnostic message that goes to #needs-review. It carries
 * the whole announcement plus the validation warnings so a human has full
 * context to fix and re-post.
 */
export function formatNeedsReviewMessage(result: ValidationResult): string {
  const { announcement, warnings } = result;
  const lines: string[] = [];

  lines.push("⚠️ **Announcement needs review** ⚠️");
  lines.push(`Type: ${announcement.type}`);
  if (announcement.title !== "") lines.push(`Title: ${announcement.title}`);
  if (announcement.mention !== "") lines.push(`Mention: ${announcement.mention}`);

  for (const group of announcement.groups) {
    const timeSuffix = group.time !== "" ? ` (Time = ${group.time})` : "";
    lines.push(`▸ ${group.header || "(no header)"}${timeSuffix}`);
    for (const t of group.targets) {
      lines.push(`    • ${t.guild || "(no guild)"} = ${t.content || "(empty)"}`);
    }
  }

  if (warnings.length > 0) {
    lines.push("Warnings:");
    for (const w of warnings) {
      lines.push(`  • [${w.level}] ${w.message}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format the developer's personal Telegram copy: the full announcement
 * (mention + title + every group + every target) in one message.
 */
export function formatTelegramMessage(announcement: Announcement): string {
  const lines: string[] = [];

  if (announcement.mention !== "") lines.push(announcement.mention);
  if (announcement.title !== "") lines.push(announcement.title);

  for (const group of announcement.groups) {
    lines.push(""); // blank separator before each group
    const timeSuffix = group.time !== "" ? ` — ${group.time}` : "";
    lines.push(`${group.header}${timeSuffix}`.trim());
    for (const t of group.targets) {
      lines.push(`${t.guild}: ${t.content}`);
    }
  }

  // Fallback so we never send an empty Telegram message.
  const text = lines.join("\n").trim();
  return text === "" ? "(empty announcement)" : text;
}

// --- Planning --------------------------------------------------------------

/**
 * Build the full delivery plan from a validated result. Pure and deterministic:
 * called by /preview to describe, and by /confirm to execute.
 *
 * One message is built PER GUILD, gathering that guild's boss lines from every
 * group in the announcement. Invalid content (unknown guild, empty content, a
 * non-boss type) is not sent live — it's captured by the single #needs-review
 * post so nothing is silently dropped.
 */
export function planDeliveries(result: ValidationResult): DeliveryPlan {
  const { announcement } = result;
  const discord: PlannedDiscordPost[] = [];
  const planNotes: string[] = [];

  // needsReview from validation already covers unknown guild / empty content /
  // type "other"; we may add to it if a known guild has no webhook configured.
  let needsReview = result.needsReview;

  // Only route live if this is actually a boss announcement.
  if (announcement.type !== "other") {
    for (const guild of KNOWN_GUILDS) {
      const entries = entriesForGuild(announcement, guild);
      if (entries.length === 0) continue; // nothing for this guild today

      const route = ROUTES[guild]!; // known guild -> route exists
      const urls = route.webhooks;
      if (urls.length === 0) {
        // Known guild but no webhook configured: don't drop it, divert to review.
        needsReview = true;
        planNotes.push(
          `${guild} has no webhook configured; diverting to needs-review.`,
        );
        continue;
      }

      const message = formatGuildMessage(announcement, route.rolePing, entries);
      for (const url of urls) {
        discord.push({ label: guild, url, message, isNeedsReview: false });
      }
    }
  }

  // Single combined needs-review post when anything was flagged/diverted.
  if (needsReview) {
    if (WEBHOOK_NEEDS_REVIEW) {
      discord.push({
        label: "#needs-review",
        url: WEBHOOK_NEEDS_REVIEW,
        message: formatNeedsReviewMessage(result),
        isNeedsReview: true,
      });
    } else {
      planNotes.push(
        "Some content needs review but WEBHOOK_NEEDS_REVIEW is not configured — it will not be posted anywhere.",
      );
    }
  }

  // Telegram: the developer always wants the full copy, if configured.
  const plan: DeliveryPlan = { discord, planNotes };
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    plan.telegram = { message: formatTelegramMessage(announcement) };
  }

  return plan;
}

// --- Execution -------------------------------------------------------------

/** Per-destination result of a fan-out attempt. */
export interface DeliveryStatus {
  destination: string; // the label
  ok: boolean;
  detail: string; // "posted" or an error description
}

/** Result of executing the whole plan. */
export interface FanOutResult {
  statuses: DeliveryStatus[];
  allOk: boolean;
}

const HTTP_TIMEOUT_MS = 15_000;

/** POST JSON with a timeout; returns the Response or throws a clear error. */
async function postJson(url: string, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`request timed out after ${HTTP_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/** Post one Discord webhook message. */
async function sendDiscord(post: PlannedDiscordPost): Promise<DeliveryStatus> {
  try {
    const res = await postJson(post.url, { content: post.message });
    // Discord webhooks return 204 No Content on success.
    if (res.ok || res.status === 204) {
      return { destination: post.label, ok: true, detail: "posted" };
    }
    const body = await res.text().catch(() => "");
    return {
      destination: post.label,
      ok: false,
      detail: `HTTP ${res.status}: ${body.slice(0, 200)}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { destination: post.label, ok: false, detail: msg };
  }
}

/** Send the Telegram copy via the Bot API sendMessage. */
async function sendTelegram(message: string): Promise<DeliveryStatus> {
  const label = "Telegram (personal copy)";
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await postJson(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
    });
    if (res.ok) {
      return { destination: label, ok: true, detail: "posted" };
    }
    const body = await res.text().catch(() => "");
    return { destination: label, ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { destination: label, ok: false, detail: msg };
  }
}

/**
 * Execute a delivery plan. All destinations are attempted (in parallel);
 * a failure at one does not stop the others. Returns per-destination status.
 */
export async function fanOut(plan: DeliveryPlan): Promise<FanOutResult> {
  const jobs: Array<Promise<DeliveryStatus>> = [];

  for (const post of plan.discord) {
    jobs.push(sendDiscord(post));
  }
  if (plan.telegram) {
    jobs.push(sendTelegram(plan.telegram.message));
  }

  const statuses = await Promise.all(jobs);
  const allOk = statuses.every((s) => s.ok);
  return { statuses, allOk };
}
