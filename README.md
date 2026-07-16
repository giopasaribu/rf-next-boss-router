# RF Boss Announcement Router

A small **single-maintainer admin tool** for a game community's boss schedule. One
person uses a web UI to manage guilds + Discord webhooks, a reusable boss catalog,
and a **recurring daily schedule** of boss groups. It posts the schedule to the
right channels on demand and **fires automatic reminders a few minutes before
every spawn**.

**All times are UTC+7 (WIB, Indonesia).** There is **no LLM / no text parsing** —
you enter structured data; the app formats and sends it.

```
        Admin (web UI)
             │  edit guilds / bosses / schedule / watchlist  → Save
             ▼
      ┌──────────────────────┐   Announce (manual)   ┌──────────────────┐
      │  Node app (Fastify)  │ ────────────────────▶ │ Discord webhooks │
      │  + reminder scheduler│   reminders (auto)     │  + Telegram      │
      └──────────────────────┘ ────────────────────▶ └──────────────────┘
```

## What it does

- **Guilds & webhooks** — each guild has one or more Discord webhooks (managed in
  the UI, not env).
- **Boss catalog** — reusable boss definitions (name + level).
- **Schedule** — a recurring list of **timings** (boss groups). At each timing
  (e.g. `12:00`) you add spawns; each spawn is a boss assigned to one or more
  guilds. A guild can have many bosses; a boss can go to many guilds.
- **Announce** — post the current schedule now. Two modes (toggle):
  - **Per-guild** (default): each guild channel gets only its own bosses.
  - **Concatenated**: the whole schedule (each boss tagged with its guilds) to the
    selected channels.
- **Reminders** — fire automatically every day, `N` minutes before each timing
  (dropdown: 5/10/15/30/60). **One reminder per boss group per channel** — a guild
  with several bosses at 12:00 gets a single 12:00 reminder listing them all.
- **Watchlist** — extra webhooks (your Telegram, a monitor channel) that also
  receive announcements and/or reminders for all timings.

## Requirements

- **Node.js 18+** (uses the global `fetch`). Developed on Node 24.
- An **always-on, private server** (e.g. a small VPS). Always-on because reminders
  fire from an in-process scheduler; private because **there is no auth**.
- Discord webhook URLs (per guild) and, optionally, a Telegram bot — all entered
  in the UI, not in `.env`.

## Setup

```bash
npm install
cp .env.example .env     # only PORT/HOST/DB paths — no secrets
npm run build
npm start                # or: npm run dev  (auto-reload)
```

Open `http://localhost:3000` and use the UI to:

1. **Add guilds** and paste each guild's Discord webhook URL(s).
2. (Optional) **Add bosses** to the catalog.
3. **Build the schedule** — add a timing (`+ Add timing`), then add bosses to it
   (`+ Add boss`), pick the boss, set the level, and tick the guilds it goes to.
4. Set the **reminder lead** and **send mode** in Settings.
5. (Optional) **Watchlist** — add your Telegram (bot token + chat id) or another
   webhook to mirror everything.
6. **Save**, then **Announce…** to preview and post.

Reminders then fire automatically each day.

### `.env` (process wiring only — no secrets)

| Variable | What it is |
| --- | --- |
| `PORT` / `HOST` | Listen port + interface (default `3000` / `0.0.0.0`). |
| `DB_PATH` | App-state JSON file (default `./data/db.json`) — put it on a persistent disk. |
| `FIRED_PATH` | Reminder "fired today" log (default `./data/reminders-fired.json`). |

Guilds, webhooks, Telegram tokens, bosses and the schedule are all saved in the
data store via the UI — **not** in env.

> **No login.** Anyone who can reach the page can edit and post. Run it on a
> private network / behind a VPN / bound to localhost — never on the open internet.

## Deploying

Self-host on a private, always-on VPS. Full step-by-step (get webhooks, systemd,
data persistence, keeping it private): **[SETUP.md](./SETUP.md)**.

Short version — build once and run under systemd:

```ini
# /etc/systemd/system/boss-router.service
[Unit]
Description=RF Boss Announcement Router
After=network.target

[Service]
Type=simple
User=boss
WorkingDirectory=/opt/boss-router
ExecStart=/usr/bin/node dist/server.js
EnvironmentFile=/opt/boss-router/.env
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

The `data/` directory must be on a persistent disk so the schedule + reminders
survive restarts. A `GET /healthz` endpoint is available for uptime checks.

> **Not for Render free / serverless:** those sleep when idle, so reminders won't
> fire, and a public URL with no auth is unsafe. See the note in
> [DEPLOY-RENDER.md](./DEPLOY-RENDER.md).

## Project layout

```
src/
├── server.ts        Fastify app: serves UI + API, starts the scheduler
├── config.ts        env, paths, WIB constants, reminder-lead options
├── types.ts         the data model (guilds, bosses, schedule, watchlist, settings)
├── db.ts            load/save app state (data/db.json)
├── fired.ts         per-day "reminder already fired" log
├── wib.ts           UTC+7 time helpers
├── messages.ts      build announcement/reminder text + delivery plans
├── sender.ts        POST to Discord/Telegram, chunking, status
├── scheduler.ts     interval that fires due reminders daily
├── routes/
│   ├── index.ts     GET /            (serve the UI)
│   ├── state.ts     GET/PUT /api/state
│   └── announce.ts  POST /api/announce
└── public/
    └── index.html   the whole admin UI (inline CSS + vanilla JS)
```

## Notes

- **Times are UTC+7 (WIB)** everywhere — inputs, messages, reminders.
- **Reminder timing:** each timing fires once per day at `spawn − lead`. If the
  process is down through that window, that reminder is skipped (it doesn't fire
  late after the boss has spawned).
- **Backups:** `data/db.json` is your whole config — back it up. It contains
  secrets, so keep it private (it's gitignored).
```
