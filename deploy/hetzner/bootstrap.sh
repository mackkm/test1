#!/usr/bin/env bash
# Campaign Shorts Autopilot — bootstrap an EXISTING Debian/Ubuntu VM (Hetzner
# or anywhere). Idempotent: safe to re-run to pull updates.
#
#   ssh root@YOUR_VM 'bash -s' < deploy/hetzner/bootstrap.sh
# or on the VM:
#   curl -fsSL https://raw.githubusercontent.com/mackkm/test1/master/deploy/hetzner/bootstrap.sh | sudo bash
#
# Override the source repo/branch with REPO_URL / REPO_BRANCH env vars.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/mackkm/test1.git}"
REPO_BRANCH="${REPO_BRANCH:-master}"
APP_DIR=/opt/autopilot
DATA_DIR=/var/lib/autopilot

[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)"; exit 1; }

echo "==> installing system packages (node, ffmpeg, espeak-ng, fonts)…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nodejs ffmpeg espeak-ng fonts-dejavu-core git curl >/dev/null

echo "==> fetching autopilot code -> ${APP_DIR}"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$REPO_BRANCH" && git -C "$APP_DIR" checkout "$REPO_BRANCH" && git -C "$APP_DIR" pull --ff-only origin "$REPO_BRANCH"
else
  git clone --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
fi

echo "==> creating service user + data dir"
id -u autopilot >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin autopilot
mkdir -p "$DATA_DIR"
chown -R autopilot:autopilot "$DATA_DIR"

if [ ! -f /etc/autopilot.env ]; then
  echo "==> seeding /etc/autopilot.env (fill in your keys!)"
  cp "$APP_DIR/autopilot/.env.example" /etc/autopilot.env
  chmod 600 /etc/autopilot.env
fi

echo "==> installing systemd service"
cp "$APP_DIR/deploy/hetzner/autopilot.service" /etc/systemd/system/autopilot.service
systemctl daemon-reload
systemctl enable --now autopilot

IP=$(curl -fsS -4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
cat <<EOF

──────────────────────────────────────────────────────────────
 Autopilot installed. It is running but PAUSED until configured.

 1. Edit your keys:      nano /etc/autopilot.env
      (minimum: ANTHROPIC_API_KEY + NICHE; for Instagram also
       AUTOPILOT_PUBLIC_BASE=http://${IP}:3444)
 2. Apply:               systemctl restart autopilot
 3. YouTube (once):      cd ${APP_DIR}/autopilot && sudo -u autopilot \\
                           $(command -v node) autopilot.js auth-youtube
 4. Watch it work:       journalctl -fu autopilot
    Status JSON:         curl http://${IP}:3444/status
──────────────────────────────────────────────────────────────
EOF
