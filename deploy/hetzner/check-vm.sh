#!/usr/bin/env bash
# check-vm.sh — health check for the Campaign Shorts Autopilot VM.
#
# Answers, in one command: is the box up, is the service running, is it
# configured, is it actually producing shorts, and is it getting paid?
#
#   On the VM:            ./check-vm.sh
#   From your machine:    HCLOUD_TOKEN=... ./check-vm.sh --remote shorts-autopilot
#                         ./check-vm.sh --remote 1.2.3.4          (skips the API part)
#
# --remote pipes this same script over SSH and runs the on-box checks there,
# and additionally queries the Hetzner Cloud API when HCLOUD_TOKEN is set.
#
# Never prints secret values — only whether each key is present.
# Exit code: 0 healthy, 1 degraded//misconfigured, 2 unreachable.
#
# Paths are overridable so the checker can be exercised against a test rig:
#   APP_DIR (/opt/autopilot) DATA_DIR (/var/lib/autopilot)
#   ENV_FILE (/etc/autopilot.env) STATUS_URL (http://127.0.0.1:3444/status)

set -uo pipefail

APP_DIR="${APP_DIR:-/opt/autopilot}"
DATA_DIR="${DATA_DIR:-/var/lib/autopilot}"
ENV_FILE="${ENV_FILE:-/etc/autopilot.env}"
STATUS_URL="${STATUS_URL:-http://127.0.0.1:3444/status}"
SERVICE="${SERVICE:-autopilot}"

PROBLEMS=0
WARNINGS=0
ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; WARNINGS=$((WARNINGS+1)); }
bad()  { printf '  \033[31m✖\033[0m %s\n' "$*"; PROBLEMS=$((PROBLEMS+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,19p' "$0" | sed 's/^#\{1,\} \{0,1\}//'
  exit 0
fi

# ---------------------------------------------------------------- remote mode
if [ "${1:-}" = "--remote" ]; then
  TARGET="${2:?usage: check-vm.sh --remote NAME_OR_IP}"
  IP="$TARGET"

  if [ -n "${HCLOUD_TOKEN:-}" ] && ! [[ "$TARGET" =~ ^[0-9.]+$ ]]; then
    head_ "Hetzner Cloud API"
    RESP=$(curl -fsS --max-time 20 -H "Authorization: Bearer $HCLOUD_TOKEN" \
             "https://api.hetzner.cloud/v1/servers?name=$TARGET" 2>&1)
    if [ $? -ne 0 ]; then
      bad "cannot reach api.hetzner.cloud (network/policy blocked, or token rejected)"
      echo "      $RESP" | head -2
    else
      eval "$(printf '%s' "$RESP" | node -e '
        const d=JSON.parse(require("fs").readFileSync(0,"utf8"));
        const s=(d.servers||[])[0];
        if(!s){console.log("FOUND=0");process.exit(0)}
        const q=v=>`"${String(v??"").replace(/"/g,"")}"`;
        console.log(`FOUND=1 STATUS=${q(s.status)} IP=${q(s.public_net?.ipv4?.ip)} TYPE=${q(s.server_type?.name)} LOC=${q(s.datacenter?.location?.name)} CREATED=${q(s.created)} LOCKED=${q(s.locked)}`);
      ' 2>/dev/null)"
      if [ "${FOUND:-0}" = "1" ]; then
        [ "$STATUS" = "running" ] && ok "server '$TARGET' is $STATUS ($TYPE, $LOC, $IP)" \
                                  || bad "server '$TARGET' is $STATUS (expected running)"
        [ "${LOCKED:-false}" = "true" ] && warn "server is locked (an action is in progress)"
        echo "      created $CREATED"
      else
        bad "no server named '$TARGET' in this Hetzner project"
        IP=""
      fi
    fi
  elif [ -n "${HCLOUD_TOKEN:-}" ]; then
    head_ "Hetzner Cloud API"; warn "target looks like an IP — skipping API lookup"
  else
    head_ "Hetzner Cloud API"; warn "HCLOUD_TOKEN not set — skipping API lookup"
  fi

  [ -z "$IP" ] && { printf '\n\033[31mUNREACHABLE\033[0m — no IP to connect to\n'; exit 2; }

  head_ "SSH to $IP"
  SSHO="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o BatchMode=yes"
  if ! ssh $SSHO ${SSH_KEY:+-i "$SSH_KEY"} "root@$IP" true 2>/dev/null; then
    bad "cannot SSH to root@$IP (key not loaded, or the box is down)"
    printf '\n\033[31mUNREACHABLE\033[0m\n'; exit 2
  fi
  ok "SSH works"
  echo "  --- running on-box checks over SSH ---"
  ssh $SSHO ${SSH_KEY:+-i "$SSH_KEY"} "root@$IP" 'bash -s' < "$0"
  exit $?
fi

# ---------------------------------------------------------------- local mode
printf '\033[1mAutopilot VM health check\033[0m — %s on %s\n' "$(date -u '+%Y-%m-%d %H:%M UTC')" "$(hostname 2>/dev/null || echo host)"

head_ "Install"
if [ -f "$APP_DIR/autopilot/autopilot.js" ]; then ok "code present at $APP_DIR"
else bad "autopilot.js not found under $APP_DIR — bootstrap.sh has not run (or failed)"; fi
for bin in node ffmpeg ffprobe; do
  if have "$bin"; then
    case "$bin" in
      node) VER=$(node -v 2>&1) ;;                    # node wants -v, not -version
      *)    VER=$($bin -version 2>&1 | head -1 | cut -c1-40) ;;
    esac
    ok "$bin $VER"
  else bad "$bin is missing — renders cannot run"; fi
done
if [ -x /opt/piper/piper ]; then ok "piper installed (natural voice)"
elif have espeak-ng; then warn "only espeak-ng (robotic voice hurts campaign approvals — run install-piper.sh)"
else bad "no TTS engine — renders cannot run"; fi

head_ "Configuration ($ENV_FILE)"
if [ ! -f "$ENV_FILE" ]; then
  bad "$ENV_FILE missing — the service will idle unconfigured"
else
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE" 2>/dev/null; set +a
  [ -n "${ANTHROPIC_API_KEY:-}" ] && ok "ANTHROPIC_API_KEY set (research + scripting)" \
                                  || bad "ANTHROPIC_API_KEY missing — the loop stays paused"
  [ -n "${WHOP_API_KEY:-}" ] && ok "WHOP_API_KEY set (Content Rewards: campaigns + payouts)" \
                             || warn "WHOP_API_KEY missing — no earning, niche mode only"
  SOCIALS=""
  [ -n "${YT_CLIENT_ID:-}" ] && SOCIALS="$SOCIALS youtube"
  [ -n "${IG_USER_ID:-}" ] && SOCIALS="$SOCIALS instagram"
  [ -n "${TIKTOK_CLIENT_KEY:-}" ] && SOCIALS="$SOCIALS tiktok"
  [ -n "${WEBHOOK_URL:-}" ] && SOCIALS="$SOCIALS webhook"
  [ -n "$SOCIALS" ] && ok "posting targets:$SOCIALS" || bad "no posting platform configured — nothing gets published"
  case "$SOCIALS" in
    *youtube*|*instagram*) : ;;
    *) [ -n "${WHOP_API_KEY:-}" ] && warn "rewards mode needs a permalink: enable YouTube or Instagram, or submissions cannot be made" ;;
  esac
  [ -n "${IG_USER_ID:-}" ] && [ -z "${AUTOPILOT_PUBLIC_BASE:-}" ] && \
    bad "Instagram is on but AUTOPILOT_PUBLIC_BASE is unset — IG cannot fetch the video"
  echo "      mode=${AUTOPILOT_MODE:-auto} posts_per_day=${POSTS_PER_DAY:-3}"
  # token cache (YouTube device auth) lives in the data dir, not the env file
  if [ -f "$DATA_DIR/kv.json" ] && grep -q yt_refresh_token "$DATA_DIR/kv.json" 2>/dev/null; then
    ok "YouTube authorized (refresh token cached)"
  elif [ -n "${YT_CLIENT_ID:-}" ]; then
    bad "YouTube configured but never authorized — run: node autopilot.js auth-youtube"
  fi
fi

head_ "Service"
# Is something actually serving? Decides whether a missing systemd unit is a
# real fault or just a container/Docker deployment (both are supported).
SERVING=0
curl -fsS --max-time 8 "$STATUS_URL" >/dev/null 2>&1 && SERVING=1
if have systemctl; then
  STATE=$(systemctl is-active "$SERVICE" 2>/dev/null)
  [ -z "$STATE" ] && STATE="not-installed"
  if [ "$STATE" = "active" ]; then
    ok "$SERVICE is active — $(systemctl show -p ActiveEnterTimestamp --value "$SERVICE" 2>/dev/null)"
    NRESTARTS=$(systemctl show -p NRestarts --value "$SERVICE" 2>/dev/null || echo 0)
    [ "${NRESTARTS:-0}" -gt 3 ] && warn "$NRESTARTS restarts — check: journalctl -u $SERVICE"
  elif [ "$SERVING" = "1" ]; then
    ok "running without a systemd unit (container/manual deployment) — endpoint is live"
  else
    bad "$SERVICE is $STATE and nothing is serving — start it: systemctl restart $SERVICE"
  fi
elif [ "$SERVING" = "1" ]; then
  ok "no systemd here, but the autopilot is serving (container deployment)"
else
  bad "no systemd and nothing serving — the autopilot is not running"
fi

head_ "Live status ($STATUS_URL)"
SJSON=$(curl -fsS --max-time 8 "$STATUS_URL" 2>/dev/null)
if [ -z "$SJSON" ]; then
  bad "status endpoint not answering — the process is not serving"
else
  printf '%s' "$SJSON" | node -e '
    const s=JSON.parse(require("fs").readFileSync(0,"utf8"));
    const g="  \x1b[32m✔\x1b[0m ", w="  \x1b[33m!\x1b[0m ";
    console.log(`${s.configured?g:w}mode=${s.mode} configured=${s.configured}`);
    console.log(`      platforms: socials=[${(s.platforms?.socials||[]).join(", ")||"none"}] whop_forum=${s.platforms?.whop}`);
    console.log(`      runs=${s.runs} failures=${s.failures} running=${s.running}`);
    if(s.nextRunAt) console.log(`      next cycle: ${s.nextRunAt}`);
    if(s.lastRun) console.log(`      last run: ${s.lastRun.ok?"ok":"FAILED"} ${s.lastRun.topic||s.lastRun.error||""}`);
    process.exit(s.configured?0:1);
  ' || warn "service is up but not configured — it renders nothing until keys are set"
fi

head_ "Output + earnings (journal)"
if [ ! -f "$DATA_DIR/journal.jsonl" ]; then
  warn "no journal yet — no cycle has completed"
else
  node -e '
    const fs=require("fs");
    const rows=fs.readFileSync(process.argv[1],"utf8").trim().split("\n")
      .map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
    const runs=rows.filter(r=>r.video);
    const errs=rows.filter(r=>r.error);
    const subs=rows.filter(r=>r.submission&&r.submission.id);
    const subErr=rows.filter(r=>r.submission&&r.submission.error);
    const res=rows.flatMap(r=>r.resolutions||[]);
    const approved=res.filter(r=>r.status==="approved").length;
    const denied=res.filter(r=>r.status==="denied");
    const g="  \x1b[32m✔\x1b[0m ", w="  \x1b[33m!\x1b[0m ", b="  \x1b[31m✖\x1b[0m ";
    console.log(`${runs.length?g:w}${runs.length} shorts rendered, ${errs.length} failed cycles`);
    if(runs.length){
      const last=runs[runs.length-1];
      console.log(`      latest: "${last.title||last.topic}" (${last.duration}s) at ${last.ts}`);
      const age=(Date.now()-new Date(last.ts))/36e5;
      if(age>26) console.log(`${w}last short was ${age.toFixed(0)}h ago — the loop may be stuck`);
    }
    console.log(`${subs.length?g:w}${subs.length} campaign submissions${subErr.length?`, ${subErr.length} could not be submitted`:""}`);
    if(approved||denied.length){
      console.log(`      resolved: ${approved} approved, ${denied.length} denied`);
      for(const d of denied.slice(-3)) console.log(`        denied: ${d.denial_reason||"no reason given"}`);
    } else if(subs.length) console.log("      none resolved yet (owners approve manually)");
    const perPlatform={};
    for(const r of rows) for(const p of r.posts||[]) perPlatform[p.platform]=(perPlatform[p.platform]||0)+1;
    if(Object.keys(perPlatform).length) console.log(`      posted: ${Object.entries(perPlatform).map(([k,v])=>`${k}=${v}`).join(" ")}`);
    const perErr={};
    for(const r of rows) for(const e of r.postErrors||[]) perErr[e.platform]=(perErr[e.platform]||0)+1;
    if(Object.keys(perErr).length) console.log(`${b}post failures: ${Object.entries(perErr).map(([k,v])=>`${k}=${v}`).join(" ")}`);
    for(const e of errs.slice(-3)) console.log(`      recent error: ${e.error}`);
    // 2 = something is failing, 1 = worth a look, 0 = clean (feeds the verdict)
    const stale = runs.length && (Date.now()-new Date(runs[runs.length-1].ts))/36e5 > 26;
    const failingHard = errs.length && errs.length >= runs.length;
    if(failingHard) console.log(`${b}failing as often as succeeding (${errs.length} failed vs ${runs.length} rendered) — see the errors above`);
    if(stale) console.log(`${w}no new short in over a day — the loop may be stuck`);
    if(Object.keys(perErr).length || failingHard) process.exit(2);
    if(stale || denied.length || subErr.length || errs.length) process.exit(1);
    process.exit(0);
  ' "$DATA_DIR/journal.jsonl" 2>/dev/null
  case $? in
    1) WARNINGS=$((WARNINGS+1)) ;;
    2) PROBLEMS=$((PROBLEMS+1)) ;;
  esac
fi

head_ "Resources"
if have df; then
  USE=$(df -P "$DATA_DIR" 2>/dev/null | awk 'NR==2{print $5}' | tr -d '%')
  AVAIL=$(df -Ph "$DATA_DIR" 2>/dev/null | awk 'NR==2{print $4}')
  if [ -n "$USE" ]; then
    [ "$USE" -ge 90 ] && bad "disk ${USE}% full (${AVAIL} free) — renders will fail" || ok "disk ${USE}% used, ${AVAIL} free"
  fi
fi
if [ -r /proc/meminfo ]; then
  MEMAV=$(awk '/MemAvailable/{printf "%d", $2/1024}' /proc/meminfo)
  [ "${MEMAV:-9999}" -lt 300 ] && warn "only ${MEMAV}MB RAM available — ffmpeg may be OOM-killed" || ok "${MEMAV}MB RAM available"
fi
VIDS=$(ls -1 "$DATA_DIR/out"/*.mp4 2>/dev/null | wc -l | tr -d ' ')
[ "${VIDS:-0}" -gt 0 ] && echo "      $VIDS rendered videos retained in $DATA_DIR/out"

# ------------------------------------------------------------------- verdict
echo
if [ "$PROBLEMS" -gt 0 ]; then
  printf '\033[31mDEGRADED\033[0m — %d problem(s), %d warning(s). Fix the ✖ items above, then: systemctl restart %s\n' "$PROBLEMS" "$WARNINGS" "$SERVICE"
  exit 1
elif [ "$WARNINGS" -gt 0 ]; then
  printf '\033[33mOK with warnings\033[0m — %d warning(s) above.\n' "$WARNINGS"
  exit 0
else
  printf '\033[32mHEALTHY\033[0m — the autopilot is configured, running, and producing.\n'
  exit 0
fi
