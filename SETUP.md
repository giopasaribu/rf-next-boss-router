# SETUP.md — From-scratch deployment guide

This guide takes you from **nothing** to a running RF Boss Announcement Router on
a fresh Linux VPS: getting a free **Groq** API key for the LLM, getting your
Discord webhooks and Telegram bot, deploying the app, and testing the whole thing
safely **directly on the production server** (you have no separate environment).

Parsing runs on Groq's **free cloud API**, so there's no local model and no need
for a big/expensive box — a tiny VPS is plenty.

It assumes an **empty Ubuntu 22.04 or 24.04 VPS** (this guide is written for a
**BiznetGio** instance, but any Ubuntu VPS works identically) and that you have
basic command-line comfort. Every command is copy-pasteable. Where you must
substitute your own value it looks like `<this>`.

> **Golden rule for testing on prod:** the very first end-to-end test posts to a
> **throwaway private Discord channel**, not your real guild channels. You swap
> in the real webhooks only after you've seen it work. This guide is built around
> that safety net.

---

## Table of contents

1. [What you'll end up with](#1-what-youll-end-up-with)
2. [Minimum VPS requirements](#2-minimum-vps-requirements)
3. [Provision & harden the VPS](#3-provision--harden-the-vps)
4. [Install Node.js and tools](#4-install-nodejs-and-tools)
5. [Get a free Groq API key](#5-get-a-free-groq-api-key)
6. [Create your Discord webhooks](#6-create-your-discord-webhooks)
7. [Create your Telegram bot & get the chat id](#7-create-your-telegram-bot--get-the-chat-id)
8. [Get the code onto the VPS](#8-get-the-code-onto-the-vps)
9. [Configure `.env`](#9-configure-env)
10. [Build & first smoke test (private, on the server)](#10-build--first-smoke-test-private-on-the-server)
11. [Full end-to-end test on prod (safe channel first)](#11-full-end-to-end-test-on-prod-safe-channel-first)
12. [Run it as a service (systemd)](#12-run-it-as-a-service-systemd)
13. [Expose it to the internet safely](#13-expose-it-to-the-internet-safely)
14. [Go live: switch to real webhooks](#14-go-live-switch-to-real-webhooks)
15. [Updating / redeploying](#15-updating--redeploying)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. What you'll end up with

```
        Operator's browser
               │  (HTTPS, shared-secret gated)
               ▼
      ┌─────────────────────┐   HTTPS   ┌──────────────────┐
      │  Node app (Fastify) │──────────▶│  Groq LLM (cloud)│
      │   port 3000         │           └──────────────────┘
      └─────────┬───────────┘
                │ on Confirm
        ┌───────┴─────────┐
        ▼                 ▼
  Discord webhooks   Telegram bot
  (per guild)        (your DM copy)
```

The Node app runs on your VPS and is the only thing exposed (behind a shared
secret and ideally HTTPS). The LLM parsing is an outbound HTTPS call to Groq's
cloud — nothing heavy runs locally.

---

## 2. Minimum VPS requirements

Because the LLM runs on Groq's cloud, the VPS only has to run a small Node
process (~50–80 MB RAM). The requirements are **tiny**:

| Resource | Minimum | Comfortable | Notes |
|----------|---------|-------------|-------|
| **RAM** | **512 MB** | 1 GB | 512 MB works; 1 GB gives headroom for `npm install` / `npm run build`. |
| **vCPU** | 1 | 1–2 | The app is I/O-bound (it waits on Groq/Discord), not CPU-bound. |
| **Disk** | **10 GB** | 20 GB | OS + Node + app + `node_modules`. No model files to store. |
| **GPU** | none | none | Not needed at all. |

**Also:**

- **OS:** Ubuntu 22.04 / 24.04 LTS (this guide's commands). Debian 12 works too.
- **Outbound internet:** the app makes HTTPS calls to `api.groq.com`,
  `discord.com`, and `api.telegram.org`. Outbound is open by default on a normal
  VPS — no special config.
- **Network:** a public IPv4. A **domain name** pointed at it is recommended
  (needed for free HTTPS in step 13) but not mandatory.

On **BiznetGio**, the smallest **NEO Lite / Virtual Compute** instance (1 vCPU,
1 GB) is more than enough — pick an **Ubuntu 24.04** image. Any equivalent small
plan elsewhere (Hetzner, DigitalOcean, Vultr, Linode) works the same way.

> No swap step is needed at 1 GB for this workload. If you go as low as 512 MB
> and `npm run build` gets killed, add swap (see step 3.5) or build once on a
> roomier box and copy the `dist/` folder up.

---

## 3. Provision & harden the VPS

Create the VPS in the BiznetGio console (or your provider) — choose an **Ubuntu
24.04 LTS** image, the smallest plan (1 vCPU / 1 GB is plenty). You'll get a
public IP and either a root password or an SSH key. Then:

### 3.1 Log in

```bash
ssh root@<your-server-ip>
```

### 3.2 Update the system

```bash
apt update && apt upgrade -y
```

### 3.3 Create a non-root user (don't run the app as root)

```bash
adduser boss            # set a password when prompted
usermod -aG sudo boss   # allow sudo
```

If you log in with an SSH key, copy it to the new user so you can SSH in as them:

```bash
rsync --archive --chown=boss:boss ~/.ssh /home/boss
```

From now on, log in as `boss`:

```bash
exit                    # leave the root session
ssh boss@<your-server-ip>
```

### 3.4 Firewall (open only SSH for now)

```bash
sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw enable         # answer 'y'
sudo ufw status
```

We deliberately do **not** open port 3000 to the world. During testing you'll
reach the app through an SSH tunnel; later (step 13) you'll open 80/443 for a
reverse proxy instead.

### 3.5 (Optional) Add swap — only if you're on a very small (512 MB) box

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h                 # confirm swap is present
```

---

## 4. Install Node.js and tools

The app needs **Node.js 18+** (it uses the built-in global `fetch`). We'll
install the current LTS (Node 22) from NodeSource, plus git.

```bash
# Node 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git

# Verify
node --version    # should print v22.x (18+ is fine)
npm --version
```

---

## 5. Get a free Groq API key

The app sends each pasted announcement to **Groq**, a free, fast, OpenAI-compatible
LLM API, and gets back structured JSON. There's nothing to install on the server —
just a key.

### 5.1 Create the key

1. Go to **[console.groq.com](https://console.groq.com)** and sign up (free —
   Google/GitHub sign-in works).
2. Open **API Keys** → **[console.groq.com/keys](https://console.groq.com/keys)**.
3. Click **Create API Key**, give it a name (e.g. `boss-router`), and **copy the
   key** — it looks like `gsk_...`. You can't view it again after closing the
   dialog, so paste it somewhere safe now. This is your `GROQ_API_KEY`.

> The free tier is generous (thousands of requests/day). This app uses roughly
> ~500 tokens per announcement, so normal use stays comfortably free.

### 5.2 Test the key from the VPS

This mimics exactly what the app does (chat completion with JSON mode). Substitute
your key:

```bash
curl https://api.groq.com/openai/v1/chat/completions \
  -H "Authorization: Bearer <YOUR_GROQ_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3.3-70b-versatile",
    "temperature": 0,
    "response_format": { "type": "json_object" },
    "messages": [
      { "role": "system", "content": "Return a JSON object with keys type and header." },
      { "role": "user", "content": "Novus Boss Group C Time = 18:30" }
    ]
  }'
```

You should get back a JSON response containing a `choices[0].message.content`
field with a JSON object inside it. If you get a `401`, the key is wrong; if you
get a model error, check the model name. The default model is
`llama-3.3-70b-versatile` (best quality, free) — for faster/cheaper parsing you
can later set `GROQ_MODEL=llama-3.1-8b-instant`.

---

## 6. Create your Discord webhooks

You need **one webhook per guild** (RISEvGGI, RISEvEMPEROR, RISEvEMPIRE), plus a
**needs-review** channel, plus — for safe testing — one **throwaway test**
channel. A webhook is a per-channel URL that lets the app post messages without a
bot account.

### 6.1 For each channel, create a webhook

You must have **Manage Webhooks** permission on the Discord server.

1. In Discord, go to the target channel.
2. Click the **gear icon** (Edit Channel) next to the channel name.
3. Go to **Integrations** → **Webhooks** → **New Webhook**.
4. (Optional) rename it, e.g. "Boss Router". Optionally set an avatar.
5. Click **Copy Webhook URL**. It looks like:
   ```
   https://discord.com/api/webhooks/123456789012345678/AbCdEf...longtoken...
   ```
6. Save that URL somewhere safe. **Treat it like a password** — anyone with it
   can post to that channel.

Do this for:

| Channel | Goes into `.env` as | When |
|---------|--------------------|------|
| A **private test channel** you create now (e.g. `#router-test`) | `WEBHOOK_GGI` (temporarily) | for the first test |
| RISEvGGI's real channel | `WEBHOOK_GGI` | when going live |
| RISEvEMPEROR's real channel | `WEBHOOK_EMP` | when going live |
| RISEvEMPIRE's real channel | `WEBHOOK_EMPIRE` | when going live |
| A `#needs-review` channel (private, just for you/mods) | `WEBHOOK_NEEDS_REVIEW` | always |

> **Tip:** make `#router-test` a private channel only you can see. You'll point
> **all three** guild webhooks at it during the first test so nothing lands in a
> real guild channel by accident.

### 6.2 (Optional) Role ping IDs

If you want the message to ping a role (e.g. `@BossAlert`) for a guild:

1. In Discord, enable **Developer Mode**: User Settings → Advanced → Developer
   Mode → on.
2. Go to Server Settings → Roles, right-click the role → **Copy Role ID**.
3. The env value is the ID wrapped like `<@&THEID>`, e.g. `<@&123456789012345678>`.

These go into `ROLE_ID_GGI`, `ROLE_ID_EMP`, `ROLE_ID_EMPIRE`. Leave blank for no
ping.

### 6.3 Quick sanity check of a webhook (optional)

You can verify a webhook works right from the VPS:

```bash
curl -X POST "<your-test-webhook-url>" \
  -H "Content-Type: application/json" \
  -d '{"content":"webhook test from the VPS ✅"}'
```

A message should appear in that Discord channel.

---

## 7. Create your Telegram bot & get the chat id

Telegram is your **personal copy** of every confirmed announcement. It's optional
— if you skip it, leave `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` blank and the
app simply won't send a Telegram copy.

### 7.1 Create the bot and get the token

1. In Telegram, open a chat with **[@BotFather](https://t.me/BotFather)**.
2. Send `/newbot`.
3. Give it a name (display name) and a username (must end in `bot`, e.g.
   `rf_boss_router_bot`).
4. BotFather replies with a **token** like:
   ```
   123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
   This is `TELEGRAM_BOT_TOKEN`. Keep it secret.

### 7.2 Start a chat so the bot can message you

A bot cannot message you until **you** message it first:

1. Open your new bot (search its username) and press **Start** / send any text
   like `hi`.

### 7.3 Get your chat id

Run this on the VPS (or anywhere), substituting your token:

```bash
curl "https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates"
```

Look in the JSON for `"chat":{"id":123456789,...}`. That number is your
`TELEGRAM_CHAT_ID`.

> If `getUpdates` returns an empty `result: []`, send your bot another message and
> re-run it.

### 7.4 Verify (optional)

```bash
curl "https://api.telegram.org/bot<YOUR_TOKEN>/sendMessage" \
  -d "chat_id=<YOUR_CHAT_ID>" \
  -d "text=Telegram test from the VPS ✅"
```

You should receive the message in Telegram.

---

## 8. Get the code onto the VPS

Pick whichever matches how you keep the code.

### Option A — clone from GitHub (recommended)

If you've pushed this project to a Git repo:

```bash
cd ~
git clone <your-repo-url> boss-router
cd boss-router
```

### Option B — copy from your local machine with scp/rsync

Run this **on your local machine** (not the VPS), from the project folder's
parent. It copies the source but skips `node_modules`, `dist`, and your local
`.env`:

```bash
rsync -av --exclude node_modules --exclude dist --exclude .env \
  ./rf-next-boss-router/ boss@<your-server-ip>:/home/boss/boss-router/
```

Then back on the VPS:

```bash
cd ~/boss-router
```

### Install dependencies (both options)

```bash
npm install
```

---

## 9. Configure `.env`

Create your real config from the template:

```bash
cp .env.example .env
nano .env        # or: vi .env
```

Fill it in. For the **first test**, point all three guild webhooks at your
private `#router-test` channel:

```dotenv
PORT=3000
# Bind localhost-only for the private first test (see step 10). Change to
# 0.0.0.0 later when a reverse proxy is in front (step 13).
HOST=127.0.0.1

GROQ_API_KEY=<your-gsk-key-from-step-5>
GROQ_MODEL=llama-3.3-70b-versatile
GROQ_URL=https://api.groq.com/openai/v1/chat/completions

# TEST PHASE: all three point at the throwaway channel.
WEBHOOK_GGI=<test-channel-webhook-url>
WEBHOOK_EMP=<test-channel-webhook-url>
WEBHOOK_EMPIRE=<test-channel-webhook-url>
WEBHOOK_NEEDS_REVIEW=<needs-review-webhook-url>

# Optional role pings — leave blank for now.
ROLE_ID_GGI=
ROLE_ID_EMP=
ROLE_ID_EMPIRE=

# Telegram (optional) — from step 7.
TELEGRAM_BOT_TOKEN=<your-bot-token>
TELEGRAM_CHAT_ID=<your-chat-id>

# A LONG random string. Generate one below.
APP_SHARED_SECRET=<paste-generated-secret>
```

Generate a strong shared secret:

```bash
openssl rand -hex 32
```

Paste the output as `APP_SHARED_SECRET`. This is the password the operator types
into the form. Save it — you'll need it to log in.

> The app **refuses to start** without `APP_SHARED_SECRET`. That's intentional.

---

## 10. Build & first smoke test (private, on the server)

Compile the TypeScript and start the app manually (not as a service yet, so you
can watch the logs):

```bash
npm run build
npm start
```

You should see log lines ending with `Server listening at http://127.0.0.1:3000`.
Leave it running. Open a **second SSH session** (or a new terminal) to the VPS
and run these local checks:

```bash
# 1. Health check (no secret needed)
curl http://localhost:3000/healthz
# -> {"ok":true}

# 2. Auth gate works: no secret -> 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/preview \
  -H "Content-Type: application/json" -d '{"raw":"hi"}'
# -> 401

# 3. Real parse via Groq (use YOUR shared secret)
curl -X POST http://localhost:3000/preview \
  -H "Content-Type: application/json" \
  -H "x-app-secret: <your-shared-secret>" \
  -d '{"raw":"Novus Boss Group C\nTime = 18:30\nRISEvGGI = Lv. 50 Forest of Exiles\nRISEvEMPEROR = Lv.52 Mecha Lizard\nRISEvEMPIRE = Lv.62 Prime Draco"}'
```

The third call should return JSON containing a `pendingId`, a parsed
`announcement`, a `deliveries` list, and any `warnings`. If you get that, the
**LLM + validation + planning pipeline works on the server.** (This step does not
post anything to Discord — that's the next step.)

If `/preview` returns a 502 "Failed to parse", the Groq call failed — the `detail`
field shows why (e.g. `401 Invalid API Key`, or a rate-limit message). Re-check
`GROQ_API_KEY` in `.env` and the key test from step 5.2.

### Reaching the web UI privately (SSH tunnel)

Because `HOST=127.0.0.1`, the form isn't exposed to the internet. To open it in
your **local** browser during testing, create an SSH tunnel **from your local
machine**:

```bash
ssh -L 8080:localhost:3000 boss@<your-server-ip>
```

Leave that session open, then browse to **http://localhost:8080** on your own
computer. You'll see the form. Enter your shared secret and try a paste → preview.

---

## 11. Full end-to-end test on prod (safe channel first)

Still pointed at the `#router-test` channel (from step 9), do a real
paste → preview → **confirm** through the web UI (via the tunnel from step 10):

1. In the browser (http://localhost:8080), enter the shared secret.
2. Paste a sample announcement:
   ```
   Novus Boss Group C
   Time = 18:30
   RISEvGGI = Lv. 50 Forest of Exiles
   RISEvEMPEROR = Lv.52 Mecha Lizard
   RISEvEMPIRE = Lv.62 Prime Draco
   ```
3. Click **Preview**. Confirm the routing looks right and there are no unexpected
   warnings.
4. Click **Confirm & Send**.
5. Check that **three messages appear in `#router-test`** (all three webhooks
   point there), the `#needs-review` channel gets nothing, and you receive the
   **Telegram** copy.

Also test the **safety path** — paste something with a deliberate typo:

```
RISEvGGl = Lv. 50 Forest of Exiles
```

The preview should flag `RISEvGGl` as unknown with a "did you mean RISEvGGI?"
warning, and on confirm it should go to **`#needs-review`**, not a live channel.

When all of that behaves, the system is proven end-to-end. Stop the manual run
with **Ctrl+C** in the first SSH session; we'll now make it permanent.

---

## 12. Run it as a service (systemd)

So the app starts on boot and restarts on crash.

Create the unit file:

```bash
sudo nano /etc/systemd/system/boss-router.service
```

Paste (adjust `User`/paths only if you changed them):

```ini
[Unit]
Description=RF Boss Announcement Router
After=network.target

[Service]
Type=simple
User=boss
WorkingDirectory=/home/boss/boss-router
ExecStart=/usr/bin/node dist/server.js
EnvironmentFile=/home/boss/boss-router/.env
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now boss-router
sudo systemctl status boss-router --no-pager     # should be active (running)
```

Follow the logs live:

```bash
journalctl -u boss-router -f
```

> The service reads `HOST` from `.env`. It's still `127.0.0.1` right now, so the
> app remains private — reachable only via the SSH tunnel. Step 13 changes that
> properly.

---

## 13. Expose it to the internet safely

You have two good options. **Do not just open port 3000 with plain HTTP** — the
shared secret would travel unencrypted.

### Option A — Reverse proxy with HTTPS (recommended; needs a domain)

Point a domain (e.g. `boss.example.com`) at your VPS IP with an **A record** at
your DNS provider. Then use **Caddy**, which gets and renews a free Let's Encrypt
certificate automatically.

Keep `HOST=127.0.0.1`: Caddy runs on the same box, so it reaches the app at
`localhost:3000`, while the app stays unreachable directly from the internet.
Only Caddy (ports 80/443) is public.

Install Caddy:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
  sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
  sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Configure it:

```bash
sudo nano /etc/caddy/Caddyfile
```

Replace the contents with (use your domain):

```
boss.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Open the web ports and reload Caddy:

```bash
sudo ufw allow 80
sudo ufw allow 443
sudo systemctl reload caddy
```

Now browse to **https://boss.example.com** — the form, over HTTPS, from anywhere.
The SSH tunnel is no longer needed.

### Option B — No domain? Keep it private (SSH tunnel / Tailscale)

If you don't want a public URL at all, just **leave `HOST=127.0.0.1`** and reach
the form through the SSH tunnel whenever you need it:

```bash
ssh -L 8080:localhost:3000 boss@<your-server-ip>
# then browse http://localhost:8080
```

For a nicer always-on private setup, install **[Tailscale](https://tailscale.com)**
on the VPS and your devices and reach it over the private tailnet IP. Either way,
nothing is exposed publicly.

---

## 14. Go live: switch to real webhooks

Once testing passes, point the guild webhooks at the **real** channels:

```bash
nano ~/boss-router/.env
```

- Set `WEBHOOK_GGI`, `WEBHOOK_EMP`, `WEBHOOK_EMPIRE` to the **real** guild
  channel webhooks (from step 6).
- Fill in `ROLE_ID_*` if you want role pings.
- If you exposed via Caddy (Option A) and want to double-check nothing else
  reaches the port directly, confirm `HOST=127.0.0.1` (Caddy proxies to it).

Apply the change by restarting the service:

```bash
sudo systemctl restart boss-router
```

Do one more **real** paste → preview → confirm and verify each guild's message
lands in the correct channel. You're live.

> Config changes (webhooks, secret, model) only take effect after
> `sudo systemctl restart boss-router`.

---

## 15. Updating / redeploying

When you change the code:

### If you used Git (Option A in step 8)

```bash
cd ~/boss-router
git pull
npm install          # only needed if dependencies changed
npm run build
sudo systemctl restart boss-router
journalctl -u boss-router -n 30 --no-pager    # check it came back up
```

### If you copy with rsync (Option B in step 8)

Re-run the same rsync from your local machine, then on the VPS:

```bash
cd ~/boss-router
npm install
npm run build
sudo systemctl restart boss-router
```

To change the **LLM model**, set `GROQ_MODEL` in `.env` to another Groq model
(e.g. `llama-3.1-8b-instant`) and `sudo systemctl restart boss-router`. Nothing
to download — it's a cloud API.

---

## 16. Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| App won't start, log says *"Missing required environment variable: APP_SHARED_SECRET"* | `.env` missing or the value is blank. Set it and restart. |
| `/preview` returns **502 "Failed to parse"** | The Groq call failed — read the `detail` in the response. `401 Invalid API Key` → fix `GROQ_API_KEY`. `429`/rate-limit → wait a moment or lower usage. Model error → check `GROQ_MODEL`. Re-run the key test (step 5.2). |
| `/preview` is **slow** then times out (~20s) | Network to `api.groq.com` is blocked or flaky, or Groq is degraded. Test egress: `curl -I https://api.groq.com`. The app times out the LLM call at 20s. |
| **401 Unauthorized** in the browser | Wrong shared secret. It must match `APP_SHARED_SECRET` in `.env` exactly. |
| Discord message never appears | Bad/rotated webhook URL, or the channel was deleted. Re-copy the webhook (step 6) and test it with the `curl` in 6.3. Check the delivery status shown after Confirm. |
| Everything goes to **#needs-review** | Guild tags in the paste don't match the known set, or `type` came back `other`. Check the preview warnings — they explain each divert. |
| No **Telegram** copy | Token/chat id wrong, or you never messaged the bot first (step 7.2). Test with the `curl` in 7.4. Leaving both blank disables Telegram silently — that's allowed. |
| Can't reach the form in the browser | If `HOST=127.0.0.1`, you must use the SSH tunnel (step 10) or a reverse proxy (step 13). Check `sudo systemctl status boss-router` and `journalctl -u boss-router`. |
| Caddy won't get a certificate | DNS A record not pointing at the VPS yet (propagation), or ports 80/443 not open in `ufw`. Check `journalctl -u caddy`. |

**Handy commands:**

```bash
sudo systemctl status boss-router --no-pager   # is the app up?
journalctl -u boss-router -f                    # live app logs
curl http://localhost:3000/healthz             # app health from the box
curl -I https://api.groq.com                    # can the box reach Groq?
free -h                                          # RAM/swap usage
```

---

That's the whole path: empty VPS → hardened box → Groq key → webhooks → deployed,
tested-on-prod, and live. Keep your `.env`, Groq API key, webhook URLs, bot
token, and shared secret private — they're the keys to the whole fan-out.
