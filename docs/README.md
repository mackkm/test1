# 🦞 PocketClaw

An OpenClaw-style personal AI assistant that runs on your phone, with **your own Claude
API key plugged in**. It's a pure client-side Progressive Web App (PWA): no server, no
build step — your key stays in your browser and requests go directly from your phone
to `api.anthropic.com`.

## Features

- 📱 Mobile-first chat UI, installable to your home screen like a native app
- 🔑 Bring your own Anthropic API key (stored only in your browser's localStorage)
- ⚡ Streaming responses with live "thinking" summaries (adaptive thinking)
- 🤖 Model picker with live model list from the API (Opus 4.8, Fable 5, Sonnet 5, Haiku 4.5, …)
- 🎭 Customizable assistant persona (system prompt) and effort level
- 💬 Multiple conversations, saved locally on your device
- 📴 App shell works offline (chatting needs a connection, of course)

## Get it on your phone

The app must be served over **HTTPS** (a requirement for PWAs). The easiest free option
is GitHub Pages:

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
| `index.html` / `styles.css` / `app.js` | The whole app — UI, storage, Claude streaming client |
| `manifest.webmanifest` + `icons/` | PWA install metadata |
| `sw.js` | Service worker (offline app shell caching) |
