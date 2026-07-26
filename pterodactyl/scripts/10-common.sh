#!/usr/bin/env bash
# Base preparation shared by every host in the fleet (panel and nodes alike).
#
# Idempotent: safe to re-run.

. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_root
require_debian_family

TIMEZONE=${TIMEZONE:-UTC}

step "Base system preparation ($(os_id) $(os_codename))"

apt_refresh
apt_install \
    ca-certificates curl gnupg tar unzip git jq \
    software-properties-common apt-transport-https \
    python3 python3-yaml cron

log "setting timezone to ${TIMEZONE}"
timedatectl set-timezone "$TIMEZONE" 2>/dev/null || warn "could not set timezone"

systemctl enable --now cron >/dev/null 2>&1 || true

# Pterodactyl needs kernel memory + swap accounting to enforce per-server limits.
# cgroup v2 (Ubuntu 22.04+ default) accounts for swap out of the box; only the
# legacy cgroup v1 hierarchy needs the GRUB flag, which costs a reboot.
if [[ ! -d /sys/fs/cgroup/system.slice ]] && ! grep -q 'swapaccount=1' /proc/cmdline; then
    warn "host is on cgroup v1 without swap accounting."
    warn "add 'swapaccount=1' to GRUB_CMDLINE_LINUX_DEFAULT, run update-grub, and reboot"
    warn "for per-server swap limits to work."
fi

# Optional host firewall. Hetzner Cloud Firewalls already fence these hosts, so
# this stays opt-in — enabling ufw incorrectly is an easy way to lock yourself out.
if [[ ${ENABLE_UFW:-false} == true ]]; then
    step "Configuring ufw"
    apt_install ufw
    ufw allow 22/tcp comment 'ssh'          # always first, before enabling
    if [[ ${HOST_ROLE:-node} == panel ]]; then
        ufw allow 80/tcp  comment 'http'
        ufw allow 443/tcp comment 'https'
    fi
    ufw allow 8080/tcp comment 'wings api'
    ufw allow 2022/tcp comment 'wings sftp'
    # ufw wants low:high where the rest of the config uses low-high.
    ufw_range="${GAME_PORT_RANGE:-25565-25700}"
    ufw_range="${ufw_range//-/:}"
    ufw allow "${ufw_range}/tcp" comment 'game servers'
    ufw allow "${ufw_range}/udp" comment 'game servers'
    ufw --force enable
fi

log "base preparation complete"
