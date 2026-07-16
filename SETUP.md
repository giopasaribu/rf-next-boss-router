# SETUP.md — Deploy on a private VPS (from scratch)

This takes you from an empty Ubuntu VPS to a running RF Boss Announcement Router.
It's a **single-maintainer, private** tool with **no login**, and it fires
**automatic reminders**, so it must run on an **always-on, private** server. This
guide is written for a **BiznetGio** instance but any Ubuntu VPS is identical.

Everything time-related is **UTC+7 (WIB)**. There is no LLM and no `.env` secrets
— guilds, webhooks, Telegram and the schedule are all configured in the web UI.

> **Security note up front:** because there's no auth, never expose this on the
> open internet. Keep it private — bound to localhost + reached over an SSH tunnel
> (simplest), or on a private network / behind a VPN.

---

## 1. Requirements

- An **Ubuntu 22.04 / 24.04** VPS, small is fine (**1 vCPU / 1 GB / 10 GB**). The
  app is tiny; there's no model to run.
- It must be **always-on** (reminders fire from an in-process scheduler) and have a
  **persistent disk** (the schedule + reminders are saved to `data/`).
- Discord **webhook URLs** for your channels, and optionally a **Telegram bot** —
  you'll paste these into the UI later (Sections 6–7 show how to get them).

---

## 2. Provision & harden the VPS

Create the VPS (Ubuntu 24.04, smallest plan). SSH in as root:

```bash
ssh root@<your-server-ip>
apt update && apt upgrade -y

# non-root user
adduser boss
usermod -aG sudo boss
rsync --archive --chown=boss:boss ~/.ssh /home/boss   # if you use an SSH key

# firewall: SSH only (we reach the app over an SSH tunnel, so no app port is opened)
apt install -y ufw
ufw allow OpenSSH
ufw enable
```

Log back in as `boss`:

```bash
ssh boss@<your-server-ip>
```

---

## 3. Install Node.js + git

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
node --version    # v22.x (18+ is fine)
```

---

## 4. Get the code onto the VPS

**Option A — clone from GitHub:**

```bash
cd ~
git clone <your-repo-url> boss-router
cd boss-router
```

**Option B — copy from your machine** (run locally, skips node_modules/dist/.env/data):

```bash
rsync -av --exclude node_modules --exclude dist --exclude .env --exclude data \
  ./rf-next-boss-router/ boss@<your-server-ip>:/home/boss/boss-router/
```

Then on the VPS:

```bash
cd ~/boss-router
npm install --include=dev     # --include=dev so the TypeScript build tools install
npm run build
```

---

## 5. Configure `.env` (no secrets — just paths)

```bash
cp .env.example .env
nano .env
```

```dotenv
PORT=3000
HOST=127.0.0.1      # localhost-only; reach it via SSH tunnel (keeps it private)
# DB_PATH / FIRED_PATH default to ./data/... which is fine.
```

`HOST=127.0.0.1` means the app is reachable only from the VPS itself. You'll open
the UI through an SSH tunnel (Section 8). The `data/` directory is created
automatically on first save.

---

## 6. Create your Discord webhooks (you'll paste these into the UI)

For each channel you want to post to: **Edit Channel (gear) → Integrations →
Webhooks → New Webhook → Copy Webhook URL**. It looks like
`https://discord.com/api/webhooks/123.../AbC...`. Treat each like a password.

You'll add these under each **Guild** in the UI (Section 9). Tip: make a private
`#router-test` channel + webhook for your first test.

---

## 7. (Optional) Create a Telegram bot for the watchlist

1. Message **[@BotFather](https://t.me/BotFather)** → `/newbot` → copy the **token**.
2. Open your new bot and press **Start** (it can't message you until you message it).
3. Get your chat id: `curl "https://api.telegram.org/bot<TOKEN>/getUpdates"` and
   read `"chat":{"id":...}`.

You'll add these as a **Telegram watchlist** entry in the UI.

---

## 8. Run it + open the UI privately

Start it manually first to watch the logs:

```bash
npm start
# -> "Server listening at http://127.0.0.1:3000"
```

From **your local machine**, open an SSH tunnel:

```bash
ssh -L 8080:localhost:3000 boss@<your-server-ip>
```

Leave that open and browse to **http://localhost:8080** on your computer. You'll
see the admin UI.

---

## 9. Configure everything in the UI (first test)

1. **Guilds & webhooks** → *Add guild* → name it, paste its webhook URL. For the
   first test, add one guild pointing at your `#router-test` webhook.
2. **Boss catalog** (optional) → add a boss or two (name + level).
3. **Schedule** → *+ Add timing* (e.g. `12:00`), then *+ Add boss*, pick/enter the
   boss + level, and tick the guild(s) it goes to.
4. **Settings** → reminder lead (e.g. 10 min), send mode (Per-guild).
5. **Watchlist** (optional) → add your Telegram (token + chat id).
6. Click **Save**, then **Announce…** → **Preview** (check the messages) →
   **Confirm & Send**. The message should appear in `#router-test`.

To test a **reminder** quickly: set a timing a few minutes ahead of the current
WIB time (so `spawn − lead` is imminent), Save, and watch the channel — the
scheduler fires it automatically.

Stop the manual run with **Ctrl+C** once it works.

---

## 10. Run it as a service (systemd)

```bash
sudo nano /etc/systemd/system/boss-router.service
```

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

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now boss-router
sudo systemctl status boss-router --no-pager
journalctl -u boss-router -f          # live logs (you'll see "reminder sent" here)
```

Because `HOST=127.0.0.1`, the service stays private — reach the UI via the SSH
tunnel from Section 8 whenever you need to edit the schedule. (If you'd rather have
a private always-on URL, put it behind Tailscale or a VPN instead of opening a
port.)

The `data/` directory (schedule + reminder state) lives under
`/home/boss/boss-router/data` — keep it on the persistent disk and **back up
`data/db.json`**; it's your whole config (and contains secrets).

---

## 11. Updating / redeploying

```bash
cd ~/boss-router
git pull            # or re-run the rsync from Section 4
npm install --include=dev
npm run build
sudo systemctl restart boss-router
journalctl -u boss-router -n 30 --no-pager
```

Your `data/` (schedule, guilds, webhooks) is untouched by redeploys.

---

## 12. Troubleshooting

| Symptom | Fix |
|---|---|
| Build fails: **`tsc: not found`** | Run `npm install --include=dev` (Ubuntu/Node may set `NODE_ENV=production`, which skips the TypeScript build tools). |
| Can't open the UI | With `HOST=127.0.0.1` you must use the SSH tunnel (Section 8). Check `systemctl status boss-router`. |
| **Announce** shows a delivery failure | Bad/rotated webhook URL, or the channel/webhook was deleted. Re-copy it under the guild and try again. The per-destination status shows which failed. |
| No **Telegram** message | Token/chat id wrong, or you never pressed Start on the bot. Test with the `getUpdates` curl in Section 7. |
| **Reminders never fire** | The host must be always-on (not sleeping). Check `journalctl -u boss-router -f` around the fire time. Confirm the timing's `HH:MM` is valid and a few minutes in the future when testing. |
| Lost config after redeploy | `data/` was wiped. Keep `DB_PATH` on a persistent path and don't delete `data/`. Restore `data/db.json` from a backup. |

**Handy commands:**

```bash
sudo systemctl status boss-router --no-pager
journalctl -u boss-router -f
curl http://localhost:3000/healthz
```

---

Keep your webhook URLs, Telegram token, and the `data/` directory private — they
are the keys to posting in your community's channels.
