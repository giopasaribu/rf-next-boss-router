// Pending-parse store.
//
// After /preview validates an announcement, we stash the validated result here
// under a random `pendingId` with a short TTL. /confirm then looks it up by id
// and fans it out. This is a security boundary: /confirm can ONLY post things
// that /preview already produced and validated — it never accepts an arbitrary
// parsed payload, which would let a caller forge posts to any channel.
//
// v1 uses an in-memory Map (single process, fine per CLAUDE.md). Swap for
// SQLite/lowdb only if the store must survive restarts.

import { randomUUID } from "node:crypto";
import type { ValidationResult } from "./types.js";

// How long a previewed announcement stays confirmable. A few minutes is enough
// for the operator to read the preview and click Confirm, but short enough that
// stale parses don't linger.
const TTL_MS = 5 * 60 * 1000;

// How often we sweep expired entries. (Entries are also checked lazily on read,
// so the sweep is just housekeeping to keep the Map from growing unbounded.)
const SWEEP_INTERVAL_MS = 60 * 1000;

interface PendingEntry {
  result: ValidationResult;
  expiresAt: number; // epoch ms
}

const store = new Map<string, PendingEntry>();

/**
 * Store a validated result and return the random id the operator will confirm
 * with. The id is unguessable (UUID v4) so it doubles as a capability token.
 */
export function putPending(result: ValidationResult): string {
  const id = randomUUID();
  store.set(id, { result, expiresAt: Date.now() + TTL_MS });
  return id;
}

/**
 * Look up a pending result by id. Returns undefined if it is missing or has
 * expired (an expired entry is deleted on access). Does NOT delete a valid
 * entry — see takePending for the one-shot variant.
 */
export function getPending(id: string): ValidationResult | undefined {
  const entry = store.get(id);
  if (entry === undefined) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(id);
    return undefined;
  }
  return entry.result;
}

/**
 * Look up AND remove a pending result (one-shot). Using this on /confirm means
 * a given preview can only be fanned out once, preventing accidental double
 * posts from a double-click or a retried request.
 */
export function takePending(id: string): ValidationResult | undefined {
  const result = getPending(id);
  if (result !== undefined) {
    store.delete(id);
  }
  return result;
}

// Periodic sweep of expired entries. `unref()` so this timer never keeps the
// process alive on its own (important for clean shutdown / tests).
const sweep = setInterval(function sweepExpired() {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (now > entry.expiresAt) store.delete(id);
  }
}, SWEEP_INTERVAL_MS);
sweep.unref();
