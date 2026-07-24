# 🚀 Run the Campaign Shorts Autopilot on Hetzner

Two ways in — both end with the same systemd service (`autopilot`) running
24/7 on your VM.

## A. You already have a Hetzner VM

From your machine (or any shell that can reach the VM):

```sh
ssh root@YOUR_VM_IP 'bash -s' < deploy/hetzner/bootstrap.sh
```

Re-running it later upgrades the code in place. It installs node/ffmpeg/TTS,
clones this repo to `/opt/autopilot`, seeds `/etc/autopilot.env`, and starts
the service (paused until you add keys).

## B. Create a fresh VM with the Hetzner API

```sh
export HCLOUD_TOKEN=...        # Hetzner console → project → Security → API tokens (Read & Write)
./deploy/hetzner/provision.sh create
```

Defaults: `cpx21` (3 vCPU / 4 GB, ~€8/mo — comfortable for several renders a
day) in `fsn1`, Ubuntu 24.04. Override with `NAME= TYPE= LOCATION=` env vars.
`provision.sh list` and `provision.sh delete NAME` manage what you've made.

## Configure once, runs forever

```sh
ssh root@YOUR_VM_IP
nano /etc/autopilot.env        # see autopilot/.env.example for every option
systemctl restart autopilot
journalctl -fu autopilot       # watch cycles: research → script → render → post
```

Minimum config: `ANTHROPIC_API_KEY` + your `NICHE`/`AUDIENCE`/`OFFER`.
Each platform switches on when its keys appear (YouTube, Instagram, TikTok,
generic webhook, Whop) — the checklist for getting each credential is in
[`autopilot/README.md`](../../autopilot/README.md).

One-time YouTube authorization (device flow — no browser needed on the VM):

```sh
cd /opt/autopilot/autopilot && sudo -u autopilot node autopilot.js auth-youtube
```

## Operating it

| What | How |
|---|---|
| Live status + recent runs | `curl http://VM_IP:3444/status` |
| Logs | `journalctl -fu autopilot` |
| Post right now | `cd /opt/autopilot/autopilot && sudo -u autopilot node autopilot.js once` |
| Rehearse without posting | `… autopilot.js dry-run` |
| Change cadence | `POSTS_PER_DAY=…` in `/etc/autopilot.env`, restart |
| Upgrade code | re-run bootstrap.sh |

Rendered videos are kept in `/var/lib/autopilot/out` (newest 50) and served at
`http://VM_IP:3444/media/<file>` — that URL is what Instagram ingests, so set
`AUTOPILOT_PUBLIC_BASE=http://VM_IP:3444` when using IG.

## Notes

- **Voice**: bootstrap installs [Piper](https://github.com/rhasspy/piper)
  (natural neural TTS) automatically and points the autopilot at it; espeak-ng
  is only the fallback if that download fails. Swap voices with
  `PIPER_VOICE_NAME=en-us-ryan-high deploy/hetzner/install-piper.sh`.
- **Backgrounds/music**: drop your own clips into
  `/opt/autopilot/autopilot/assets/backgrounds` and `…/assets/music`; the
  renderer rotates through them (only use media you have rights to).
- **Firewall**: only port 3444 (status/media) and ssh need to be reachable. If
  you use a Hetzner firewall, allow TCP 22 + 3444.
