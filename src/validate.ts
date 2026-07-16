// Validation gate.
//
// "The LLM proposes; code validates." This module takes a parsed Announcement
// (from llm.ts) and checks it against the hard rules in CLAUDE.md. It returns
// the announcement unchanged plus a list of human-readable warnings and a
// `needsReview` flag.
//
// IMPORTANT: nothing here throws for bad *content* — a boss alert is
// time-critical, so instead of rejecting we surface problems as warnings and,
// when serious, set `needsReview` so the router sends it to #needs-review
// rather than a live guild channel. We fail VISIBLY, never silently.

import { KNOWN_GUILDS } from "./config.js";
import type {
  Announcement,
  ValidationResult,
  ValidationWarning,
} from "./types.js";

/**
 * Classic Levenshtein edit distance. Used to detect a guild tag that is
 * "close but unknown" (a typo) so we can warn with a suggestion instead of
 * treating it as a totally foreign guild.
 */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // prev[j] = distance for a[0..i-1] vs b[0..j-1] on the previous row.
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      // Indices are provably in-bounds here; the assertions satisfy
      // noUncheckedIndexedAccess without changing the algorithm.
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1, // deletion
        curr[j - 1]! + 1, // insertion
        prev[j - 1]! + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/**
 * Find the closest known guild to an unknown tag, if any is "close enough".
 * Case-insensitive comparison; a distance of <= 2 counts as a likely typo.
 */
function suggestGuild(unknown: string): string | undefined {
  const target = unknown.toLowerCase();
  let best: string | undefined;
  let bestDist = Infinity;
  for (const known of KNOWN_GUILDS) {
    const dist = editDistance(target, known.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = known;
    }
  }
  // Only suggest when it's plausibly the same tag mistyped.
  return bestDist <= 2 ? best : undefined;
}

/**
 * Run the validation gate. Returns the announcement plus warnings and a
 * `needsReview` flag. `needsReview` is set when there is at least one hard
 * error (unknown guild, empty content, no targets, or a non-boss type) —
 * anything that means we should not blindly post to a live channel.
 *
 * Note: `time` is intentionally NOT validated. It's optional passthrough text
 * (the app never schedules around it), so a missing or oddly-formatted time is
 * fine — the operator sees it verbatim in the preview.
 */
export function validateAnnouncement(announcement: Announcement): ValidationResult {
  const warnings: ValidationWarning[] = [];
  let needsReview = false;

  // --- type ----------------------------------------------------------------
  const validTypes = ["boss", "other"];
  if (!validTypes.includes(announcement.type)) {
    warnings.push({
      level: "error",
      message: `Unknown announcement type "${announcement.type}".`,
    });
    needsReview = true;
  }

  // If the model decided this isn't a boss announcement at all, that's a
  // review case by definition — there's nothing to route to a live guild.
  if (announcement.type === "other") {
    warnings.push({
      level: "warning",
      message:
        'Message was not recognized as a boss announcement (type "other"). ' +
        "It will be sent to the needs-review channel.",
    });
    needsReview = true;
  }

  // --- targets -------------------------------------------------------------
  if (announcement.type !== "other" && announcement.targets.length === 0) {
    warnings.push({
      level: "error",
      message: "No targets were parsed from the announcement.",
    });
    needsReview = true;
  }

  announcement.targets.forEach(function checkTarget(target, index) {
    // guild must be known.
    if (!KNOWN_GUILDS.includes(target.guild)) {
      const suggestion = suggestGuild(target.guild);
      const hint = suggestion ? ` Did you mean "${suggestion}"?` : "";
      warnings.push({
        level: "error",
        targetIndex: index,
        message: `Unknown guild "${target.guild}".${hint}`,
      });
      needsReview = true;
    }

    // content must be non-empty.
    if (target.content.trim() === "") {
      warnings.push({
        level: "error",
        targetIndex: index,
        message: `Target for "${target.guild || "(no guild)"}" has empty content.`,
      });
      needsReview = true;
    }
  });

  return { announcement, warnings, needsReview };
}
