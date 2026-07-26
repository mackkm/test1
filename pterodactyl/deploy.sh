#!/usr/bin/env bash
# Orchestrate the Pterodactyl fleet over SSH.
#
#   ./deploy.sh nodes      install Docker + Wings on every node
#   ./deploy.sh panel      install Panel + Paymenter billing on the panel host
#   ./deploy.sh register   register every node with the panel and start Wings
#   ./deploy.sh all        nodes -> panel -> register, in the right order
#   ./deploy.sh status     report what is running where
#
# Settings come from ./config.env (copy config.env.example to start).
# Run this from a machine that can SSH to the hosts as root.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${CONFIG_FILE:-$SCRIPT_DIR/config.env}"
REMOTE_DIR=/opt/pterodactyl-deploy

if [[ -t 1 ]]; then
    C_BOLD=$'\033[1m'; C_RED=$'\033[31m'; C_YEL=$'\033[33m'
    C_GRN=$'\033[32m'; C_OFF=$'\033[0m'
else
    C_BOLD=''; C_RED=''; C_YEL=''; C_GRN=''; C_OFF=''
fi
log()  { printf '%s==>%s %s\n' "$C_GRN" "$C_OFF" "$*"; }
head_() { printf '\n%s########## %s ##########%s\n' "$C_BOLD" "$*" "$C_OFF"; }
warn() { printf '%s[warn]%s %s\n' "$C_YEL" "$C_OFF" "$*" >&2; }
die()  { printf '%s[fail]%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; exit 1; }

[[ -f $CONFIG_FILE ]] || die "no config at ${CONFIG_FILE} — copy config.env.example to config.env and edit it"
# shellcheck disable=SC1090
. "$CONFIG_FILE"

SSH_USER=${SSH_USER:-root}
SSH_KEY=${SSH_KEY:-}
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o BatchMode=yes)
[[ -n $SSH_KEY ]] && SSH_OPTS+=(-i "$SSH_KEY")

command -v ssh >/dev/null 2>&1 || die "ssh client not found"

# ---------------------------------------------------------------- node table

# Emits "name host fqdn" per configured node.
node_table() {
    printf '%s\n' "${NODES:-}" | while read -r name host fqdn _rest; do
        [[ -z ${name:-} || $name == \#* ]] && continue
        printf '%s %s %s\n' "$name" "$host" "${fqdn:-$host}"
    done
}

node_count() { node_table | grep -c . || true; }

# -------------------------------------------------------------- remote plumbing

# run_remote HOST SCRIPT [EXTRA_ENV_LINE...]
# Ships the scripts directory plus a rendered config.env, then executes SCRIPT.
run_remote() {
    local host=$1 script=$2
    shift 2
    local stage
    stage="$(mktemp -d)"

    cp -r "$SCRIPT_DIR/scripts" "$stage/scripts"
    {
        cat "$CONFIG_FILE"
        printf '\n# --- per-host overrides injected by deploy.sh ---\n'
        local line
        for line in "$@"; do printf '%s\n' "$line"; done
    } > "$stage/scripts/config.env"
    chmod 600 "$stage/scripts/config.env"

    tar -czf - -C "$stage" scripts \
        | ssh "${SSH_OPTS[@]}" "${SSH_USER}@${host}" "
            set -euo pipefail
            rm -rf ${REMOTE_DIR}
            mkdir -p ${REMOTE_DIR}
            tar -xzf - -C ${REMOTE_DIR}
            chmod 700 ${REMOTE_DIR}
            chmod +x ${REMOTE_DIR}/scripts/*.sh
            bash ${REMOTE_DIR}/scripts/${script}
          "
    local rc=$?
    rm -rf "$stage"
    return $rc
}

ssh_probe() {
    ssh "${SSH_OPTS[@]}" "${SSH_USER}@$1" true 2>/dev/null
}

preflight() {
    local failed=0 host
    log "checking SSH reachability"
    while read -r _name host _fqdn; do
        if ssh_probe "$host"; then
            printf '    %-18s ok\n' "$host"
        else
            printf '    %-18s %sUNREACHABLE%s\n' "$host" "$C_RED" "$C_OFF"
            failed=1
        fi
    done < <(node_table)
    if [[ -n ${PANEL_HOST:-} ]]; then
        if ssh_probe "$PANEL_HOST"; then
            printf '    %-18s ok (panel)\n' "$PANEL_HOST"
        else
            printf '    %-18s %sUNREACHABLE%s (panel)\n' "$PANEL_HOST" "$C_RED" "$C_OFF"
            failed=1
        fi
    fi
    (( failed == 0 )) || die "fix SSH access before continuing"
}

# ------------------------------------------------------------------- commands

cmd_nodes() {
    (( $(node_count) > 0 )) || die "no NODES configured in ${CONFIG_FILE}"
    while read -r name host fqdn; do
        head_ "Wings on ${name} (${host})"
        run_remote "$host" 10-common.sh "HOST_ROLE=node"
        run_remote "$host" 20-wings.sh  "HOST_ROLE=node"
    done < <(node_table)
}

cmd_panel() {
    [[ -n ${PANEL_HOST:-} ]] || die "PANEL_HOST is not set in ${CONFIG_FILE}"
    head_ "Panel on ${PANEL_HOST}"
    run_remote "$PANEL_HOST" 10-common.sh "HOST_ROLE=panel"
    run_remote "$PANEL_HOST" 30-panel.sh  "HOST_ROLE=panel"

    if [[ ${INSTALL_BILLING:-true} == true ]]; then
        head_ "Billing (Paymenter) on ${PANEL_HOST}"
        run_remote "$PANEL_HOST" 40-billing.sh "HOST_ROLE=panel"
    fi

    if [[ ${PANEL_HOST_IS_NODE:-true} == true ]]; then
        head_ "Wings on the panel host"
        run_remote "$PANEL_HOST" 20-wings.sh "HOST_ROLE=panel"
    fi

    cat <<EOF

${C_BOLD}Next step${C_OFF}: create an application API key in the panel
  ${PANEL_URL:-https://$PANEL_FQDN}/admin/api  ->  create key with read/write on
  "Nodes", "Locations" and "Allocations"
Put it in ${CONFIG_FILE} as PTERO_APP_KEY=ptla_… then run: ./deploy.sh register
EOF
}

cmd_register() {
    [[ -n ${PTERO_APP_KEY:-} ]] || die "PTERO_APP_KEY is not set — create one at ${PANEL_URL:-the panel}/admin/api"
    [[ -n ${PANEL_URL:-} ]] || die "PANEL_URL is not set in ${CONFIG_FILE}"

    while read -r name host fqdn; do
        head_ "Registering ${name} (${host})"
        run_remote "$host" 50-register-node.sh \
            "NODE_NAME=${name}" \
            "NODE_FQDN=${fqdn}" \
            "NODE_PUBLIC_IP=${host}"
    done < <(node_table)

    if [[ ${PANEL_HOST_IS_NODE:-true} == true && -n ${PANEL_HOST:-} ]]; then
        head_ "Registering the panel host as a node"
        run_remote "$PANEL_HOST" 50-register-node.sh \
            "NODE_NAME=${PANEL_NODE_NAME:-ptero-node-panel}" \
            "NODE_FQDN=${PANEL_NODE_FQDN:-$PANEL_FQDN}" \
            "NODE_PUBLIC_IP=${PANEL_HOST}"
    fi
}

cmd_status() {
    local check='
      printf "  os      : %s\n" "$(. /etc/os-release && echo "$PRETTY_NAME")"
      printf "  docker  : %s\n" "$(docker --version 2>/dev/null || echo not installed)"
      printf "  wings   : %s\n" "$(wings --version 2>/dev/null | head -1 || echo not installed)"
      printf "  wings up: %s\n" "$(systemctl is-active wings 2>/dev/null || echo n/a)"
      printf "  config  : %s\n" "$([ -f /etc/pterodactyl/config.yml ] && echo present || echo missing)"
    '
    while read -r name host _fqdn; do
        head_ "${name} (${host})"
        ssh "${SSH_OPTS[@]}" "${SSH_USER}@${host}" "$check" 2>/dev/null || warn "unreachable"
    done < <(node_table)

    if [[ -n ${PANEL_HOST:-} ]]; then
        head_ "panel (${PANEL_HOST})"
        ssh "${SSH_OPTS[@]}" "${SSH_USER}@${PANEL_HOST}" "
            $check
            printf '  panel   : %s\n' \"\$(systemctl is-active pteroq 2>/dev/null || echo n/a)\"
            printf '  billing : %s\n' \"\$(systemctl is-active paymenter 2>/dev/null || echo n/a)\"
            printf '  nginx   : %s\n' \"\$(systemctl is-active nginx 2>/dev/null || echo n/a)\"
        " 2>/dev/null || warn "unreachable"
    fi
}

cmd_all() {
    preflight
    cmd_nodes
    cmd_panel
    warn "stopping before 'register': the panel needs an application API key first."
    warn "Add PTERO_APP_KEY to ${CONFIG_FILE}, then run: ./deploy.sh register"
}

case "${1:-}" in
    nodes)     preflight; cmd_nodes ;;
    panel)     preflight; cmd_panel ;;
    register)  preflight; cmd_register ;;
    status)    cmd_status ;;
    all)       cmd_all ;;
    *)
        sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
        exit 1
        ;;
esac
