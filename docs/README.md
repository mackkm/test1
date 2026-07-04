# 🦞 PocketClaw

An OpenClaw-style personal AI assistant that runs on your phone, with **Claude plugged
in** — two ways:

1. **Claude API (direct)** — pure client-side PWA. Paste your Anthropic API key; it
   stays in your browser and requests go straight from your phone to `api.anthropic.com`.
2. **Claude Code CLI (gateway)** — run the tiny PocketClaw gateway
   (`node server/server.js`) on your computer. Your phone then drives a full
   **Claude Code agent** running there — with tools, file access, and everything the
   CLI can do — exactly how OpenClaw works.

## Features

- 📱 Mobile-first, futuristic glass-and-glow UI, installable to your home screen
- 🔑 Bring your own Anthropic API key **or** point it at your Claude Code CLI
- 🔁 **Loops** — recurring prompts on a schedule (morning briefing, repo health check,
  news watch…). With the CLI gateway they run on your computer **even while the app is
  closed**, and each loop keeps its own memory of previous runs
- ⚡ **Skills** — toggleable instruction packs that shape behavior (Straight shooter,
  Coach mode, Devil's advocate, …) plus your own custom skills
- 🧠 **Self-learning** — PocketClaw quietly learns durable facts about you
  (preferences, projects, people) and uses them in every chat. Fully viewable,
  editable, and erasable in Settings
- 🔍 **Web search** — current information with live "Searching: …" activity (API mode)
- 🔥 **Firecrawl** (firecrawl.dev) — scrape, search, and interact with web pages in
  both modes (API mode via the MCP connector; CLI mode via the gateway)
- 🌐 **Tandem Browser** (tandembrowser.org) — in CLI mode the agent can drive a real
  browser on your computer: open tabs, click, fill forms, take screenshots
- 📷 **Vision** — attach photos from your camera or gallery in both modes
- 🤖 In CLI mode: a real agent — tool use shown live ("agent activity"), per-conversation
  session resume, persona + skills + memory forwarded via `--append-system-prompt`
- 🏷️ Conversations auto-title themselves (a tiny Haiku call, when an API key is set)
- ⚡ Streaming responses with live "thinking" summaries (adaptive thinking)
- 🧠 Model picker with live model list from the API (Opus 4.8, Fable 5, Sonnet 5, Haiku 4.5, …)
- 🎭 Customizable persona and effort level (low → max); big shuffled prompt library
- ✨ **Skill suggestions** — PocketClaw can invent new skills tailored to how you
  actually use it (from your memory + recent chats)
- 🎤 Voice dictation (Web Speech API), ↗ native share on replies, haptic feedback
- 💬 Multiple conversations saved locally; copy buttons; markdown tables
- 📴 App shell works offline (chatting needs a connection, of course)

## Run the Claude Code CLI gateway

On the computer where [Claude Code](https://claude.com/claude-code) is installed and
logged in:

```sh
node server/server.js
# 🦞 PocketClaw gateway
#    app + API:  http://localhost:3333
```

Then on your phone (same Wi-Fi), open `http://<your-computer's-IP>:3333` — the gateway
serves the app itself, and new installs default straight to the CLI backend. Send a
message and Claude Code runs on your computer while the reply streams to your phone.

Configuration (environment variables):

| Variable | Meaning | Default |
|---|---|---|
| `PORT` / `HOST` | Where to listen | `3333` / `0.0.0.0` |
| `POCKETCLAW_TOKEN` | Shared secret clients must present. **Required** to expose the gateway beyond loopback — without it the server refuses a non-loopback bind (override with `POCKETCLAW_ALLOW_OPEN=1`) | *(none — loopback only)* |
| `POCKETCLAW_WORKSPACE` | Directory the agent works in | current dir |
| `CLAUDE_BIN` | Path to the `claude` binary | `claude` |
| `CLAUDE_ARGS` | Extra CLI args, e.g. `--permission-mode acceptEdits` or `--allowedTools Read,Grep,WebSearch` | *(none)* |
| `TANDEM_MCP` | Connect a [Tandem Browser](https://tandembrowser.org): a streamable-http URL like `http://localhost:5173/mcp`, or a local path to Tandem's MCP `server.js` | *(off)* |
| `TANDEM_MCP_TOKEN` | Bearer token for remote Tandem connections (e.g. over Tailscale) | *(none)* |
| `FIRECRAWL_API_KEY` | Enable [Firecrawl](https://firecrawl.dev) web tools (search/scrape/interact) | *(off)* |
| `FIRECRAWL_MCP` | Override the Firecrawl MCP URL; set `https://mcp.firecrawl.dev/v2/mcp` for the keyless rate-limited tier | *(auto)* |

Example with everything on:

```sh
TANDEM_MCP="http://localhost:5173/mcp" \
FIRECRAWL_API_KEY="fc-..." \
POCKETCLAW_TOKEN="something-secret" \
node server/server.js
```

Notes:
- By default headless Claude Code can only use tools that don't need permission
  prompts; grant more with `CLAUDE_ARGS` (understand the risk before using
  `--dangerously-skip-permissions`).
- For access from anywhere (not just your Wi-Fi), put the gateway on a
  [Tailscale](https://tailscale.com) network or behind an HTTPS reverse proxy, and set
  `POCKETCLAW_TOKEN`.

## Get it on your phone (API mode, no computer needed)

For API mode the app must be served over **HTTPS** (a requirement for PWAs). The
easiest free option is GitHub Pages:

1. Merge this branch, then in the GitHub repo go to **Settings → Pages**.
2. Under *Build and deployment*, choose **Deploy from a branch**, select your default
   branch and the **`/docs`** folder, and save.
3. After a minute, open `https://<your-username>.github.io/<repo>/` on your phone.
4. In your browser menu choose **Add to Home Screen** (Android/Chrome) or
   **Share → Add to Home Screen** (iOS/Safari).
5. Open the app, tap **⚙**, paste your Anthropic API key from
   [platform.claude.com](https://platform.claude.com), and chat.

Any other static host (Netlify, Cloudflare Pages, Vercel) works the same way — just
point it at the `docs/` folder.

### Run locally

```sh
cd docs
python3 -m http.server 8080
# open http://localhost:8080
```

## Security notes

- Your API key is stored in `localStorage` on your device only and is sent exclusively
  to `api.anthropic.com` (the app uses the `anthropic-dangerous-direct-browser-access`
  header, which Anthropic provides for exactly this bring-your-own-key pattern).
- Don't enter your key on a device or browser profile you don't trust.
- Consider creating a dedicated API key with a spend limit for this app.

## Files

| File | Purpose |
|---|---|
| `index.html` / `styles.css` / `app.js` | The whole app — UI, storage, Claude streaming clients (API + gateway) |
| `manifest.webmanifest` + `icons/` | PWA install metadata |
| `sw.js` | Service worker (offline app shell caching) |
| `../server/server.js` | PocketClaw gateway — runs Claude Code CLI and streams to the app |
