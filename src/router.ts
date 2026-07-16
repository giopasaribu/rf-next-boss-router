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
import type { Announcement, Target, ValidationResult } from "./types.js";

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

/**
 * Format the per-guild Discord message per CLAUDE.md:
 *
 *   {rolePing if present} **{header}**
 *   Time = {time}        (omitted when time is "")
 *   Target: {content}
 */
export function formatDiscordMessage(
  announcement: Announcement,
  target: Target,
  rolePing: string | undefined,
): string {
  const lines: string[] = [];

  const pingPrefix = rolePing ? `${rolePing} ` : "";
  lines.push(`${pingPrefix}**${announcement.header}**`);

  if (announcement.time !== "") {
    lines.push(`Time = ${announcement.time}`);
  }

  lines.push(`Target: ${target.content}`);

  return lines.join("\n");
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
  if (announcement.header !== "") lines.push(`Header: ${announcement.header}`);
  if (announcement.time !== "") lines.push(`Time: ${announcement.time}`);

  if (announcement.targets.length > 0) {
    lines.push("Targets:");
    for (const t of announcement.targets) {
      lines.push(`  • ${t.guild || "(no guild)"} = ${t.content || "(empty)"}`);
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
 * (header + time + every target) in one message.
 */
export function formatTelegramMessage(announcement: Announcement): string {
  const lines: string[] = [];

  if (announcement.header !== "") lines.push(announcement.header);
  if (announcement.time !== "") lines.push(`Time = ${announcement.time}`);

  for (const t of announcement.targets) {
    lines.push(`${t.guild}: ${t.content}`);
  }

  // Fallback so we never send an empty Telegram message.
  if (lines.length === 0) lines.push("(empty announcement)");

  return lines.join("\n");
}

// --- Planning --------------------------------------------------------------

/**
 * Decide whether a single target may post to its LIVE guild channel. Anything
 * that fails here is diverted to #needs-review instead. This mirrors the
 * validation gate but at per-target granularity so good targets in a partly
 * broken announcement still get delivered (never silently dropped).
 */
function targetIsLive(announcement: Announcement, target: Target): boolean {
  if (announcement.type === "other") return false;
  if (!KNOWN_GUILDS.includes(target.guild)) return false;
  if (target.content.trim() === "") return false;
  return true;
}

/** The webhook URLs a live target fans out to (its guild's channel list). */
function channelsForTarget(guild: string): string[] {
  const route = ROUTES[guild];
  if (route === undefined) return [];
  return route.webhooks;
}

/**
 * Build the full delivery plan from a validated result. Pure and deterministic:
 * called by /preview to describe, and by /confirm to execute.
 */
export function planDeliveries(result: ValidationResult): DeliveryPlan {
  const { announcement } = result;
  const discord: PlannedDiscordPost[] = [];
  const planNotes: string[] = [];

  // Track whether we need a single #needs-review post (for diverted targets or
  // an announcement-level problem).
  let anyDiverted = false;

  for (const target of announcement.targets) {
    if (targetIsLive(announcement, target)) {
      const route = ROUTES[target.guild]!; // known guild -> route exists
      const urls = channelsForTarget(target.guild);

      if (urls.length === 0) {
        // Known guild but no webhook configured: don't drop it, divert to
        // review so it's still visible.
        anyDiverted = true;
        planNotes.push(
          `${target.guild} has no webhook configured; diverting to needs-review.`,
        );
        continue;
      }

      const message = formatDiscordMessage(announcement, target, route.rolePing);
      for (const url of urls) {
        discord.push({
          label: target.guild,
          url,
          message,
          isNeedsReview: false,
        });
      }
    } else {
      // This target can't go live — it will be covered by the combined
      // needs-review post below.
      anyDiverted = true;
    }
  }

  // If the announcement itself was flagged, or any target was diverted, emit a
  // single combined needs-review post (when the channel is configured).
  if (result.needsReview || anyDiverted) {
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
