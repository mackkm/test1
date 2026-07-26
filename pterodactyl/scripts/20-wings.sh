#!/usr/bin/env bash
# Install Docker and the Pterodactyl Wings daemon.
#
# This installs the daemon only. Wings cannot start until it has a config.yml
# issued by a Panel, so the service is enabled but left stopped when no config
# is present yet. Run 50-register-node.sh (or paste the Panel's configuration)
# to finish the job.
#
# Idempotent: safe to re-run.

. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_root
require_debian_family

step "Installing Docker"

if command -v docker >/dev/null 2>&1; then
    log "docker already present ($(docker --version))"
else
    retry 3 bash -c 'curl -fsSL https://get.docker.com/ | CHANNEL=stable bash'
fi
systemctl enable --now docker

# Keep container logs from filling the disk on a busy game node.
write_file /etc/docker/daemon.json 0644 <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "20m",
    "max-file": "3"
  },
  "live-restore": true
}
JSON
if [[ $FILE_CHANGED == yes ]]; then
    log "docker daemon.json updated; restarting docker"
    systemctl restart docker
fi

step "Installing Wings"

install -d -m 0755 /etc/pterodactyl /var/log/pterodactyl
install -d -m 0700 /var/lib/pterodactyl/volumes

case "$(uname -m)" in
    x86_64)          WINGS_ARCH=amd64 ;;
    aarch64|arm64)   WINGS_ARCH=arm64 ;;
    *)               die "unsupported architecture: $(uname -m)" ;;
esac

WINGS_URL="https://github.com/pterodactyl/wings/releases/latest/download/wings_linux_${WINGS_ARCH}"
log "downloading wings (${WINGS_ARCH})"
retry 3 curl -fsSL -o /usr/local/bin/wings.new "$WINGS_URL"
chmod u+x /usr/local/bin/wings.new

if [[ -x /usr/local/bin/wings ]] && cmp -s /usr/local/bin/wings.new /usr/local/bin/wings; then
    rm -f /usr/local/bin/wings.new
    log "wings already at the latest release ($(/usr/local/bin/wings --version 2>/dev/null | head -1))"
else
    mv /usr/local/bin/wings.new /usr/local/bin/wings
    chmod u+x /usr/local/bin/wings
    log "installed wings $(/usr/local/bin/wings --version 2>/dev/null | head -1)"
    WINGS_UPDATED=yes
fi

write_file /etc/systemd/system/wings.service 0644 <<'UNIT'
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
UNIT
[[ $FILE_CHANGED == yes ]] && systemctl daemon-reload

systemctl enable wings >/dev/null

if [[ -f /etc/pterodactyl/config.yml ]]; then
    log "config.yml present — (re)starting wings"
    systemctl restart wings
    sleep 3
    systemctl is-active --quiet wings \
        && log "wings is running" \
        || warn "wings failed to start; check: journalctl -u wings -n 50"
elif [[ -n ${PANEL_URL:-} && -n ${PTERO_APP_KEY:-} ]]; then
    log "no config.yml yet — run 50-register-node.sh to register this node with the panel"
else
    log "no config.yml yet — paste the node configuration from the Panel into"
    log "/etc/pterodactyl/config.yml, then: systemctl restart wings"
fi

log "wings installation complete${WINGS_UPDATED:+ (binary updated)}"
