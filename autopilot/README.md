# 📈 Campaign Shorts Autopilot

A zero-dependency Node service that runs your short-form content operation
24/7: it **researches** what's trending in your niche, has Claude pick one
campaign angle and **write a tight script**, **renders** it into a captioned
1080×1920 short (ffmpeg + TTS), **posts** it to your socials, then
**announces it on Whop** with links to the posts. Repeat every few hours,
forever.

```
research → script → render → post → whop
   │          │        │        │      └─ forum post linking the socials
   │          │        │        └─ YouTube Shorts · IG Reels · TikTok · webhook
   │          │        └─ ffmpeg: TTS voiceover + line-timed captions + bg/music
   │          └─ Claude: hook-first 7-10 line script, caption, hashtags
   └─ Google Trends RSS · niche subreddits · Hacker News (all keyless)
```

## Run it

```sh
node autopilot.js test-render   # proves ffmpeg+TTS work — no API keys needed
node autopilot.js dry-run       # full cycle, skips posting (needs ANTHROPIC_API_KEY)
node autopilot.js once          # one real cycle
node autopilot.js               # the 24/7 loop + status server :3444
```

Deployment to a Hetzner VM (new or existing): [`deploy/hetzner/`](../deploy/hetzner/).
All configuration is env vars — [`.env.example`](.env.example) documents every one.

## Credentials checklist (each unlocks its platform automatically)

| Platform | You need | Where |
|---|---|---|
| Claude (required) | `ANTHROPIC_API_KEY` | console.anthropic.com |
| YouTube Shorts | `YT_CLIENT_ID`/`YT_CLIENT_SECRET`, then `node autopilot.js auth-youtube` once | Google Cloud console → YouTube Data API v3 → OAuth client ("TV and Limited Input devices") |
| Instagram Reels | `IG_USER_ID`, `IG_ACCESS_TOKEN`, `AUTOPILOT_PUBLIC_BASE` | Meta app + IG professional account (instagram_content_publish) |
| TikTok | `TIKTOK_CLIENT_KEY`/`SECRET`/`REFRESH_TOKEN` | developers.tiktok.com (Content Posting API; posts stay private until the app passes audit) |
| Anything else | `WEBHOOK_URL` | a Zapier/Make/n8n catch-hook — every short is POSTed there as JSON with `video_url` + copy |
| Whop | `WHOP_API_KEY`, `WHOP_EXPERIENCE_ID` | whop.com dashboard → Developer |

**Fastest path to fully live:** set only `ANTHROPIC_API_KEY`, `WEBHOOK_URL`
(Zapier zap → your socials) and the two Whop vars. Native platform APIs can be
added one at a time later — nothing else changes.

## Design notes

- **Zero npm deps** — like the rest of this repo. System deps: node ≥ 16,
  ffmpeg, espeak-ng (or [Piper](https://github.com/rhasspy/piper) for natural
  voices via `PIPER_BIN`/`PIPER_VOICE`).
- **State** lives in one dir (`AUTOPILOT_DATA`, VM default `/var/lib/autopilot`):
  `journal.jsonl` (every run + where it posted), `kv.json` (OAuth token cache),
  `out/` (rendered videos, pruned to `KEEP_VIDEOS`). Back up that dir, nothing else.
- **Never repeats itself** — recent topics from the journal are fed back into
  research so campaigns stay fresh.
- **Fails soft** — a platform erroring doesn't stop the others; errors land in
  the journal and `/status`. A failed cycle just waits for the next tick.
- **Brand safety** — research + scripting prompts require honest, safe claims;
  you own what gets published, so spot-check `/status` and your channels.
- Captions are burned in (ASS subtitles) and timed per line from the measured
  TTS durations — no speech-recognition step needed.
