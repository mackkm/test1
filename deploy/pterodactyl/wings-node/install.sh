#!/usr/bin/env bash
# Bootstraps this VM as a Pterodactyl Wings node (runs the actual game
# server containers). Use on BOTH Hetzner VMs - including the one that also
# runs the Panel, since Wings is a native systemd service, not a container.
#
# Run as root on a fresh Ubuntu 22.04/24.04 (or Debian 11/12) Hetzner VM:
#   sudo ./install.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root (sudo ./install.sh)." >&2
  exit 1
fi

read -rp "Panel node's IP (so only it can reach Wings' API on port 8080): " panel_ip
read -rp "Port range for game server allocations, e.g. 25565:25665: " game_port_range

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
ufw allow from "${panel_ip}" to any port 8080 proto tcp   # Wings API (Panel -> node)
ufw allow 2022/tcp                                        # SFTP - customers connect directly
ufw allow "${game_port_range}/tcp"
ufw allow "${game_port_range}/udp"
ufw --force enable

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

cat <<EOF

==> Docker, firewall, and the Wings binary/service are installed.

Next steps:

1. In the Panel admin, create a Node for this machine (Settings -> Locations
   first if you haven't already) with this VM's IP/FQDN, and an allocation
   range matching what you just opened: ${game_port_range}.

2. Open the Node's "Configuration" tab in the Panel, copy the whole block,
   and save it as /etc/pterodactyl/config.yml on this VM:
     nano /etc/pterodactyl/config.yml

3. Start Wings and confirm it comes up:
     systemctl enable --now wings
     systemctl status wings
     journalctl -u wings -f

   The node should flip to green/"online" in the Panel admin within a few
   seconds. If not, check that port 8080 is reachable from the Panel node
   (${panel_ip}) and that config.yml matches exactly what the Panel showed.
EOF
