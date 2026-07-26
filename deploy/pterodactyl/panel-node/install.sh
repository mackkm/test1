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
cd "$SCRIPT_DIR"

ask() { # ask VAR "prompt" - prompt only if $VAR is unset/empty
  local var=$1 prompt=$2
  if [[ -z "${!var:-}" ]]; then
    read -rp "$prompt" "${var?}"
  fi
}

# AUTO_SSLIP=1: no domain needed - derive hostnames from this VM's public IP
# via sslip.io (e.g. panel-65-108-1-2.sslip.io), which resolves automatically.
if [[ "${AUTO_SSLIP:-0}" == "1" ]]; then
  PUBLIC_IP=$(curl -4fsS https://api.ipify.org || curl -4fsS https://ifconfig.me)
  DASHED_IP=${PUBLIC_IP//./-}
  PANEL_DOMAIN=${PANEL_DOMAIN:-panel-${DASHED_IP}.sslip.io}
  BILLING_DOMAIN=${BILLING_DOMAIN:-billing-${DASHED_IP}.sslip.io}
  NODE_DOMAIN=${NODE_DOMAIN:-node-a-${DASHED_IP}.sslip.io}
  echo "==> Using sslip.io hostnames for ${PUBLIC_IP}:"
  echo "    ${PANEL_DOMAIN} / ${BILLING_DOMAIN} / ${NODE_DOMAIN}"
fi

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
    (tick read/write for all resources)

 2. Register THIS VM as a game node - run here, with your new key:

      cd "$(cd "${SCRIPT_DIR}/../wings-node" && pwd)"
      sudo CO_LOCATED=1 PANEL_URL=https://${PANEL_DOMAIN} \\
           APP_API_KEY=ptla_PASTE_YOUR_KEY ./install.sh

 3. Register EVERY OTHER VM - run this same block on each:

      sudo apt-get update && sudo apt-get install -y git
      git clone --branch claude/pterodactyl-vm-rental-lxun3e https://github.com/mackkm/test1.git
      cd test1/deploy/pterodactyl/wings-node
      sudo PANEL_URL=https://${PANEL_DOMAIN} \\
           APP_API_KEY=ptla_PASTE_YOUR_KEY ./install.sh

    Each VM finds its own IP, gets a TLS cert, registers itself as
    a node in the Panel, and starts Wings - no editing needed.

 4. Open https://${BILLING_DOMAIN} for Paymenter's first-run
    setup wizard (billing storefront).

 See ../README.md for the full walkthrough.
==============================================================
EOF
