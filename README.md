# 🦞 PocketClaw

An OpenClaw-style personal AI assistant that runs on your phone, with **Claude
plugged in**. It's a mobile-first PWA you install to your home screen, plus a
tiny zero-dependency gateway that lets your phone drive a full Claude Code agent
on your own machine.

Two ways to run it:

1. **Claude API (direct)** — pure client-side PWA. Paste your Anthropic API key;
   it stays in your browser and requests go straight to `api.anthropic.com`.
2. **Claude Code CLI (gateway)** — run `node server/server.js` on your computer
   (or a VM). Your phone then drives a real Claude Code agent there — tools, file
   access, browser control, scheduled loops — exactly how OpenClaw works.

## Highlights

- 📱 Installable, offline-capable, futuristic glass UI
- 🔁 **Loops** — recurring prompts on a schedule (run on the gateway even while
  the app is closed; each loop remembers its previous runs)
- ⚡ **Skills** + 🧠 **self-learning memory** that persists across chats
- 🔍 Web search, 🔥 Firecrawl scraping, 🌐 Tandem browser control, 📷 vision
- 🤝 Subagents + delegation, adjustable effort, and one-tap **Overdrive**

## Quick start

**On your computer (CLI gateway):**

```sh
node server/server.js
# 🦞 PocketClaw gateway — app + API at http://localhost:3333
```

Then open `http://<your-computer's-IP>:3333` on your phone (same Wi-Fi). If the
gateway is reachable beyond your LAN, **set `POCKETCLAW_TOKEN`** first — the
server refuses to start on a public interface without one.

**API mode (no computer):** host the `docs/` folder on any HTTPS static host
(GitHub Pages, Netlify, Cloudflare Pages, Vercel), open it on your phone, add to
home screen, and paste your Anthropic API key in Settings.

**Cloud VM (24/7, phone-only):** see [`deploy/`](deploy/) for a one-command
Google Cloud deployment (`deploy/gcp/`) and a container image (`deploy/Dockerfile`).

## Documentation

- **[`docs/README.md`](docs/README.md)** — full feature list, gateway
  configuration (all environment variables), install steps, and security notes.
- **[`deploy/README.md`](deploy/README.md)** — running the gateway on a VM.
- **[`skills/pocketclaw/`](skills/pocketclaw/)** — PocketClaw packaged as a
  reusable Claude Agent Skill (drop into `.claude/skills/`, the Agent SDK, or
  claude.ai).

## Repository layout

| Path | Purpose |
|---|---|
| `docs/` | The PWA — UI, storage, and Claude streaming clients (API + gateway). Also the static web root. |
| `server/server.js` | The PocketClaw gateway — runs Claude Code CLI and streams to the app. |
| `deploy/` | Container + cloud VM deployment for the gateway (`deploy/hetzner/` deploys the autopilot). |
| `skills/pocketclaw/` | PocketClaw as an exportable Claude Agent Skill. |
| `autopilot/` | **Campaign Shorts Autopilot** — 24/7 trend research → Claude script → ffmpeg short → posts to YouTube/IG/TikTok/webhook, then announces on Whop. See [`autopilot/README.md`](autopilot/README.md). |

## Security

The gateway drives an agentic Claude Code process, so treat it like a shell:

- It won't boot unauthenticated on a public interface — set `POCKETCLAW_TOKEN`
  (or bind to loopback / opt in with `POCKETCLAW_ALLOW_OPEN=1` behind your own auth).
- Prefer a VPN/Tailscale or an HTTPS reverse proxy over plain HTTP; your gateway
  token and forwarded API key otherwise cross the network in cleartext.
- The cloud deploy runs the agent as a non-root user, keeps the token in Secret
  Manager (not VM metadata), and blocks the agent from the metadata endpoint.

See [`docs/README.md`](docs/README.md#security-notes) for the full rundown.
