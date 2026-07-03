# 🦞 Run PocketClaw in the cloud (no computer needed)

Run the PocketClaw gateway on an always-on VM so your phone can use the full
Claude Code agent (tools, loops, subagents) 24/7. Your Anthropic API key is
**not** stored on the VM — the app forwards it with each request.

## Option A — Google Cloud VM (free tier, works from your phone)

You can do this entirely from your phone's browser:

1. Open **[shell.cloud.google.com](https://shell.cloud.google.com)** and sign in
   (create a GCP project first at console.cloud.google.com if you don't have one).
2. Run:
   ```sh
   git clone https://github.com/mackkm/test1.git && cd test1/deploy/gcp
   terraform init
   terraform apply -var project=YOUR_PROJECT_ID -var pocketclaw_token=PICK_A_PASSWORD
   ```
3. Type `yes` when asked. After ~1 minute it prints `pocketclaw_url` —
   give the VM another ~2 minutes to finish installing, then open that URL on
   your phone and **Add to Home Screen**.
4. In the app: ⚙ Settings → the CLI backend is auto-selected → enter the
   **Gateway token** you picked → paste your **Anthropic API key** → Save.

The `e2-micro` machine in `us-central1` is inside GCP's Always Free tier.
Tear it down anytime with `terraform destroy`.

## Option B — Any Debian/Ubuntu VPS (DigitalOcean, Hetzner, Oracle Free, …)

SSH in and run:

```sh
curl -fsSL https://raw.githubusercontent.com/mackkm/test1/master/deploy/setup.sh | sudo bash
```

It prints the URL + gateway password when done. Open the VM's firewall for
TCP 3333 if your provider blocks it by default.

## Option C — Docker (Fly.io, Railway, your NAS…)

```sh
docker build -t pocketclaw -f deploy/Dockerfile .
docker run -d -p 3333:3333 -e POCKETCLAW_TOKEN=pick-a-password pocketclaw
```

## Security notes

- **Always set `POCKETCLAW_TOKEN`** on an internet-reachable gateway — it's the
  only thing between the internet and an agent with a shell.
- Traffic is plain HTTP by default. Fine for casual use; for real privacy put
  the gateway on [Tailscale](https://tailscale.com) (free) and use the
  Tailscale IP instead of the public one, or front it with Caddy for HTTPS.
- Your Anthropic API key is sent from the app to *your* gateway with each
  request and held in the gateway's memory only — never written to disk.
- The agent works inside `/opt/pocketclaw-workspace` on the VM. Grant it more
  tool power via `CLAUDE_ARGS` in `/etc/pocketclaw.env` (e.g.
  `CLAUDE_ARGS=--permission-mode acceptEdits`), then `sudo systemctl restart pocketclaw`.
- Add Tandem/Firecrawl on the VM the same way: `TANDEM_MCP=…`,
  `FIRECRAWL_API_KEY=…` in `/etc/pocketclaw.env`.
