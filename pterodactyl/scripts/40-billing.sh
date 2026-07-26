#!/usr/bin/env bash
# Install Paymenter — the open-source billing / client area — alongside the
# Pterodactyl Panel on the same host.
#
# Paymenter is the standard free billing front-end for Pterodactyl: it sells
# packages, takes payment, and provisions game servers into the Panel through
# the Panel's application API.
#
# Requires: BILLING_FQDN, BILLING_ADMIN_EMAIL
# Optional: LETSENCRYPT_EMAIL, BILLING_ADMIN_PASSWORD
#
# Assumes 30-panel.sh already ran on this host (PHP 8.3, MariaDB, nginx, Redis
# and Composer come from there). Idempotent: safe to re-run.

. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_root
require_debian_family
need_var BILLING_ADMIN_EMAIL

# Same public-IP fallback as the panel. When both apps land on one bare IP they
# cannot be told apart by server_name, so billing moves to its own port.
BILLING_PORT=${BILLING_PORT:-80}
if [[ -z ${BILLING_FQDN:-} || ${BILLING_FQDN} == auto ]]; then
    BILLING_FQDN="$(detect_public_ip)"
    [[ -n $BILLING_FQDN ]] || die "could not determine the public IP; set BILLING_FQDN"
    warn "BILLING_FQDN not set — falling back to ${BILLING_FQDN}"
fi

if [[ $BILLING_FQDN =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then
    BILLING_SCHEME=http
    LETSENCRYPT_EMAIL=""
    BILLING_PORT=${BILLING_PORT_IP_FALLBACK:-8081}
    warn "billing address is a bare IP — serving on port ${BILLING_PORT} without TLS."
else
    BILLING_SCHEME=${BILLING_SCHEME:-https}
fi

BILLING_DIR=/var/www/paymenter
BILLING_DB=${BILLING_DB:-paymenter}
BILLING_DB_USER=${BILLING_DB_USER:-paymenter}
PHP_VER=8.3

command -v composer >/dev/null 2>&1 || die "composer not found — run 30-panel.sh on this host first"
command -v php      >/dev/null 2>&1 || die "php not found — run 30-panel.sh on this host first"

BILLING_DB_PASS="$(persist_secret billing_db_pass 40)"
BILLING_ADMIN_PASSWORD="${BILLING_ADMIN_PASSWORD:-$(persist_secret billing_admin_pass 24)}"

step "Installing Paymenter dependencies"
# intl and redis are the two extensions Paymenter needs beyond the Panel's set.
apt_install "php${PHP_VER}-intl" "php${PHP_VER}-redis"

step "Preparing the billing database"
mysql --protocol=socket -u root <<SQL
CREATE DATABASE IF NOT EXISTS \`${BILLING_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${BILLING_DB_USER}'@'127.0.0.1' IDENTIFIED BY '${BILLING_DB_PASS}';
ALTER USER '${BILLING_DB_USER}'@'127.0.0.1' IDENTIFIED BY '${BILLING_DB_PASS}';
GRANT ALL PRIVILEGES ON \`${BILLING_DB}\`.* TO '${BILLING_DB_USER}'@'127.0.0.1' WITH GRANT OPTION;
FLUSH PRIVILEGES;
SQL
log "database '${BILLING_DB}' and user '${BILLING_DB_USER}' ready"

step "Downloading Paymenter"

FRESH_INSTALL=no
if [[ ! -f ${BILLING_DIR}/artisan ]]; then
    FRESH_INSTALL=yes
    install -d -m 0755 "$BILLING_DIR"
fi

cd "$BILLING_DIR" || die "cannot enter $BILLING_DIR"
retry 3 curl -fsSL -o paymenter.tar.gz \
    https://github.com/paymenter/paymenter/releases/latest/download/paymenter.tar.gz

if [[ $FRESH_INSTALL == no ]]; then
    log "existing installation found — backing up before upgrade"
    php artisan down || true
    tar -czf "/root/paymenter-backup-$(date +%Y%m%d%H%M%S).tar.gz" \
        -C "$BILLING_DIR" .env storage 2>/dev/null || true
fi

tar -xzf paymenter.tar.gz && rm -f paymenter.tar.gz
chmod -R 755 storage/* bootstrap/cache/

[[ -f .env ]] || cp .env.example .env

step "Installing PHP dependencies"
COMPOSER_ALLOW_SUPERUSER=1 composer install --no-dev --optimize-autoloader --no-interaction

# set_env KEY VALUE — rewrite a key in .env, appending when absent.
set_env() {
    local key=$1 value=$2
    if grep -qE "^${key}=" .env; then
        sed -i "s|^${key}=.*|${key}=${value}|" .env
    else
        printf '%s=%s\n' "$key" "$value" >> .env
    fi
}

set_env APP_URL       "${BILLING_SCHEME}://${BILLING_FQDN}:${BILLING_PORT}"
set_env APP_ENV       production
set_env APP_DEBUG     false
set_env DB_CONNECTION mysql
set_env DB_HOST       127.0.0.1
set_env DB_PORT       3306
set_env DB_DATABASE   "$BILLING_DB"
set_env DB_USERNAME   "$BILLING_DB_USER"
set_env DB_PASSWORD   "$BILLING_DB_PASS"
set_env CACHE_DRIVER  redis
set_env SESSION_DRIVER redis
set_env QUEUE_CONNECTION redis
set_env REDIS_HOST    127.0.0.1

if [[ $FRESH_INSTALL == yes ]]; then
    php artisan key:generate --force
fi
php artisan storage:link || true

step "Running Paymenter migrations"
php artisan migrate --force --seed
php artisan db:seed --class=CustomPropertySeeder --force || \
    warn "CustomPropertySeeder did not run cleanly (harmless if already seeded)"
php artisan app:init --no-interaction || \
    warn "'php artisan app:init' needs attention — re-run it interactively if the UI misbehaves"

if [[ $FRESH_INSTALL == yes ]]; then
    step "Creating the billing administrator account"
    # app:user:create is interactive in some releases; use flags when the build
    # supports them and fall back to clear instructions when it does not.
    HELP="$(php artisan app:user:create --help 2>/dev/null || true)"
    if grep -q -- '--email' <<<"$HELP" && grep -q -- '--password' <<<"$HELP"; then
        php artisan app:user:create \
            --email="$BILLING_ADMIN_EMAIL" \
            --password="$BILLING_ADMIN_PASSWORD" \
            --first-name=Billing --last-name=Admin \
            --no-interaction \
            && BILLING_ADMIN_CREATED=yes \
            || warn "non-interactive admin creation failed"
    fi
    if [[ ${BILLING_ADMIN_CREATED:-no} != yes ]]; then
        warn "Create the billing admin by hand:"
        warn "  cd ${BILLING_DIR} && php artisan app:user:create"
    else
        save_cred "billing url        : ${BILLING_SCHEME}://${BILLING_FQDN}:${BILLING_PORT}"
        save_cred "billing admin email: ${BILLING_ADMIN_EMAIL}"
        save_cred "billing admin pass : ${BILLING_ADMIN_PASSWORD}"
        save_cred "billing db user/pass: ${BILLING_DB_USER} / ${BILLING_DB_PASS}"
        save_cred ""
    fi
fi

chown -R www-data:www-data "$BILLING_DIR"

step "Configuring the Paymenter queue worker and scheduler"

ensure_cron www-data "* * * * * php ${BILLING_DIR}/artisan schedule:run >> /dev/null 2>&1"

write_file /etc/systemd/system/paymenter.service 0644 <<UNIT
[Unit]
Description=Paymenter Queue Worker
After=redis-server.service

[Service]
User=www-data
Group=www-data
Restart=always
ExecStart=/usr/bin/php ${BILLING_DIR}/artisan queue:work --tries=3
StartLimitInterval=180
StartLimitBurst=30
RestartSec=5s

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now paymenter.service
systemctl restart paymenter.service

step "Configuring nginx for ${BILLING_FQDN}"

write_file /etc/nginx/sites-available/paymenter.conf 0644 <<NGINX
server {
    listen ${BILLING_PORT};
    listen [::]:${BILLING_PORT};
    server_name ${BILLING_FQDN};
    root ${BILLING_DIR}/public;
    index index.php;

    access_log /var/log/nginx/paymenter.app-access.log;
    error_log  /var/log/nginx/paymenter.app-error.log error;

    client_max_body_size 100m;
    client_body_timeout 120s;

    location /.well-known/acme-challenge/ { root /var/www/html; }

    location / {
        try_files \$uri \$uri/ /index.php?\$query_string;
    }

    location ~ \.php\$ {
        fastcgi_split_path_info ^(.+\.php)(/.+)\$;
        fastcgi_pass unix:/run/php/php${PHP_VER}-fpm.sock;
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param PHP_VALUE "upload_max_filesize = 100M \n post_max_size=100M";
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
        fastcgi_param HTTP_PROXY "";
        fastcgi_intercept_errors off;
        fastcgi_buffer_size 16k;
        fastcgi_buffers 4 16k;
        fastcgi_connect_timeout 300;
        fastcgi_send_timeout 300;
        fastcgi_read_timeout 300;
    }

    location ~ /\.ht { deny all; }
}
NGINX

ln -sfn /etc/nginx/sites-available/paymenter.conf /etc/nginx/sites-enabled/paymenter.conf
nginx -t && systemctl reload nginx

if [[ -n ${LETSENCRYPT_EMAIL:-} ]]; then
    step "Requesting a Let's Encrypt certificate for ${BILLING_FQDN}"
    apt_install certbot python3-certbot-nginx
    MY_IP="$(detect_public_ip)"
    RESOLVED="$(getent ahostsv4 "$BILLING_FQDN" 2>/dev/null | awk 'NR==1{print $1}')"
    if [[ -n $RESOLVED && $RESOLVED == "$MY_IP" ]]; then
        certbot --nginx -d "$BILLING_FQDN" \
            --non-interactive --agree-tos -m "$LETSENCRYPT_EMAIL" --redirect \
            && log "certificate issued" \
            || warn "certbot failed; billing is still reachable over HTTP"
    else
        warn "DNS for ${BILLING_FQDN} resolves to '${RESOLVED:-nothing}', not ${MY_IP}."
        warn "Point the A record at ${MY_IP}, then run:"
        warn "  certbot --nginx -d ${BILLING_FQDN} -m ${LETSENCRYPT_EMAIL} --agree-tos --redirect"
    fi
fi

log "billing installation complete: ${BILLING_SCHEME}://${BILLING_FQDN}:${BILLING_PORT}"
log "Next: in the Paymenter admin area add a Pterodactyl server integration"
log "pointing at https://${PANEL_FQDN:-your-panel} with a Panel application API key."
