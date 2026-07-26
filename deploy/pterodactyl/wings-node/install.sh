#!/usr/bin/env bash
# Bootstraps this VM as a Pterodactyl Wings node (runs the actual game
# server containers) and - given a Panel API key - registers itself as a
# node in the Panel and starts, with no other input:
#
#   sudo PANEL_URL=https://panel-... APP_API_KEY=ptla_... ./install.sh
#
# On the Panel VM itself (Caddy already terminates TLS there), add CO_LOCATED=1:
#
#   sudo CO_LOCATED=1 PANEL_URL=... APP_API_KEY=ptla_... ./install.sh
#
# The VM detects its own public IP; its hostname defaults to
# node-<ip-dashes>.sslip.io (override with NODE_FQDN=... if you use a real
# domain - DNS must already point here). Optional: GAME_PORTS (default
# 25565:25665), ACME_EMAIL (for Let's Encrypt notices), NODE_RAM_MB /
# NODE_DISK_MB (how much of this VM the Panel may allocate).
#
# Without an API key you can instead pass WINGS_CONFIG_B64=<base64 of
# config.yml> (produced by ../provision.py fleet mode), or run with nothing
# and finish by pasting the config from the Panel UI manually.
#
# Run as root on Ubuntu 22.04/24.04 or Debian 11/12.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root (sudo ./install.sh)." >&2
  exit 1
fi

# Docker cannot run in the Hetzner rescue system, and anything installed
# there is lost on reboot - catch that before wasting the user's time.
if [[ "$(hostname)" == "rescue" || -f /etc/hetzner-rescue ]]; then
  cat >&2 <<'EOF'
ERROR: This is the Hetzner RESCUE system (a temporary OS in memory), not
your real server. Installing here will not work and will not survive a
reboot. To fix:
  1. On the Hetzner Cloud website: your server -> Rescue tab -> disable rescue
  2. Run: reboot   (then reconnect after ~1 minute)
  3. Check the prompt/hostname no longer says "rescue", then re-run this.
EOF
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CO_LOCATED=${CO_LOCATED:-0}
GAME_PORTS=${GAME_PORTS:-25565:25665}
GAME_PORTS=${GAME_PORTS//-/:}   # accept 25565-25665 too

PUBLIC_IP=${NODE_IP:-$(curl -4fsS https://api.ipify.org || curl -4fsS https://ifconfig.me)}
DASHED_IP=${PUBLIC_IP//./-}
if [[ "$CO_LOCATED" == "1" ]]; then
  NODE_FQDN=${NODE_FQDN:-node-a-${DASHED_IP}.sslip.io}
else
  NODE_FQDN=${NODE_FQDN:-node-${DASHED_IP}.sslip.io}
fi
echo "==> This node: ${NODE_FQDN} (${PUBLIC_IP})"

echo "==> Installing Docker Engine..."
if ! command -v docker &>/dev/null; then
  curl -sSL https://get.docker.com/ | CHANNEL=stable bash
fi
systemctl enable --now docker

echo "==> Installing/configuring firewall (ufw)..."
apt-get update -qq
apt-get install -y -qq ufw >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 2022/tcp                 # SFTP - customers connect directly
ufw allow "${GAME_PORTS}/tcp"
ufw allow "${GAME_PORTS}/udp"
if [[ "$CO_LOCATED" != "1" ]]; then
  # 8080 is the daemon API: the Panel AND customer browsers (server console
  # websocket) connect to it, so it must be publicly reachable - TLS plus
  # the Panel-issued tokens are what protect it. 80 is for certbot renewals.
  ufw allow 8080/tcp
  ufw allow 80/tcp
fi
ufw --force enable

if [[ "$CO_LOCATED" != "1" ]]; then
  echo "==> Obtaining TLS certificate for ${NODE_FQDN}..."
  apt-get install -y -qq certbot >/dev/null
  if [[ ! -d "/etc/letsencrypt/live/${NODE_FQDN}" ]]; then
    if [[ -n "${ACME_EMAIL:-}" ]]; then
      certbot certonly --standalone -d "${NODE_FQDN}" -m "${ACME_EMAIL}" \
        --agree-tos --non-interactive
    else
      certbot certonly --standalone -d "${NODE_FQDN}" \
        --register-unsafely-without-email --agree-tos --non-interactive
    fi
  else
    echo "    certificate already present, skipping."
  fi
fi

echo "==> Installing Wings..."
mkdir -p /etc/pterodactyl
arch_suffix="amd64"
[[ "$(uname -m)" != "x86_64" ]] && arch_suffix="arm64"
curl -L -o /usr/local/bin/wings \
  "https://github.com/pterodactyl/wings/releases/latest/download/wings_linux_${arch_suffix}"
chmod u+x /usr/local/bin/wings

cat >/etc/systemd/system/wings.service <<'EOF'
[Unit]
Description=Pterodactyl Wings Daemon
After=docker.service
Requires=docker.service
PartOf=docker.service

[Service]
User=root
WorkingDirectory=/etc/pterodactyl
LimitNOFILE=4096
PIDFile=/var/run/wings/daemon.pid
ExecStart=/usr/local/bin/wings
Restart=on-failure
StartLimitInterval=180
StartLimitBurst=30
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload

start_wings() {
  systemctl enable --now wings
  sleep 3
  if systemctl is-active --quiet wings; then
    echo "==> Wings is running. Node '${NODE_FQDN}' should show online in the Panel."
  else
    echo "==> Wings failed to start - check: journalctl -u wings -n 50" >&2
    exit 1
  fi
}

if [[ -n "${APP_API_KEY:-}" && -n "${PANEL_URL:-}" ]]; then
  echo "==> Registering this VM as a node in the Panel..."
  SELF=1 NODE_IP="${PUBLIC_IP}" NODE_FQDN="${NODE_FQDN}" \
    CO_LOCATED="${CO_LOCATED}" GAME_PORTS="${GAME_PORTS//:/-}" \
    PANEL_URL="${PANEL_URL}" APP_API_KEY="${APP_API_KEY}" \
    python3 "${SCRIPT_DIR}/../provision.py"
  start_wings
elif [[ -n "${WINGS_CONFIG_B64:-}" ]]; then
  echo "==> Writing /etc/pterodactyl/config.yml from WINGS_CONFIG_B64..."
  echo "${WINGS_CONFIG_B64}" | base64 -d > /etc/pterodactyl/config.yml
  chmod 600 /etc/pterodactyl/config.yml
  start_wings
else
  cat <<EOF

==> Docker, firewall, TLS, and the Wings binary/service are installed.
    Wings is NOT started yet - it needs its config from the Panel. Either
    re-run with PANEL_URL=... APP_API_KEY=ptla_... (self-registers,
    recommended), or create the node in the Panel UI, paste its
    Configuration tab into /etc/pterodactyl/config.yml, and run:
      systemctl enable --now wings
EOF
fi
