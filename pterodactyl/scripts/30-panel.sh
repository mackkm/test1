#!/usr/bin/env bash
# Install the Pterodactyl Panel (1.12.x) with nginx + PHP 8.3 + MariaDB + Redis.
#
# Requires: PANEL_FQDN, PANEL_ADMIN_EMAIL
# Optional: PANEL_ADMIN_USER, PANEL_ADMIN_PASSWORD, LETSENCRYPT_EMAIL, TIMEZONE
#
# Idempotent: safe to re-run. Generated passwords are persisted under
# /root/.pterodactyl-secrets so re-runs do not invalidate the installation.

. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_root
require_debian_family
need_var PANEL_FQDN PANEL_ADMIN_EMAIL

PANEL_DIR=/var/www/pterodactyl
PANEL_DB=${PANEL_DB:-panel}
PANEL_DB_USER=${PANEL_DB_USER:-pterodactyl}
PANEL_ADMIN_USER=${PANEL_ADMIN_USER:-admin}
TIMEZONE=${TIMEZONE:-UTC}
PHP_VER=8.3

PANEL_DB_PASS="$(persist_secret panel_db_pass 40)"
PANEL_ADMIN_PASSWORD="${PANEL_ADMIN_PASSWORD:-$(persist_secret panel_admin_pass 24)}"

step "Installing PHP ${PHP_VER}, MariaDB, nginx, Redis"

if [[ "$(os_id)" == ubuntu ]]; then
    if ! grep -rq '^deb .*ondrej' /etc/apt/sources.list.d/ 2>/dev/null; then
        LC_ALL=C.UTF-8 add-apt-repository -y ppa:ondrej/php
    fi
else
    if [[ ! -f /etc/apt/sources.list.d/php.list ]]; then
        curl -fsSL https://packages.sury.org/php/apt.gpg -o /usr/share/keyrings/sury-php.gpg
        echo "deb [signed-by=/usr/share/keyrings/sury-php.gpg] https://packages.sury.org/php/ $(os_codename) main" \
            > /etc/apt/sources.list.d/php.list
    fi
fi

apt_refresh
apt_install \
    "php${PHP_VER}" \
    "php${PHP_VER}-common" "php${PHP_VER}-cli" "php${PHP_VER}-gd" \
    "php${PHP_VER}-mysql" "php${PHP_VER}-mbstring" "php${PHP_VER}-bcmath" \
    "php${PHP_VER}-xml" "php${PHP_VER}-fpm" "php${PHP_VER}-curl" \
    "php${PHP_VER}-zip" "php${PHP_VER}-intl" "php${PHP_VER}-redis" \
    mariadb-server nginx redis-server tar unzip git

systemctl enable --now mariadb redis-server "php${PHP_VER}-fpm" nginx

if ! command -v composer >/dev/null 2>&1; then
    step "Installing Composer"
    retry 3 bash -c 'curl -fsSL https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer'
fi

step "Preparing the panel database"

# Root uses unix_socket auth on a stock MariaDB, so this needs no password.
mysql --protocol=socket -u root <<SQL
CREATE DATABASE IF NOT EXISTS \`${PANEL_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${PANEL_DB_USER}'@'127.0.0.1' IDENTIFIED BY '${PANEL_DB_PASS}';
ALTER USER '${PANEL_DB_USER}'@'127.0.0.1' IDENTIFIED BY '${PANEL_DB_PASS}';
GRANT ALL PRIVILEGES ON \`${PANEL_DB}\`.* TO '${PANEL_DB_USER}'@'127.0.0.1' WITH GRANT OPTION;
FLUSH PRIVILEGES;
SQL
log "database '${PANEL_DB}' and user '${PANEL_DB_USER}' ready"

step "Downloading the Pterodactyl Panel"

FRESH_INSTALL=no
if [[ ! -f ${PANEL_DIR}/artisan ]]; then
    FRESH_INSTALL=yes
    install -d -m 0755 "$PANEL_DIR"
fi

cd "$PANEL_DIR" || die "cannot enter $PANEL_DIR"
retry 3 curl -fsSL -o panel.tar.gz \
    https://github.com/pterodactyl/panel/releases/latest/download/panel.tar.gz

if [[ $FRESH_INSTALL == no ]]; then
    log "existing installation found — backing up before upgrade"
    php artisan down || true
    tar -czf "/root/panel-backup-$(date +%Y%m%d%H%M%S).tar.gz" \
        -C "$PANEL_DIR" .env storage 2>/dev/null || true
fi

tar -xzf panel.tar.gz && rm -f panel.tar.gz
chmod -R 755 storage/* bootstrap/cache/

[[ -f .env ]] || cp .env.example .env

step "Installing PHP dependencies"
COMPOSER_ALLOW_SUPERUSER=1 composer install --no-dev --optimize-autoloader --no-interaction

if [[ $FRESH_INSTALL == yes ]]; then
    php artisan key:generate --force
fi

step "Configuring the panel environment"

php artisan p:environment:setup \
    --author="$PANEL_ADMIN_EMAIL" \
    --url="https://${PANEL_FQDN}" \
    --timezone="$TIMEZONE" \
    --cache=redis --session=redis --queue=redis \
    --redis-host=127.0.0.1 --redis-port=6379 --redis-pass= \
    --settings-ui=true \
    --no-interaction

php artisan p:environment:database \
    --host=127.0.0.1 --port=3306 \
    --database="$PANEL_DB" \
    --username="$PANEL_DB_USER" \
    --password="$PANEL_DB_PASS" \
    --no-interaction

step "Running database migrations"
php artisan migrate --seed --force

if [[ $FRESH_INSTALL == yes ]]; then
    step "Creating the administrator account"
    php artisan p:user:make \
        --email="$PANEL_ADMIN_EMAIL" \
        --username="$PANEL_ADMIN_USER" \
        --name-first=Server --name-last=Admin \
        --password="$PANEL_ADMIN_PASSWORD" \
        --admin=1 --no-interaction
    save_cred "panel url          : https://${PANEL_FQDN}"
    save_cred "panel admin user   : ${PANEL_ADMIN_USER}"
    save_cred "panel admin email  : ${PANEL_ADMIN_EMAIL}"
    save_cred "panel admin pass   : ${PANEL_ADMIN_PASSWORD}"
    save_cred "panel db user/pass : ${PANEL_DB_USER} / ${PANEL_DB_PASS}"
    save_cred ""
fi

chown -R www-data:www-data "$PANEL_DIR"

step "Configuring the queue worker and scheduler"

ensure_cron www-data "* * * * * php ${PANEL_DIR}/artisan schedule:run >> /dev/null 2>&1"

write_file /etc/systemd/system/pteroq.service 0644 <<UNIT
[Unit]
Description=Pterodactyl Queue Worker
After=redis-server.service

[Service]
User=www-data
Group=www-data
Restart=always
ExecStart=/usr/bin/php ${PANEL_DIR}/artisan queue:work --queue=high,standard,low --sleep=3 --tries=3
StartLimitInterval=180
StartLimitBurst=30
RestartSec=5s

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now pteroq.service
systemctl restart pteroq.service

step "Configuring nginx for ${PANEL_FQDN}"

rm -f /etc/nginx/sites-enabled/default

# Start on plain HTTP so certbot can complete the ACME challenge; the TLS vhost
# is written afterwards only if a certificate actually exists.
write_file /etc/nginx/sites-available/pterodactyl.conf 0644 <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${PANEL_FQDN};
    root ${PANEL_DIR}/public;
    index index.php;

    access_log /var/log/nginx/pterodactyl.app-access.log;
    error_log  /var/log/nginx/pterodactyl.app-error.log error;

    client_max_body_size 100m;
    client_body_timeout 120s;
    sendfile off;

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

ln -sfn /etc/nginx/sites-available/pterodactyl.conf /etc/nginx/sites-enabled/pterodactyl.conf
install -d -m 0755 /var/www/html
nginx -t && systemctl reload nginx

# TLS. Wings refuses to talk to a panel over a self-signed certificate, so a
# real certificate matters here — but only attempt it when the DNS record for
# PANEL_FQDN already points at this host.
if [[ -n ${LETSENCRYPT_EMAIL:-} ]]; then
    step "Requesting a Let's Encrypt certificate for ${PANEL_FQDN}"
    apt_install certbot python3-certbot-nginx
    MY_IP="$(detect_public_ip)"
    RESOLVED="$(getent ahostsv4 "$PANEL_FQDN" 2>/dev/null | awk 'NR==1{print $1}')"
    if [[ -n $RESOLVED && $RESOLVED == "$MY_IP" ]]; then
        certbot --nginx -d "$PANEL_FQDN" \
            --non-interactive --agree-tos -m "$LETSENCRYPT_EMAIL" --redirect \
            && log "certificate issued" \
            || warn "certbot failed; the panel is still reachable over HTTP"
    else
        warn "DNS for ${PANEL_FQDN} resolves to '${RESOLVED:-nothing}', not ${MY_IP}."
        warn "Point the A record at ${MY_IP}, then run:"
        warn "  certbot --nginx -d ${PANEL_FQDN} -m ${LETSENCRYPT_EMAIL} --agree-tos --redirect"
    fi
else
    warn "LETSENCRYPT_EMAIL not set — skipping TLS. The panel is HTTP-only."
fi

log "panel installation complete: https://${PANEL_FQDN}"
log "credentials recorded in ${CRED_FILE}"
