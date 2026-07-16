# DEPLOY-RENDER.md — not recommended for this app

**Render (and other serverless / free-tier hosts) are not a good fit anymore.**
The app changed to a scheduler-driven, private tool, and two hard requirements
rule them out:

1. **It must be always-on.** Reminders fire from an in-process scheduler. Render's
   free tier **sleeps when idle**, so reminders would silently not fire at the
   right time. (A "keep-awake" pinger is fragile and still won't survive the
   ephemeral filesystem.)

2. **It must be private.** There is **no auth** — anyone who can open the page can
   edit the schedule and post to your Discord channels. A public Render URL would
   expose exactly that.

3. **It needs a persistent disk.** The schedule, webhooks and reminder state live
   in `data/*.json`. Render's filesystem is **ephemeral** — a redeploy wipes it.

## Use a private, always-on VPS instead

Follow **[SETUP.md](./SETUP.md)**. It deploys on a small always-on VPS, keeps the
app private (bound to localhost + reached over an SSH tunnel, or via a VPN /
Tailscale), and stores `data/` on a persistent disk so your schedule and reminders
survive restarts.

If you really want a managed host, pick one that is **always-on**, gives a
**persistent disk**, and can stay **private** (not a public URL) — but a small VPS
is simpler and cheaper for this.
