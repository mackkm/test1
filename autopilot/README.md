# 📈 Campaign Shorts Autopilot

A zero-dependency Node service that runs a short-form content operation 24/7.
Its primary mode earns from **[Whop Content Rewards](https://whop.com/discover/content-rewards/)**
— campaigns that pay a fixed reward per 1,000 views on submitted clips
(typically $0.50–$1.50/1k, up to $6/1k):

```
scan campaigns → pick one → script → render → post → submit clip → get paid
      │             │          │        │       │         └─ POST /bounty_submissions
      │             │          │        │       └─ YouTube Shorts · IG Reels · TikTok · webhook
      │             │          │        └─ ffmpeg: TTS voiceover + line-timed captions
      │             │          └─ Claude: compliant hook-first script + caption + required tags
      │             └─ Claude rejects campaigns an original AI short can't satisfy
      └─ GET /bounties?status=open  (Whop's Content Rewards API)
```

Each cycle it lists open campaigns, has Claude choose one that's genuinely
satisfiable with an **original** short (clipping campaigns that require the
brand's source footage are skipped), renders a compliant video, posts it, and
submits the permalink to the campaign. Approvals/denials are checked on later
cycles and journaled — denial reasons feed back into future picks. Payouts
land on your Whop balance (set up your payout method on whop.com first).

**Niche mode** (`AUTOPILOT_MODE=niche`, or automatic fallback when no campaign
fits) grows your own audience instead: keyless trend research (Google Trends,
your subreddits, Hacker News) → trend-reactive shorts for your `NICHE`/`OFFER`,
optionally announced to your own Whop community.

## Run it

```sh
node autopilot.js test-render   # proves ffmpeg+TTS work — no API keys needed
node autopilot.js verify        # checks every configured credential against its live API
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
| Whop Content Rewards + payouts | `WHOP_API_KEY` (payout method configured on your Whop account) | whop.com dashboard → Developer |
| Whop community announcements (optional) | `WHOP_EXPERIENCE_ID` (+ `WHOP_COMPANY_ID` if `public`) | your community's forum experience |

**Fastest path to earning:** `ANTHROPIC_API_KEY` + `WHOP_API_KEY` + YouTube
(three vars + one device-code login) = full loop: campaign → short → posted →
submitted → paid per 1k views. Rewards mode needs YouTube or Instagram enabled
because campaign submissions require a public permalink; TikTok's API doesn't
return one.

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
