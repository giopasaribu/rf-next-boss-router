# CLAUDE.md — RF Boss Announcement Router

## What this project is

A small service that lets a **non-technical operator** paste a raw game boss
announcement into a simple web form. The service uses a **cloud LLM (Groq's free
API)** to parse the free-text announcement into structured JSON, shows the operator a
**preview** of what will be posted where, and on **one-click confirm** fans the
message out to the correct **per-guild Discord channels** (via webhooks) plus a
personal **Telegram** copy.

The whole point is to replace a manual, multi-person forwarding process (one
person posts to the main guild, another forwards to sub-guilds) with a single
paste-and-confirm step.

## Core design decisions (already made — do not re-litigate)

- **Stack:** Node.js + Fastify + TypeScript, run as one long-lived process. One
  process serves the form, calls the LLM, and does the fan-out. Chosen over n8n
  because a small coded service is more robust to maintain long-term; and Node
  (not Python) because the developer works in JavaScript. Fastify chosen for its
  built-in JSON-schema validation, which helps enforce the LLM output shape.
- **Deploy target:** a persistent-process host — **Render** (recommended, free,
  Blueprint in `render.yaml`) or a self-hosted VPS (BiznetGio). NOT serverless as
  written: the pending store (see below) lives in memory between `/preview` and
  `/confirm`, so it needs ONE always-on instance. Serverless (Vercel/Workers)
  would require moving that store to external KV first. Keep it single-instance.
- **LLM: Groq cloud API (revised from local Ollama).** Originally the plan was a
  local Ollama on the VPS, but that forced a ~4 GB+ RAM box just for the model.
  Since per-post token use is tiny, we switched to Groq's free, OpenAI-compatible
  API: fast, higher-quality parsing, and the server drops to a tiny/cheap
  instance. The app calls it over HTTPS; `parseAnnouncement()` in `llm.ts` is the
  single integration point. Trade-off accepted: announcement text is sent to a
  third-party API (fine for public boss alerts). A different provider or a return
  to local Ollama is a change confined to `llm.ts` + config.
- **Input method:** a dead-simple web form (single textarea + Send). NOT a Discord
  bot listener. Reason: no persistent Gateway connection to babysit, failures are
  visible (operator sees an error and retries) instead of silent, and the form
  gives us a natural preview/confirm step. Operator does NOT need to write JSON —
  they paste raw text, the backend structures it.
- **Parsing:** always send the raw text to the LLM. No regex fast-path. (User
  explicitly dropped the regex pre-parse to keep one code path.)
- **Human-in-the-loop:** the operator ALWAYS sees a preview of the parsed routing
  before anything is posted, and must click Confirm. This is the primary safeguard
  against LLM mis-routing, since boss alerts are time-critical.
- **Discord output:** webhooks (outbound-only, no bot process needed). One or more
  webhook URLs per guild. The app always forwards immediately on confirm — there
  is NO scheduling/timer behavior and no per-type channel split.
- **Telegram output:** a personal copy of the full announcement via the Telegram
  Bot API `sendMessage`. This is for the developer's own use, not per-guild.

## Code style (developer preference)

- Prefer **readable, explicit code** over clever one-liners.
- Prefer named `function` declarations over arrow functions where it reads more
  clearly (this is a stated developer preference). Arrow functions are fine for
  short callbacks, but don't golf the logic into dense arrow chains.
- Add **detailed inline comments** explaining the why, not just the what.
- TypeScript throughout, with explicit types for the announcement schema.

## The operator's input format (typical, but NOT guaranteed)

Usually a whole **daily schedule with several boss groups**, an optional title/date
line, and often a trailing `@here` mention:

```
SCHEDULE FIELD BOSS TODAY 16/07/2026

Novus Boss Group B
Time = 12:00
RISEvGGI = Lv. 42 South Dorian Forest
RISEvEMPEROR = Lv.48 Mecha Wild Beast
RISEvEMPIRE = Lv.49 Rusty Sickle

Novus Boss Group C
Time = 18:30
RISEvGGI = Lv. 50 Forest of Exiles
RISEvEMPEROR = Lv.52 Mecha Lizard
RISEvEMPIRE = Lv.62 Prime Draco

THANKKK YOUUU @here
```

Each blank-line-separated block is one boss **group** (its own header + time +
guild lines). A guild typically appears in several groups. But the operator is
non-technical and freeform. Input may have typos in guild tags (e.g. `RISEvGGl`
with a lowercase L), inconsistent spacing (`Lv.50` vs `Lv. 50`), missing lines, a
missing/extra `Time` line, non-guild target lines (e.g. `Anka 2 = ...`), or a
completely unstructured sentence that isn't a boss announcement at all. The LLM
must handle this gracefully and the validation gate must catch what it can't.

- `Time`, when present, is in-game text forwarded verbatim (just the value, e.g.
  `12:00`) — the app does not schedule anything around it.
- A mention like `@here`/`@everyone` must be preserved and re-posted so it pings.

## Target JSON schema (the LLM must output exactly this)

```ts
interface Announcement {
  type: "boss" | "other";  // "boss" = a parseable boss announcement to forward
  title: string;           // overall schedule title / date line; "" if none
  mention: string;         // global mention to prepend, e.g. "@here"; "" if none
  groups: Array<{
    header: string;        // group name, e.g. "Novus Boss Group C"; "" if none
    time: string;          // JUST the value, e.g. "18:30" (no "Time ="); "" if none
    targets: Array<{
      guild: string;       // e.g. "RISEvGGI"
      content: string;     // e.g. "Lv. 50 Forest of Exiles"
    }>;
  }>;
}
```

Example:

```json
{
  "type": "boss",
  "title": "SCHEDULE FIELD BOSS TODAY 16/07/2026",
  "mention": "@here",
  "groups": [
    {
      "header": "Novus Boss Group B",
      "time": "12:00",
      "targets": [
        { "guild": "RISEvGGI",     "content": "Lv. 42 South Dorian Forest" },
        { "guild": "RISEvEMPEROR", "content": "Lv. 48 Mecha Wild Beast" },
        { "guild": "RISEvEMPIRE",  "content": "Lv. 49 Rusty Sickle" }
      ]
    },
    {
      "header": "Novus Boss Group C",
      "time": "18:30",
      "targets": [
        { "guild": "RISEvGGI",     "content": "Lv. 50 Forest of Exiles" },
        { "guild": "RISEvEMPEROR", "content": "Lv. 52 Mecha Lizard" },
        { "guild": "RISEvEMPIRE",  "content": "Lv. 62 Prime Draco" }
      ]
    }
  ]
}
```

- `groups` is empty if the message can't be parsed as a boss announcement (then
  `type` is `"other"`).
- One element of `groups` per boss block; a guild may appear in many groups. The
  router aggregates each guild's lines from all groups into ONE message.
- Prompt the LLM to return ONLY this JSON, no markdown fences, no prose. Use the
  Groq/OpenAI `response_format: { type: "json_object" }` option to force valid
  JSON (the prompt must mention "JSON"), then parse and validate it against a
  Fastify/JSON schema (or a small hand-written validator) before use.

## Routing table (guild → channel(s))

Config lives in env / a config module, NOT hardcoded in logic. Structure:

```ts
const ROUTES: Record<string, {
  webhooks: string[];      // webhook URLs for this guild
  rolePing?: string;       // optional, e.g. "<@&123456789>", prepended to message
}> = {
  RISEvGGI: {
    webhooks: [process.env.WEBHOOK_GGI!],
    rolePing: process.env.ROLE_ID_GGI,
  },
  RISEvEMPEROR: {
    webhooks: [process.env.WEBHOOK_EMP!],
    rolePing: process.env.ROLE_ID_EMP,
  },
  RISEvEMPIRE: {
    webhooks: [process.env.WEBHOOK_EMPIRE!],
    rolePing: process.env.ROLE_ID_EMPIRE,
  },
};
```

- A guild can route to MULTIPLE channels (hence a list). Routing does NOT depend
  on the announcement type — every confirmed boss announcement for a guild goes
  to that guild's webhook list.
- `rolePing` is optional and prepended to the Discord message content.
- Adding a guild or sub-channel must be a config edit only, no logic change.

## Application flow

```
1. GET  /            -> serve the one-page form (textarea + Send button)
2. POST /preview     -> body: { raw: "<pasted text>" }
                        - call the LLM (Groq) to normalize -> parsed Announcement
                        - run validation (see below)
                        - store the validated result server-side under a random
                          pendingId with a short TTL (a few minutes)
                        - return a preview: for each target, which channel(s) it
                          will post to, the exact message text, validation
                          warnings, and the pendingId
3. POST /confirm     -> body: { pendingId }
                        - look up the pending parse (reject if missing/expired)
                        - fan out to Discord webhooks + Telegram
                        - return per-channel delivery status
```

The operator never sees JSON. The form shows: paste box -> preview ("Here's what
I'll post where") -> [Confirm & Send] / [Cancel]. `/confirm` must NOT re-run the
LLM — it posts exactly what was previewed, looked up by `pendingId`.

## Validation gate (runs after the LLM, before preview is trusted)

The LLM proposes; code validates. For each target:

- `guild` MUST be in the known set (`RISEvGGI`, `RISEvEMPEROR`, `RISEvEMPIRE`).
  If close-but-unknown, it's a warning, not an auto-post.
- `content` MUST be non-empty.
- `type` MUST be one of the allowed values (`boss` or `other`).
- `time` is OPTIONAL and is NOT validated — it's forwarded verbatim if present
  and omitted from the message if empty. The app never schedules around it.

Anything failing validation is surfaced in the preview as a WARNING and/or routed
to a `#needs-review` channel rather than a live guild channel. NEVER let raw LLM
output post to a live channel without passing the gate. Fail visibly, never
silently drop a time-critical announcement.

## Message formatting (Discord)

ONE message per guild, aggregating that guild's lines from every group. The global
mention (e.g. `@here`) and config `rolePing` go on the first line; the title once
below it; then a block per group:

```
{mention} {rolePing}          <- omit line if both empty
**{title}**                   <- omit line if title === ""

**{group header}**
Time = {time}                 <- omit this line if time === ""
Target: {content}

**{next group header}**
Time = {time}
Target: {content}
```

Discord webhook POST body: `{ "content": "<the message above>" }`. (Webhooks can
ping `@here`/`@everyone`/roles in `content` by default, which is how the mention
works.)

## Telegram (developer's personal copy)

Send the full announcement (mention + title + all groups + all targets) to a fixed
chat_id via the Bot API `sendMessage`. Single call, separate from the per-guild
Discord routing. Endpoint: `https://api.telegram.org/bot<TOKEN>/sendMessage` with
`{ chat_id, text }`.

## Config / secrets (env vars, via a .env file — never commit real values)

```
PORT=3000
HOST=0.0.0.0                   # 127.0.0.1 to bind localhost-only (private first test)
# LLM parsing via Groq's free API (https://console.groq.com/keys)
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile   # or llama-3.1-8b-instant for speed
GROQ_URL=https://api.groq.com/openai/v1/chat/completions

# Discord webhooks (one per guild)
WEBHOOK_GGI=
WEBHOOK_EMP=
WEBHOOK_EMPIRE=
WEBHOOK_NEEDS_REVIEW=          # fallback channel for unparseable / invalid

# Discord role pings (optional)
ROLE_ID_GGI=
ROLE_ID_EMP=
ROLE_ID_EMPIRE=

# Telegram (developer copy)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Simple shared-secret to protect the form/endpoints from randoms
APP_SHARED_SECRET=
```

Provide a `.env.example` with these keys and empty values. Load with `dotenv`.

## Security / hardening (light — this is a small internal tool)

- Gate the endpoints behind `APP_SHARED_SECRET` (a simple header check, or a
  password page that sets a signed cookie). Don't leave the fan-out endpoint open
  to the internet.
- Use the **server-side pending store** (a `Map` keyed by random `pendingId` with
  TTL, or a tiny SQLite/lowdb table) so `/confirm` can only post something that
  `/preview` already validated. Do not accept arbitrary parsed payloads on
  `/confirm` — only a `pendingId`. This prevents forging arbitrary channel posts.
- Rate-limit `/preview` lightly (e.g. `@fastify/rate-limit`) so a stuck operator
  can't hammer the LLM API (and blow through free-tier rate limits).

## Suggested project structure

```
.
├── CLAUDE.md               # this file
├── README.md               # quick reference
├── DEPLOY-RENDER.md        # recommended deploy guide (Render Blueprint)
├── SETUP.md                # self-host-on-a-VPS guide
├── render.yaml             # Render Blueprint (build/start/env for the web service)
├── .env.example
├── package.json
├── tsconfig.json
├── src/
│   ├── server.ts           # Fastify app, registers routes + plugins
│   ├── config.ts           # load env, build ROUTES table + known guild set
│   ├── llm.ts              # Groq API call, prompt, JSON parse
│   ├── validate.ts         # validation gate -> { announcement, warnings }
│   ├── router.ts           # build messages, fan out to Discord + Telegram
│   ├── pending.ts          # in-memory (or SQLite) pending-parse store w/ TTL
│   ├── routes/
│   │   ├── index.ts        # GET /  (serve the form)
│   │   ├── preview.ts      # POST /preview
│   │   └── confirm.ts      # POST /confirm
│   └── public/
│       └── index.html      # the one-page form + preview + confirm UI
└── README.md               # run instructions + systemd unit for the VPS
```

- Keep `index.html` a single self-contained page (inline CSS + vanilla JS using
  `fetch` for the paste -> preview -> confirm flow). No build step for the frontend,
  no framework. Serve it via `@fastify/static` or read-and-return in the route.
- Backend is TypeScript compiled with `tsc` (or run via `tsx`/`ts-node` in dev).

## Dependencies (package.json)

Runtime: `fastify`, `@fastify/static`, `@fastify/rate-limit`, `dotenv`.
(Node 18+ has global `fetch`, so no axios/node-fetch needed.)
Dev: `typescript`, `tsx` (or `ts-node`), `@types/node`.
Optional if using SQLite for the pending store: `better-sqlite3`.

Scripts:
```json
{
  "dev":   "tsx watch src/server.ts",
  "build": "tsc",
  "start": "node dist/server.js"
}
```

## Build order (suggested for Claude Code)

1. Scaffold: `package.json`, `tsconfig.json`, `.env.example`, `src/config.ts`
   (env loading + ROUTES + known guild set + shared-secret).
2. `llm.ts`: Groq call with the system prompt and JSON mode, returns a
   parsed `Announcement` object.
3. `validate.ts`: the validation gate returning `{ announcement, warnings[] }`.
4. `pending.ts`: TTL-based pending store (start with an in-memory `Map`).
5. `router.ts`: message formatting + Discord webhook POSTs + Telegram send, with
   per-channel status results and the `#needs-review` fallback.
6. `server.ts` + `routes/*`: wire `GET /`, `POST /preview` (LLM + validate +
   store), `POST /confirm` (fan-out from store), the shared-secret gate, and
   rate-limiting on `/preview`.
7. `public/index.html`: paste box -> calls /preview -> renders routing preview +
   warnings -> Confirm/Cancel -> calls /confirm -> shows delivery status.
8. `README.md`: local run (`npm run dev`), build, and a sample systemd unit for
   always-on on the VPS.

## Open decisions to confirm with the user before/while building

- **Groq model** — default `llama-3.3-70b-versatile` (free). Switch via `GROQ_MODEL`.
- **Exact guild set** — confirmed three: RISEvGGI, RISEvEMPEROR, RISEvEMPIRE. Any others?
- Whether `#needs-review` should also ping the developer on Telegram (recommended: yes).
- Whether the preview should let the operator hand-edit a mis-parsed field before
  confirming (nice-to-have v2; not required for v1).
- Pending store: in-memory `Map` is fine for v1 (single process). Move to SQLite
  only if you need it to survive restarts.

## Non-goals (do not build)

- No Discord bot / Gateway listener (input is the web form, not a watched channel).
- No regex pre-parser (always go through the LLM).
- No WhatsApp integration (explicitly deferred).
- No public multi-tenant anything — this is one operator, one game community.
