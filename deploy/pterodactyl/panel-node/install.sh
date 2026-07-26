#!/usr/bin/env bash
# Bootstraps this VM as the Pterodactyl Panel + Paymenter billing node:
# Docker, firewall, generated secrets, then brings up the compose stack and
# creates the Panel admin user.
#
# Fully non-interactive when the inputs are passed as env vars:
#   sudo PANEL_DOMAIN=panel.example.com \
#        BILLING_DOMAIN=billing.example.com \
#        NODE_DOMAIN=node-a.example.com \
#        ACME_EMAIL=you@example.com \
#        ./install.sh
# Any var you omit is prompted for. Optional: ADMIN_EMAIL (defaults to
# ACME_EMAIL), ADMIN_PASSWORD (defaults to a generated one, printed at the
# end).
#
# DNS for all three domains must already point at this VM's public IP.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root (sudo ./install.sh)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ask() { # ask VAR "prompt" - prompt only if $VAR is unset/empty
  local var=$1 prompt=$2
  if [[ -z "${!var:-}" ]]; then
    read -rp "$prompt" "${var?}"
  fi
}

ask PANEL_DOMAIN "Domain for the Panel (e.g. panel.example.com): "
ask BILLING_DOMAIN "Domain for the billing storefront (e.g. billing.example.com): "
ask NODE_DOMAIN "Domain for this VM's own game node (e.g. node-a.example.com): "
ask ACME_EMAIL "Email for Let's Encrypt renewal notices: "
ADMIN_EMAIL=${ADMIN_EMAIL:-$ACME_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)}

if [[ ! -f .env ]]; then
  {
    echo "PANEL_DOMAIN=${PANEL_DOMAIN}"
    echo "BILLING_DOMAIN=${BILLING_DOMAIN}"
    echo "NODE_DOMAIN=${NODE_DOMAIN}"
    echo "ACME_EMAIL=${ACME_EMAIL}"
    echo "PANEL_DB_PASSWORD=$(openssl rand -hex 24)"
    echo "PANEL_DB_ROOT_PASSWORD=$(openssl rand -hex 24)"
    echo "PAYMENTER_DB_PASSWORD=$(openssl rand -hex 24)"
    echo "PAYMENTER_DB_ROOT_PASSWORD=$(openssl rand -hex 24)"
  } > .env
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
# Caddy (in the compose network) proxies NODE_DOMAIN -> this host's Wings
# daemon on 8080; nothing outside that subnet may reach 8080 directly.
ufw allow from 172.20.0.0/16 to any port 8080 proto tcp
ufw --force enable

echo "==> Creating data directories under /srv..."
mkdir -p \
  /srv/pterodactyl/{database,var,nginx,logs} \
  /srv/paymenter/{database,app,storage/logs,storage/public,themes,extensions} \
  /srv/caddy/{data,config}

echo "==> Pulling images and starting the stack..."
docker compose pull
docker compose up -d

echo "==> Waiting for the Panel to finish first-boot migrations..."
admin_created=false
for _ in $(seq 1 60); do
  if docker compose exec -T panel php artisan p:user:make \
      --email="${ADMIN_EMAIL}" --username=admin \
      --name-first=Admin --name-last=Owner \
      --password="${ADMIN_PASSWORD}" --admin=1 -n >/dev/null 2>&1; then
    admin_created=true
    break
  fi
  sleep 5
done

if $admin_created; then
  echo "==> Panel admin user created."
else
  echo "==> Could not auto-create the admin user (it may already exist" \
       "from a previous run). Create/inspect it manually with:" >&2
  echo "      docker compose exec panel php artisan p:user:make" >&2
fi

cat <<EOF

==============================================================
 Panel node is up.

   Panel:    https://${PANEL_DOMAIN}
   Billing:  https://${BILLING_DOMAIN}
   Admin login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}
     (change this password after first login)

 Next steps:

 1. Log in to the Panel and create an Application API key:
      https://${PANEL_DOMAIN}/admin/api/new
    (tick read/write for all resources). Use it with
    ../provision.py to create the nodes for all your VMs.

 2. Open https://${BILLING_DOMAIN} to run Paymenter's first-run
    setup wizard, then connect it to the Panel with another
    Application API key.

 See ../README.md for the full walkthrough.
==============================================================
EOF
