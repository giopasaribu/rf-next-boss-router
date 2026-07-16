# RF Boss Announcement Router

A tiny internal service that lets a **non-technical operator** paste a raw game
boss announcement into a web form, previews exactly where it will be posted, and
on one click fans it out to the correct **per-guild Discord channels** (via
webhooks) plus a personal **Telegram** copy.

The parsing is done by a **cloud LLM (Groq's free API)** — the operator never writes JSON.
A **preview + confirm** step is the primary safeguard against mis-routing a
time-critical alert.

```
paste raw text ─▶ /preview ─▶ [Groq LLM parse] ─▶ [validation gate] ─▶ preview
                                                                        │
                              operator reviews routing + warnings ◀─────┘
                                                                        │
                                                       [Confirm & Send] ▼
                              /confirm ─▶ Discord webhooks + Telegram copy
```

## How it works

1. **`GET /`** serves a single self-contained HTML form (textarea + Send).
2. **`POST /preview`** sends the pasted text to the Groq API, parses it into the
   structured `Announcement` schema, runs a **validation gate**, stores the
   validated result server-side under a random `pendingId` (short TTL), and
   returns a preview of what will post where — **without** exposing webhook URLs.
3. **`POST /confirm`** looks up that `pendingId` and fans out. It **never re-runs
   the LLM** — it posts exactly what was previewed. The `pendingId` is one-shot,
   so a double-click cannot double-post.

### The validation gate (safety)

The LLM proposes; the code validates. For every target:

- the `guild` must be a known guild (`RISEvGGI`, `RISEvEMPEROR`, `RISEvEMPIRE`) —
  a close-but-unknown tag becomes a **warning with a "did you mean" suggestion**,
  not an auto-post;
- `content` must be non-empty;
- the `type` must be `boss` (anything the model marks `other` is not a boss
  announcement and is diverted for review).

`time` is **not** validated — it's optional passthrough text (an in-game spawn
time). If the pasted message has one it's forwarded verbatim; if not, the line is
simply omitted. The app never schedules anything around it.

Anything that fails is **diverted to a `#needs-review` channel** instead of a
live guild channel, and surfaced as a warning in the preview. Good targets in a
partly-broken announcement still get delivered — nothing is silently dropped.

> **Deploying from scratch on a fresh VPS?** Follow **[SETUP.md](./SETUP.md)** —
> a step-by-step guide covering VPS sizing, getting a free Groq API key, getting
> Discord webhooks and a Telegram bot, deploying, and safely testing on
> production. The notes below are the quick reference.

## Requirements

- **Node.js 18+** (uses the global `fetch`). Developed on Node 24.
- A free **[Groq](https://console.groq.com/keys)** API key (for LLM parsing).
  No local model or GPU needed — parsing runs on Groq's cloud, so the server can
  be a tiny/cheap instance.

## Setup

```bash
npm install
cp .env.example .env   # then fill in the values (see below)
```

### Configure `.env`

| Variable | What it is |
| --- | --- |
| `PORT` | Port to listen on (default 3000). |
| `GROQ_API_KEY` | **Required.** Free key from [console.groq.com/keys](https://console.groq.com/keys). |
| `GROQ_MODEL` | Model to use (default `llama-3.3-70b-versatile`; `llama-3.1-8b-instant` for speed). |
| `GROQ_URL` | API endpoint (default `https://api.groq.com/openai/v1/chat/completions`). |
| `WEBHOOK_GGI` / `WEBHOOK_EMP` / `WEBHOOK_EMPIRE` | Discord webhook URL, one per guild. |
| `WEBHOOK_NEEDS_REVIEW` | Fallback channel for invalid / unparseable messages. |
| `ROLE_ID_*` | Optional role ping prepended to a guild's message, e.g. `<@&123…>`. |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | The developer's personal copy (optional). |
| `APP_SHARED_SECRET` | **Required.** Gates the form's API endpoints. |

> The server **refuses to start** without `APP_SHARED_SECRET` — an unprotected
> fan-out endpoint is a footgun, not a convenience.

Discord webhook URLs come from a channel's **Edit Channel → Integrations →
Webhooks**. The Telegram token comes from **@BotFather**; `TELEGRAM_CHAT_ID` is
your own chat id.

## Run

```bash
# Development (auto-reload):
npm run dev

# Production build + run:
npm run build
npm start
```

Then open `http://localhost:3000`, enter the shared secret once, paste an
announcement, and Preview → Confirm.

### Adding a guild or channel

Editing config only — no logic changes:

1. add the new webhook/role env vars to `.env` (and `.env.example`);
2. add a line to the `ROUTES` table in `src/config.ts`.

The known-guild set the validator uses is derived from `ROUTES`, so the two
never drift.

## Project layout

```
src/
├── server.ts          Fastify app: plugins + route registration
├── config.ts          env loading, ROUTES table, known-guild set, public dir
├── types.ts           shared Announcement / validation types
├── llm.ts             Groq API call + prompt + JSON parse -> Announcement
├── validate.ts        validation gate -> { announcement, warnings, needsReview }
├── pending.ts         TTL pending-parse store (in-memory Map), one-shot confirm
├── router.ts          message formatting, delivery planning, Discord + Telegram fan-out
├── auth.ts            shared-secret preHandler
├── routes/
│   ├── index.ts       GET /        (serve the form)
│   ├── preview.ts     POST /preview (LLM + validate + store)
│   └── confirm.ts     POST /confirm (fan-out from store)
└── public/
    └── index.html     the one-page form + preview + confirm UI
```

## Deploying on a VPS (systemd)

Build once (`npm run build`) and run `dist/server.js` under systemd. Example
unit — adjust `User`, `WorkingDirectory`, and the node path:

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

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now boss-router
sudo systemctl status boss-router
journalctl -u boss-router -f      # logs
```

The service binds `0.0.0.0`. Put it behind a reverse proxy (nginx/Caddy) with
HTTPS and, ideally, restrict access — the `APP_SHARED_SECRET` is the last line
of defense, not the only one. A `GET /healthz` endpoint is available for uptime
checks.

## Notes / open items

- **LLM model:** defaults to Groq's `llama-3.3-70b-versatile`. Set `GROQ_MODEL`
  to switch (e.g. `llama-3.1-8b-instant` for faster/cheaper parsing).
- **Guild set:** `RISEvGGI`, `RISEvEMPEROR`, `RISEvEMPIRE`. Add more in
  `src/config.ts`.
- **Pending store:** in-memory `Map` (fine for a single process). Swap for
  SQLite only if it must survive restarts.
- Hand-editing a mis-parsed field in the preview before confirming is a
  possible v2 enhancement; v1 diverts anything questionable to `#needs-review`.
```
