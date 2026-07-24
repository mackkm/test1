#!/usr/bin/env bash
# One-command go-live for the Campaign Shorts Autopilot.
#
# Provisions a fresh Hetzner VM, waits for it to self-install (cloud-init runs
# bootstrap.sh: node, ffmpeg, Piper, the service), pushes your API keys into
# /etc/autopilot.env over SSH, starts the loop, and runs `verify` — end to end.
#
# NOTE: run this from YOUR machine (laptop, or any Linux box / an existing VM).
# It cannot run from the Claude Code sandbox, whose egress policy blocks the
# Hetzner API — that block does not exist on your own network.
#
# Usage:
#   export HCLOUD_TOKEN=...            # Hetzner API token (Read & Write)
#   export ANTHROPIC_API_KEY=...       # required for research + scripting
#   export WHOP_API_KEY=...            # Content Rewards: list campaigns + submit clips
#   # optional, all forwarded if set:
#   #   YT_CLIENT_ID YT_CLIENT_SECRET   (YouTube — needed for a submittable permalink)
#   #   IG_USER_ID IG_ACCESS_TOKEN      (Instagram Reels)
#   #   TIKTOK_CLIENT_KEY TIKTOK_CLIENT_SECRET TIKTOK_REFRESH_TOKEN
#   #   WEBHOOK_URL                     (Zapier/Make fan-out)
#   #   WHOP_EXPERIENCE_ID WHOP_COMPANY_ID   (community announcements)
#   #   NICHE AUDIENCE OFFER AUTOPILOT_MODE POSTS_PER_DAY
#   ./go-live.sh
#
# Options: NAME (shorts-autopilot), TYPE (cx22), LOCATION (fsn1), IMAGE (ubuntu-24.04).
# Requires locally: curl, ssh, ssh-keygen.

set -euo pipefail

API=https://api.hetzner.cloud/v1
NAME="${NAME:-shorts-autopilot}"
TYPE="${TYPE:-cx22}"            # 2 vCPU / 4 GB x86 (~€4.50/mo); Piper is x86 so NOT the cax/ARM line
LOCATION="${LOCATION:-fsn1}"
IMAGE="${IMAGE:-ubuntu-24.04}"
REPO_URL="${REPO_URL:-https://github.com/mackkm/test1.git}"
REPO_BRANCH="${REPO_BRANCH:-claude/vm-social-content-automation-i7d7i2}"
HERE="$(cd "$(dirname "$0")" && pwd)"

for v in HCLOUD_TOKEN ANTHROPIC_API_KEY; do
  [ -n "${!v:-}" ] || { echo "ERROR: $v is not set (see the header of this script)"; exit 1; }
done
[ -n "${WHOP_API_KEY:-}" ] || echo "WARN: WHOP_API_KEY unset — the autopilot will run in niche mode (no Content Rewards earnings) until you add it."
command -v ssh-keygen >/dev/null || { echo "ERROR: ssh-keygen not found"; exit 1; }

hz() { local m=$1 p=$2 b=${3:-}; curl -fsS -X "$m" "$API$p" -H "Authorization: Bearer $HCLOUD_TOKEN" ${b:+-H "Content-Type: application/json" -d "$b"}; }
jget() { node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));const p=process.argv[1].split(".");let x=d;for(const k of p)x=x?.[k];process.stdout.write(String(x??""))' "$1"; }

echo "==> verifying Hetzner token"
hz GET /locations >/dev/null || { echo "ERROR: token rejected by Hetzner API"; exit 1; }

# --- SSH key so we can configure + verify the box after it boots ---
KEY="${SSH_KEY:-$HOME/.ssh/hetzner-autopilot}"
[ -f "$KEY" ] || ssh-keygen -t ed25519 -N "" -f "$KEY" -C "autopilot" >/dev/null
PUB=$(cat "$KEY.pub")
KEYNAME="autopilot-$(hostname -s 2>/dev/null || echo local)"
KID=$(hz GET "/ssh_keys?name=$KEYNAME" | jget "ssh_keys.0.id")
if [ -z "$KID" ]; then
  KID=$(hz POST /ssh_keys "$(node -e 'process.stdout.write(JSON.stringify({name:process.argv[1],public_key:process.argv[2]}))' "$KEYNAME" "$PUB")" | jget "ssh_key.id")
fi

# --- create the server (idempotent-ish: reuse if the name already exists) ---
EXIST=$(hz GET "/servers?name=$NAME" | jget "servers.0.public_net.ipv4.ip")
if [ -n "$EXIST" ]; then
  IP=$EXIST; echo "==> reusing existing server $NAME at $IP"
else
  USER_DATA=$(sed -e "s|__REPO_URL__|$REPO_URL|" -e "s|__REPO_BRANCH__|$REPO_BRANCH|" "$HERE/cloud-init.yaml")
  echo "==> creating $NAME ($TYPE, $IMAGE, $LOCATION)"
  BODY=$(node -e '
    const [name,type,location,image,kid]=process.argv.slice(1);
    const user_data=require("fs").readFileSync(0,"utf8");
    process.stdout.write(JSON.stringify({name,server_type:type,location,image,ssh_keys:[Number(kid)],user_data}));
  ' "$NAME" "$TYPE" "$LOCATION" "$IMAGE" "$KID" <<<"$USER_DATA")
  RES=$(hz POST /servers "$BODY")
  IP=$(printf '%s' "$RES" | jget "server.public_net.ipv4.ip")
  SID=$(printf '%s' "$RES" | jget "server.id")
  printf '==> server #%s booting at %s' "$SID" "$IP"
  for _ in $(seq 1 40); do sleep 4; printf '.'; [ "$(hz GET "/servers/$SID" | jget server.status)" = running ] && break; done; echo
fi

# --- wait for SSH, then for cloud-init/bootstrap to finish installing ---
SSHO="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=8 -i $KEY"
echo "==> waiting for SSH on $IP"
for _ in $(seq 1 60); do ssh $SSHO "root@$IP" true 2>/dev/null && break; sleep 5; done
echo "==> waiting for first-boot install to finish (cloud-init)"
ssh $SSHO "root@$IP" "cloud-init status --wait || true; while [ ! -x /opt/autopilot/autopilot/autopilot.js ] && [ ! -f /opt/autopilot/autopilot/autopilot.js ]; do sleep 5; done" || true

# --- push the operator's keys into /etc/autopilot.env ---
echo "==> writing /etc/autopilot.env"
{
  echo "# written by go-live.sh"
  for v in ANTHROPIC_API_KEY ANTHROPIC_MODEL WHOP_API_KEY WHOP_EXPERIENCE_ID WHOP_COMPANY_ID \
           YT_CLIENT_ID YT_CLIENT_SECRET IG_USER_ID IG_ACCESS_TOKEN \
           TIKTOK_CLIENT_KEY TIKTOK_CLIENT_SECRET TIKTOK_REFRESH_TOKEN \
           WEBHOOK_URL NICHE AUDIENCE OFFER AUTOPILOT_MODE POSTS_PER_DAY \
           RESEARCH_SUBREDDITS RESEARCH_HN; do
    [ -n "${!v:-}" ] && printf '%s=%s\n' "$v" "${!v}"
  done
  # Instagram pulls video from a public URL — point it at this VM
  [ -n "${IG_USER_ID:-}" ] && echo "AUTOPILOT_PUBLIC_BASE=http://$IP:3444"
  # Piper path (bootstrap installs it and also appends these; harmless if duplicated)
  echo "PIPER_BIN=/opt/piper/piper"
  echo "PIPER_VOICE=/opt/piper/en-us-lessac-medium.onnx"
} | ssh $SSHO "root@$IP" "cat > /etc/autopilot.env && chmod 600 /etc/autopilot.env && systemctl restart autopilot"

echo "==> verifying live credentials on the VM"
ssh $SSHO "root@$IP" "cd /opt/autopilot/autopilot && sudo -u autopilot AUTOPILOT_DATA=/var/lib/autopilot \$(command -v node) autopilot.js verify" || true

cat <<EOF

──────────────────────────────────────────────────────────────
 LIVE. $NAME is running the autopilot 24/7 at $IP

   status:  curl http://$IP:3444/status
   logs:    ssh -i $KEY root@$IP journalctl -fu autopilot
   youtube: ssh -i $KEY root@$IP 'cd /opt/autopilot/autopilot && sudo -u autopilot node autopilot.js auth-youtube'   # one-time

 Rotate your HCLOUD_TOKEN now (console.hetzner.cloud → Security → API Tokens)
 — provisioning only needed it once.
──────────────────────────────────────────────────────────────
EOF
