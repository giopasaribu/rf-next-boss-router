// Shared type definitions for the announcement pipeline.
//
// These types are the contract between the LLM output, the validation gate,
// the pending store, and the fan-out router. Keeping them in one place means
// the "shape" of an announcement is defined exactly once.
//
// A real operator post is a DAILY SCHEDULE: an optional title line, an optional
// global mention (e.g. @here), and MANY boss groups — each group has its own
// header, its own time, and its own per-guild lines. So an Announcement holds a
// list of `groups`, not a single header/time.

/**
 * The kind of announcement the operator pasted.
 *   "boss"  — a parseable boss announcement / schedule that should be forwarded.
 *   "other" — not a boss announcement (routed to #needs-review, never live).
 */
export type AnnouncementType = "boss" | "other";

/** A single guild + the content that should be posted to that guild. */
export interface Target {
  guild: string; // e.g. "RISEvGGI"
  content: string; // e.g. "Lv. 50 Forest of Exiles"
}

/**
 * One boss group inside an announcement: a header line, an optional time, and
 * the per-guild targets for that group.
 */
export interface BossGroup {
  header: string; // e.g. "Novus Boss Group B"; "" if none
  time: string; // just the value, e.g. "12:00" (NOT "Time = 12:00"); "" if none
  targets: Target[];
}

/**
 * The structured announcement. This is EXACTLY what we ask the LLM to produce
 * (see llm.ts) and what the validation gate checks before we trust it.
 */
export interface Announcement {
  type: AnnouncementType;
  title: string; // overall schedule title / date line; "" if none
  mention: string; // global mention to prepend to each message, e.g. "@here"; "" if none
  groups: BossGroup[];
}

/** Severity of a validation note surfaced in the preview. */
export type WarningLevel = "warning" | "error";

/** A single human-readable validation note attached to the preview. */
export interface ValidationWarning {
  level: WarningLevel;
  message: string;
}

/** Result of running the validation gate over a parsed announcement. */
export interface ValidationResult {
  announcement: Announcement;
  warnings: ValidationWarning[];
  // True if anything failed hard enough that it should NOT go to a live guild
  // channel and must be routed to #needs-review instead.
  needsReview: boolean;
}
