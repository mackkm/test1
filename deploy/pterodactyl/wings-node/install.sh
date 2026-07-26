#!/usr/bin/env bash
# Bootstraps this VM as a Pterodactyl Wings node (runs the actual game
# server containers).
#
# Standalone node (VM B / VM C) - gets its own Let's Encrypt cert, since
# customer browsers connect straight to the daemon over wss://
#   sudo NODE_FQDN=node-b.example.com \
#        ACME_EMAIL=you@example.com \
#        GAME_PORTS=25565:25665 \
#        ./install.sh
#
# Co-located node (the Panel VM, where Caddy already terminates TLS):
#   sudo CO_LOCATED=1 GAME_PORTS=25565:25665 ./install.sh
#
# Optional (either mode): WINGS_CONFIG_B64=<base64 of config.yml> writes
# /etc/pterodactyl/config.yml and starts Wings immediately - produced by
# ../provision.py so the whole node comes up from a single paste. Without
# it, the script stops before starting Wings and tells you how to add the
# config from the Panel by hand.
#
# Any missing var is prompted for. Run as root on Ubuntu 22.04/24.04 or
# Debian 11/12.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root (sudo ./install.sh)." >&2
  exit 1
fi

CO_LOCATED=${CO_LOCATED:-0}

ask() { # ask VAR "prompt" - prompt only if $VAR is unset/empty
  local var=$1 prompt=$2
  if [[ -z "${!var:-}" ]]; then
    read -rp "$prompt" "${var?}"
  fi
}

if [[ "$CO_LOCATED" != "1" ]]; then
  ask NODE_FQDN "This node's domain (e.g. node-b.example.com, DNS already pointed here): "
  ask ACME_EMAIL "Email for Let's Encrypt renewal notices: "
fi
ask GAME_PORTS "Port range for game server allocations, e.g. 25565:25665: "
GAME_PORTS=${GAME_PORTS//-/:}   # accept 25565-25665 too

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
    certbot certonly --standalone -d "${NODE_FQDN}" -m "${ACME_EMAIL}" \
      --agree-tos --non-interactive
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

if [[ -n "${WINGS_CONFIG_B64:-}" ]]; then
  echo "==> Writing /etc/pterodactyl/config.yml and starting Wings..."
  echo "${WINGS_CONFIG_B64}" | base64 -d > /etc/pterodactyl/config.yml
  chmod 600 /etc/pterodactyl/config.yml
  systemctl enable --now wings
  sleep 3
  if systemctl is-active --quiet wings; then
    echo "==> Wings is running. The node should show online in the Panel."
  else
    echo "==> Wings failed to start - check: journalctl -u wings -n 50" >&2
    exit 1
  fi
else
  cat <<EOF

==> Docker, firewall, TLS, and the Wings binary/service are installed.
    Wings is NOT started yet - it needs its config from the Panel:

    1. In the Panel admin, create a Node for this machine, then open the
       Node's "Configuration" tab, copy the block, and save it as
       /etc/pterodactyl/config.yml on this VM. (Or use ../provision.py,
       which does the whole thing and hands you a one-paste command.)

    2. systemctl enable --now wings && systemctl status wings
EOF
fi
