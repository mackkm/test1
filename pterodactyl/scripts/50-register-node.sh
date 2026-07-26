#!/usr/bin/env bash
# Register this host with the Panel and bring Wings online.
#
# Creates the location, node and port allocations through the Panel's
# application API, pulls the generated Wings configuration onto this host and
# starts the daemon.
#
# Requires: PANEL_URL, PTERO_APP_KEY (a ptla_… application key with read/write
#           on nodes, locations and allocations), NODE_NAME, NODE_FQDN
#
# Idempotent: safe to re-run.

. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_root
need_var PANEL_URL PTERO_APP_KEY NODE_NAME

command -v wings >/dev/null 2>&1 || die "wings is not installed — run 20-wings.sh first"

# Fall back to this host's own facts when the caller did not pin them.
export NODE_PUBLIC_IP=${NODE_PUBLIC_IP:-$(detect_public_ip)}
export NODE_FQDN=${NODE_FQDN:-$NODE_PUBLIC_IP}
export NODE_SCHEME=${NODE_SCHEME:-https}

if [[ -z ${NODE_MEMORY:-} ]]; then
    # Leave headroom for the host itself rather than promising every last MiB.
    total_mb=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
    NODE_MEMORY=$(( total_mb * 85 / 100 ))
    export NODE_MEMORY
    log "NODE_MEMORY not set — offering ${NODE_MEMORY} MiB (85% of ${total_mb} MiB)"
fi

if [[ -z ${NODE_DISK:-} ]]; then
    avail_mb=$(df -Pm /var/lib/pterodactyl 2>/dev/null | awk 'NR==2 {print $4}')
    [[ -n $avail_mb ]] || avail_mb=$(df -Pm / | awk 'NR==2 {print $4}')
    NODE_DISK=$(( avail_mb * 85 / 100 ))
    export NODE_DISK
    log "NODE_DISK not set — offering ${NODE_DISK} MiB (85% of ${avail_mb} MiB free)"
fi

export NODE_LOCATION=${NODE_LOCATION:-hetzner}
export GAME_PORT_RANGE=${GAME_PORT_RANGE:-25565-25700}

step "Registering '${NODE_NAME}' with ${PANEL_URL}"

python3 "$(dirname "${BASH_SOURCE[0]}")/ptero_register.py"

step "Starting Wings"
systemctl restart wings
sleep 4

if systemctl is-active --quiet wings; then
    log "wings is running and connected to ${PANEL_URL}"
else
    warn "wings did not come up. Recent log:"
    journalctl -u wings -n 40 --no-pager >&2 || true
    die "wings failed to start"
fi
