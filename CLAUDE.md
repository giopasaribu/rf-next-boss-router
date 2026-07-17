# CLAUDE.md — RF Boss Announcement Router

## What this project is

A small **single-maintainer admin tool** for a game community's boss schedule. One
person uses a web UI to:

- manage **guilds**, each with one or more **Discord webhooks**;
- keep a reusable **boss catalog**;
- build a **schedule** of **timings** (boss groups), each at an absolute WIB
  date+time. Each timing holds several **spawns**; each spawn is one boss assigned to one
  or more guilds (a guild can have many bosses; a boss can go to many guilds);
- keep a **watchlist** of extra webhooks (personal Telegram, a monitor channel);
- **Announce** the schedule on demand to the channels, and get **automatic
  reminders** fired a configurable number of minutes before every spawn.

**All times are UTC+7 (WIB, Indonesia)** — a fixed offset, no DST.

There is **no LLM and no text parsing** (earlier versions had both; both were
removed). The maintainer enters structured data directly; the app formats and
sends it.

## Core design decisions (already made — do not re-litigate)

- **Structured data, not parsing.** The UI is CRUD over guilds / bosses / schedule
  / watchlist / settings. No pasting, no LLM.
- **Absolute date+times, one-off.** Each timing has a full WIB datetime (`when`,
  a `YYYY-MM-DDTHH:MM` string). There is NO reset-cycle logic — you can schedule a
  boss for tomorrow morning by picking that date. `wibToEpoch`/`formatWibDisplay`
  in `wib.ts` convert/display it.
- **Reminders fire once, then the timing is auto-removed.** The scheduler sends
  ONE reminder at (`when` − lead), and once `when` has passed it deletes the timing
  from the schedule (and the UI hides passed timings on load). So the schedule
  always shows only upcoming bosses and stale entries never re-fire.
- **Reminders are auto; the announcement is manual.** "Announce" posts the current
  schedule now (with a preview → confirm in the modal). Reminders need no
  confirmation.
- **Reminder = one per timing (boss group) per destination.** A guild with several
  bosses at 12:00 gets ONE 12:00 reminder listing them all — never one per boss.
- **Send modes (toggle at announce time):**
  - **per_guild** (default): each guild channel gets only its own bosses.
  - **concatenated**: the full schedule (all bosses, each tagged with its guilds)
    to the selected guild channels.
- **Webhooks live in the data store, not env.** Each guild has ≥1 webhook, edited
  in the UI. The watchlist holds extra Discord/Telegram destinations.
- **No auth.** Single maintainer, PRIVATE server. Do NOT expose publicly.
- **Always-on process required.** Reminders fire from an in-process scheduler, so
  the host must not sleep. Deploy on a private, always-on VPS. NOT serverless / NOT
  a sleep-prone free tier.
- **Persistence = plain JSON files** (`data/db.json` app state, `data/reminders-fired.json`
  the per-cycle fired log). No DB, no native modules. Paths are resolved relative
  to the CODE (project root), NOT `process.cwd()` — so saves work regardless of how
  the process is launched (a systemd unit with a bad/blank `WorkingDirectory` was
  what caused "save failed"). The store holds secrets (webhook URLs, Telegram
  tokens) so it must stay private and out of git.
- **Stack:** Node.js + Fastify + TypeScript, one long-lived process.

## Code style (developer preference)

- Prefer **readable, explicit code** over clever one-liners.
- Prefer named `function` declarations; arrow functions for short callbacks.
- Detailed inline comments explaining the **why**.
- TypeScript throughout, explicit types for the data model.

## Data model (`src/types.ts`)

```ts
Webhook  { id, url }
Guild    { id, name, webhooks: Webhook[] }
Boss     { id, name, level }                        // reusable catalog
Spawn    { id, bossName, level, guildIds: string[] } // one boss in a timing
Timing   { id, when /* "YYYY-MM-DDTHH:MM" WIB */, spawns: Spawn[] } // a boss group
WatchTarget {
  id, label, kind: "discord"|"telegram",
  url,                    // discord
  botToken, chatId,       // telegram
  receiveAnnouncement, receiveReminders
}
Settings { reminderLeadMinutes, sendMode: "per_guild"|"concatenated", scheduleTitle }
DB       { guilds, bosses, schedule: Timing[], watchlist, settings }
```

Spawns store `bossName`+`level` denormalized (copied from the catalog when picked,
editable per spawn) so a spawn is self-contained and catalog edits never corrupt
history.

## Application flow

```
GET  /             -> serve the single-page admin UI
GET  /api/state    -> the whole DB (UI renders from this)
PUT  /api/state    -> replace the whole DB (UI "Save")
POST /api/announce -> body { mode?, targetGuildIds?, dryRun? }
                      dryRun:true  -> planned messages (labels + text, no URLs)
                      dryRun:false -> send now, return per-destination status
GET  /healthz      -> { ok: true }
```

Plus an always-running **scheduler** (`scheduler.ts`): every ~30s it loads the
saved state and, for each timing: (a) if `when` has passed, it removes the timing
from the schedule and saves; (b) else if the reminder is due (`when − lead ≤ now`)
and not yet fired, it sends the reminder and records the timing id in the fired
log (a flat set, pruned to existing timings). It runs once on boot.

Single-user, so the API is coarse: the UI loads the whole state, edits it locally,
and saves it all back with `PUT /api/state`. `/api/announce` reads the saved state
fresh each call.

## Reminders

- Lead time is `settings.reminderLeadMinutes` (UI dropdown: 5/10/15/30/60).
- For a due timing: `planReminder` builds ONE message per guild that has bosses in
  it (to that guild's webhooks, listing only that guild's bosses) + the full-group
  message to each watchlist target with `receiveReminders`.
- One reminder per destination, no retry (retrying could double-post to
  destinations that already succeeded).

## Message formatting

- **Per-guild announcement / reminder:** only that guild's bosses.
- **Concatenated announcement / watchlist reminder:** every boss, each tagged with
  its guild names.
- Times shown inline as `DD Mon HH:MM WIB` (e.g. `17 Jul 12:00 WIB`); announcements end with a footer
  `🌏 Times are UTC+7 (WIB, Indonesia)`.
- Discord content is chunked at 2000 chars, Telegram at 4096 (`sender.ts`).
- Discord webhooks ping `@here`/`@everyone`/roles by default if present in text.

## Config / env (`.env` — no secrets here)

```
PORT=3000
HOST=0.0.0.0
DB_PATH=            # default ./data/db.json (persistent disk!)
FIRED_PATH=         # default ./data/reminders-fired.json
```

All real config (guilds, webhooks, tokens, schedule) is in the UI / data store.

## Security

- **No auth by design** — private server only (firewall / VPN / localhost+tunnel).
- `data/` holds secrets (webhook URLs, Telegram tokens) — gitignored, keep private.

## Project structure

```
src/
├── server.ts        # Fastify app; serves UI + API; starts the scheduler
├── config.ts        # env, paths, WIB constants, lead options
├── types.ts         # the data model
├── db.ts            # load/save app state (data/db.json)
├── fired.ts         # per-day "reminder already fired" log
├── wib.ts           # UTC+7 time helpers
├── messages.ts      # build announcement/reminder text + delivery plans
├── sender.ts        # POST to Discord/Telegram, chunking, status
├── scheduler.ts     # interval that fires due reminders daily
├── routes/
│   ├── index.ts     # GET /            (serve the UI)
│   ├── state.ts     # GET/PUT /api/state
│   └── announce.ts  # POST /api/announce
└── public/
    └── index.html   # the whole admin SPA (inline CSS + vanilla JS)
data/                # runtime JSON stores (gitignored)
```

## Dependencies

Runtime: `fastify`, `@fastify/static`, `dotenv`. (Node 18+ global `fetch`; the
stores are plain JSON files — no DB, no native modules.)
Dev: `typescript`, `tsx`, `@types/node`.

## Non-goals (do not build)

- No auth / multi-tenant — one maintainer, one community, private server.
- No LLM, no text parsing — structured entry only.
- No Discord bot / Gateway listener.
- No serverless / sleep-prone host (reminders need an always-on process).
- No WhatsApp integration (deferred).
```
