#!/usr/bin/env bash
# Bootstraps this VM as the Pterodactyl Panel + Paymenter billing node:
# Docker, firewall, generated secrets, then brings up the compose stack.
#
# Run as root on a fresh Ubuntu 22.04/24.04 (or Debian 11/12) Hetzner VM,
# from inside this directory (deploy/pterodactyl/panel-node):
#   sudo ./install.sh
#
# Before running: point PANEL_DOMAIN and BILLING_DOMAIN's DNS A/AAAA records
# at this VM's public IP - Caddy needs that to obtain TLS certificates.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root (sudo ./install.sh)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  read -rp "Domain for the Panel (e.g. panel.example.com): " panel_domain
  read -rp "Domain for the billing storefront (e.g. billing.example.com): " billing_domain
  read -rp "Email for Let's Encrypt renewal notices: " acme_email

  panel_db_password=$(openssl rand -hex 24)
  panel_db_root_password=$(openssl rand -hex 24)
  pay_db_password=$(openssl rand -hex 24)
  pay_db_root_password=$(openssl rand -hex 24)

  sed -i \
    -e "s#^PANEL_DOMAIN=.*#PANEL_DOMAIN=${panel_domain}#" \
    -e "s#^BILLING_DOMAIN=.*#BILLING_DOMAIN=${billing_domain}#" \
    -e "s#^ACME_EMAIL=.*#ACME_EMAIL=${acme_email}#" \
    -e "s#^PANEL_DB_PASSWORD=.*#PANEL_DB_PASSWORD=${panel_db_password}#" \
    -e "s#^PANEL_DB_ROOT_PASSWORD=.*#PANEL_DB_ROOT_PASSWORD=${panel_db_root_password}#" \
    -e "s#^PAYMENTER_DB_PASSWORD=.*#PAYMENTER_DB_PASSWORD=${pay_db_password}#" \
    -e "s#^PAYMENTER_DB_ROOT_PASSWORD=.*#PAYMENTER_DB_ROOT_PASSWORD=${pay_db_root_password}#" \
    .env
  chmod 600 .env
  echo "Wrote .env with generated database passwords."
else
  echo ".env already exists, leaving it as-is."
fi

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
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Creating data directories under /srv..."
mkdir -p \
  /srv/pterodactyl/{database,var,nginx,logs} \
  /srv/paymenter/{database,app,storage/logs,storage/public,themes,extensions} \
  /srv/caddy/{data,config}

echo "==> Pulling images and starting the stack..."
docker compose pull
docker compose up -d

cat <<'EOF'

==> Panel node is up. Next steps:

1. Wait ~30s for first-boot migrations, then create your admin user:
     docker compose exec panel php artisan p:user:make

2. Open https://<PANEL_DOMAIN> and log in as that admin. Create a Location,
   then a Node for each Wings host (this VM's IP/FQDN, and your second VM's).
   Copy the node's "Configuration" tab contents to /etc/pterodactyl/config.yml
   on the matching Wings node (see ../wings-node/install.sh).

3. Open https://<BILLING_DOMAIN> to run Paymenter's first-run setup wizard,
   then connect it to the Panel via an Application API key
   (Panel admin -> Application API -> create key with server/user permissions).

See ../README.md for the full walkthrough (eggs, allocations, Stripe/PayPal,
backups, security hardening).
EOF
