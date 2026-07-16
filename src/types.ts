// Shared type definitions for the announcement pipeline.
//
// These types are the contract between the LLM output, the validation gate,
// the pending store, and the fan-out router. Keeping them in one place means
// the "shape" of an announcement is defined exactly once.

/**
 * The kind of announcement the operator pasted.
 *   "boss"  — a parseable boss announcement that should be forwarded.
 *   "other" — not a boss announcement (routed to #needs-review, never live).
 */
export type AnnouncementType = "boss" | "other";

/** A single guild + the content that should be posted to that guild. */
export interface Target {
  guild: string; // e.g. "RISEvGGI"
  content: string; // e.g. "Lv. 50 Forest of Exiles"
}

/**
 * The structured announcement. This is EXACTLY what we ask the LLM to produce
 * (see llm.ts) and what the validation gate checks before we trust it.
 */
export interface Announcement {
  type: AnnouncementType;
  header: string; // shared boss name / group; "" if none
  time: string; // optional in-game time text, forwarded as-is; "" if none
  targets: Target[];
}

/** Severity of a validation note surfaced in the preview. */
export type WarningLevel = "warning" | "error";

/** A single human-readable validation note attached to the preview. */
export interface ValidationWarning {
  level: WarningLevel;
  message: string;
  // Optional pointer at which target this note is about (index into targets).
  targetIndex?: number;
}

/** Result of running the validation gate over a parsed announcement. */
export interface ValidationResult {
  announcement: Announcement;
  warnings: ValidationWarning[];
  // True if anything failed hard enough that it should NOT go to a live guild
  // channel and must be routed to #needs-review instead.
  needsReview: boolean;
}
