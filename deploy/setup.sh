#!/bin/bash
# PocketClaw gateway installer for any Debian/Ubuntu VM or VPS.
#
#   curl -fsSL https://raw.githubusercontent.com/mackkm/test1/master/deploy/setup.sh | sudo bash
#
# Prompts for a gateway password, installs Node + Claude Code + the gateway as
# a systemd service, and prints the URL to open on your phone.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/mackkm/test1.git}"
PORT="${PORT:-3333}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run me with sudo." >&2
  exit 1
fi

if [ -z "${POCKETCLAW_TOKEN:-}" ]; then
  if [ -t 0 ]; then
    read -r -p "Pick a gateway password (the app will ask for it): " POCKETCLAW_TOKEN
  else
    POCKETCLAW_TOKEN="$(head -c 24 /dev/urandom | base64 | tr -d '+/=')"
    echo "Generated gateway password: $POCKETCLAW_TOKEN  (save this!)"
  fi
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
npm install -g @anthropic-ai/claude-code

rm -rf /opt/pocketclaw
git clone --depth 1 "$REPO_URL" /opt/pocketclaw
mkdir -p /opt/pocketclaw-workspace

cat > /etc/pocketclaw.env <<ENV
POCKETCLAW_TOKEN=$POCKETCLAW_TOKEN
ENV
chmod 600 /etc/pocketclaw.env

# Default to sandbox mode (read/research tools only) on a VM reachable from the
# internet. Override with: POCKETCLAW_SANDBOX=0 curl ... | sudo bash
SANDBOX="${POCKETCLAW_SANDBOX:-1}"

cat > /etc/systemd/system/pocketclaw.service <<UNIT
[Unit]
Description=PocketClaw gateway
After=network-online.target
Wants=network-online.target

[Service]
Environment=PORT=$PORT
Environment=POCKETCLAW_WORKSPACE=/opt/pocketclaw-workspace
Environment=POCKETCLAW_SANDBOX=$SANDBOX
EnvironmentFile=/etc/pocketclaw.env
ExecStart=$(command -v node) /opt/pocketclaw/server/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now pocketclaw

IP="$(curl -fsS -m 5 https://api.ipify.org || hostname -I | awk '{print $1}')"
echo
echo "🦞 PocketClaw gateway is running."
echo "   On your phone, open:  http://$IP:$PORT"
echo "   Gateway password:     $POCKETCLAW_TOKEN"
echo "   (Make sure your VM's firewall allows TCP $PORT.)"
echo "   In the app settings, also paste your Anthropic API key — the gateway"
echo "   forwards it to Claude Code, no login needed on this machine."
if [ "$SANDBOX" = "1" ]; then
  echo "   Sandbox mode: ON (read/research tools only). Toggle it in the app,"
  echo "   or rerun with POCKETCLAW_SANDBOX=0 to disable by default."
fi
