# DEPLOY-RENDER.md — the easy way (recommended)

Deploy the RF Boss Announcement Router on **[Render](https://render.com)** with
**no server to manage**: push to GitHub, click through a Blueprint, paste a few
secrets, done. Render gives you HTTPS and a public URL automatically, and it has
a **free tier**.

This is the recommended path. If you'd rather self-host on your own VPS (e.g.
BiznetGio) with full control, use **[SETUP.md](./SETUP.md)** instead — the
credential steps (Groq / Discord / Telegram) there are more detailed and apply
identically.

> **Golden rule for testing:** the first end-to-end test posts to a **throwaway
> private Discord channel**, not your real guild channels. You swap in the real
> webhooks only after you've seen it work.

---

## What you'll end up with

```
   Operator's browser
          │  (HTTPS via Render, shared-secret gated)
          ▼
   ┌──────────────────────┐   HTTPS   ┌──────────────────┐
   │  Render web service  │──────────▶│  Groq LLM (cloud)│
   │  (this app)          │           └──────────────────┘
   └──────────┬───────────┘
              │ on Confirm
      ┌───────┴─────────┐
      ▼                 ▼
 Discord webhooks   Telegram bot
```

No LLM runs on the server — it's an outbound call to Groq's free API — so the
free Render instance is plenty.

---

## Before you start — gather 3 things

You need these regardless of host. Below is the short version; **[SETUP.md](./SETUP.md)**
has the click-by-click screenshots-in-words if you get stuck.

### 1. A free Groq API key

1. Sign up at **[console.groq.com](https://console.groq.com)** (free).
2. Go to **[API Keys](https://console.groq.com/keys)** → **Create API Key** →
   copy it (looks like `gsk_...`). You can't see it again later — save it now.

### 2. Discord webhooks

A webhook is a per-channel URL that lets the app post without a bot. For each
channel: **Edit Channel (gear) → Integrations → Webhooks → New Webhook → Copy
Webhook URL**. You need:

| Channel | Used for |
|---|---|
| A **private `#router-test` channel** you create now | the first test (point all 3 guild webhooks here) |
| RISEvGGI's real channel | `WEBHOOK_GGI` when you go live |
| RISEvEMPEROR's real channel | `WEBHOOK_EMP` when you go live |
| RISEvEMPIRE's real channel | `WEBHOOK_EMPIRE` when you go live |
| A private `#needs-review` channel | `WEBHOOK_NEEDS_REVIEW` (always) |

Treat every webhook URL like a password.

### 3. (Optional) A Telegram bot for your personal copy

1. Message **[@BotFather](https://t.me/BotFather)** → `/newbot` → follow prompts →
   copy the **token**.
2. Open your new bot and press **Start** (a bot can't message you until you
   message it first).
3. Get your chat id: `curl "https://api.telegram.org/bot<TOKEN>/getUpdates"` and
   read `"chat":{"id":...}`.

Skip this entirely if you don't want a Telegram copy — leave those vars unset.

---

## Deploy in 6 steps

### Step 1 — Put the code on GitHub

Render deploys from a Git repo. From the project folder on your machine:

```bash
git init
git add .
git commit -m "RF Boss Announcement Router"
# create an empty repo on github.com first, then:
git remote add origin https://github.com/<you>/rf-next-boss-router.git
git branch -M main
git push -u origin main
```

The repo already includes **`render.yaml`** (the Blueprint) and a `.gitignore`
that keeps your real `.env` out — never commit secrets.

### Step 2 — Create the Blueprint on Render

1. Sign up / log in at **[dashboard.render.com](https://dashboard.render.com)**
   (you can sign in with GitHub).
2. Click **New +** → **Blueprint**.
3. Connect your GitHub account and select the `rf-next-boss-router` repo.
4. Render reads `render.yaml` and shows a service named **rf-boss-router**.
   Click **Apply** / **Create**.

### Step 3 — Fill in the secrets

Render prompts you for every value marked `sync: false` in the Blueprint. For the
**first test**, set all three guild webhooks to your `#router-test` webhook:

| Variable | Value to enter |
|---|---|
| `GROQ_API_KEY` | your `gsk_...` key |
| `WEBHOOK_GGI` | **test-channel** webhook (for now) |
| `WEBHOOK_EMP` | **test-channel** webhook (for now) |
| `WEBHOOK_EMPIRE` | **test-channel** webhook (for now) |
| `WEBHOOK_NEEDS_REVIEW` | your `#needs-review` webhook |

`APP_SHARED_SECRET` is **generated automatically** — you don't type it. `GROQ_MODEL`
and `HOST` are pre-filled by the Blueprint.

> Want Telegram or role pings? After the service is created, go to the service →
> **Environment** → add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ROLE_ID_*`.

### Step 4 — Let it build

Render runs `npm install --include=dev && npm run build`, then `npm start`. Watch
the **Logs** tab. When you see `Server listening ...` and the health check passes,
the status turns **Live**. You get a URL like:

```
https://rf-boss-router.onrender.com
```

### Step 5 — Get your login password

`APP_SHARED_SECRET` was auto-generated. To see it:

1. Open the service → **Environment** tab.
2. Find `APP_SHARED_SECRET` → click the reveal/eye icon → copy the value.

That string is the password you type into the form's **Shared secret** box. (You
can replace it with your own value here if you prefer — just click edit, set it,
and Render redeploys.)

### Step 6 — First test (still on the test channel)

1. Open your Render URL in a browser.
2. Enter the shared secret (from step 5).
3. Paste a sample announcement:
   ```
   Novus Boss Group C
   Time = 18:30
   RISEvGGI = Lv. 50 Forest of Exiles
   RISEvEMPEROR = Lv.52 Mecha Lizard
   RISEvEMPIRE = Lv.62 Prime Draco
   ```
4. Click **Preview** — check the routing and warnings look right.
5. Click **Confirm & Send**.
6. Verify **three messages land in `#router-test`**, `#needs-review` stays empty,
   and (if configured) you get the **Telegram** copy.

Also test the safety path — paste a deliberate typo like `RISEvGGl = ...`. The
preview should flag it ("did you mean RISEvGGI?") and, on confirm, route it to
**`#needs-review`**, not a live channel.

---

## Keep it awake (free tier)

Render's **free** service **sleeps after ~15 minutes** of no traffic, so the first
request after idle takes ~30–50s to cold-start. For a time-critical alert tool
that's annoying. Two options:

- **Free fix (recommended):** create a free monitor at
  **[UptimeRobot](https://uptimerobot.com)** or **[cron-job.org](https://cron-job.org)**
  that GETs `https://<your-app>.onrender.com/healthz` every ~10 minutes. That keeps
  it warm and doubles as an uptime alert. `/healthz` needs no secret.
- **Paid fix:** upgrade the service to Render's **Starter** plan (~$7/mo) for a
  always-on instance.

> Keep the service at **one instance** — do not enable autoscaling. This app holds
> previewed announcements in memory between Preview and Confirm, so multiple
> instances would split that state.

---

## Go live: switch to the real channels

Once testing passes:

1. Service → **Environment** tab.
2. Change `WEBHOOK_GGI`, `WEBHOOK_EMP`, `WEBHOOK_EMPIRE` to the **real** guild
   channel webhooks.
3. (Optional) add `ROLE_ID_*` and the Telegram vars.
4. Save — Render **redeploys automatically**.

Do one more real Preview → Confirm and check each guild's message lands in the
correct channel. You're live.

---

## Updating later

Just push to GitHub:

```bash
git add -A && git commit -m "tweak" && git push
```

`autoDeploy` is on, so Render rebuilds and redeploys on every push to `main`. Watch
the Logs tab; the old version keeps serving until the new one is healthy.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Build fails: **`tsc: not found`** | The build command must be `npm install --include=dev && npm run build` (the Blueprint sets this). Render's `NODE_ENV=production` skips devDependencies without `--include=dev`. |
| App won't start: *"Missing required environment variable: APP_SHARED_SECRET / GROQ_API_KEY"* | A required env var is empty. Service → Environment → set it → save (auto-redeploys). |
| **502 "Failed to parse"** on Preview | The Groq call failed — read the `detail`. `401` → wrong `GROQ_API_KEY`. `429` → rate limit, wait a moment. Re-check the key. |
| **401 Unauthorized** in the browser | Shared secret typed ≠ `APP_SHARED_SECRET`. Reveal the real value in the Environment tab and paste it exactly. |
| "**Preview expired or was already sent**" unexpectedly | Usually a cold start or the instance recycled between Preview and Confirm. Keep it awake (uptime pinger) and ensure a single instance. Then just paste again. |
| First load is **very slow** | Free-tier cold start. Add the uptime pinger above, or upgrade to Starter. |
| Discord message never appears | Bad/rotated webhook or deleted channel. Re-copy the webhook and check the per-channel delivery status shown after Confirm. |
| No **Telegram** copy | Token/chat id wrong, or you never pressed Start on the bot. Leaving both unset disables Telegram silently — that's allowed. |

Env-var changes only take effect after the redeploy Render triggers on save —
give it a minute and check the Logs tab.

---

Keep your Groq API key, webhook URLs, Telegram token, and the shared secret
private — they're the keys to the whole fan-out.
