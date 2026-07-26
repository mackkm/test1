#!/usr/bin/env bash
# Shared helpers for the Pterodactyl deployment scripts.
#
# Every 10-/20-/30-/40-/50- script sources this file. It is intentionally
# dependency-free so it can run on a freshly booted Hetzner Ubuntu image
# before anything has been installed.

[[ -n "${_PTERO_LIB_SOURCED:-}" ]] && return 0
_PTERO_LIB_SOURCED=1

set -euo pipefail

PTERO_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PTERO_LIB_DIR

# deploy.sh ships a rendered config.env alongside the scripts; cloud-init writes
# the same file. Sourcing it here means every script gets the same settings.
if [[ -f "$PTERO_LIB_DIR/config.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    . "$PTERO_LIB_DIR/config.env"
    set +a
fi

if [[ -t 1 ]]; then
    C_BOLD=$'\033[1m'; C_RED=$'\033[31m'; C_YEL=$'\033[33m'
    C_GRN=$'\033[32m'; C_OFF=$'\033[0m'
else
    C_BOLD=''; C_RED=''; C_YEL=''; C_GRN=''; C_OFF=''
fi

log()  { printf '%s==>%s %s\n' "$C_GRN" "$C_OFF" "$*"; }
step() { printf '\n%s=== %s ===%s\n' "$C_BOLD" "$*" "$C_OFF"; }
warn() { printf '%s[warn]%s %s\n' "$C_YEL" "$C_OFF" "$*" >&2; }
die()  { printf '%s[fail]%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; exit 1; }

require_root() {
    [[ ${EUID:-$(id -u)} -eq 0 ]] || die "this script must run as root"
}

# need_var VAR [VAR...] — abort unless every named variable is non-empty.
need_var() {
    local name missing=()
    for name in "$@"; do
        [[ -n "${!name:-}" ]] || missing+=("$name")
    done
    (( ${#missing[@]} == 0 )) || die "required setting(s) not set: ${missing[*]}"
}

# retry ATTEMPTS CMD... — exponential backoff, mainly for flaky apt/network.
retry() {
    local attempts=$1; shift
    local i=1 delay=2
    until "$@"; do
        if (( i >= attempts )); then
            die "command failed after ${attempts} attempts: $*"
        fi
        warn "attempt ${i}/${attempts} failed; retrying in ${delay}s"
        sleep "$delay"
        delay=$(( delay * 2 )); i=$(( i + 1 ))
    done
}

# Wait out cloud-init / unattended-upgrades holding the dpkg lock.
wait_for_apt() {
    local waited=0
    while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 \
       || fuser /var/lib/apt/lists/lock >/dev/null 2>&1; do
        (( waited == 0 )) && log "waiting for another apt/dpkg process to finish"
        sleep 5
        waited=$(( waited + 5 ))
        (( waited < 900 )) || die "timed out waiting for the dpkg lock"
    done
}

apt_refresh() {
    export DEBIAN_FRONTEND=noninteractive
    wait_for_apt
    retry 4 apt-get update -y
}

apt_install() {
    export DEBIAN_FRONTEND=noninteractive
    wait_for_apt
    retry 4 apt-get install -y \
        -o Dpkg::Options::=--force-confold \
        -o Dpkg::Options::=--force-confdef "$@"
}

rand_pw() {
    local len=${1:-32}
    tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "$len"
    echo
}

# write_file PATH [MODE] — content on stdin, written atomically.
# Sets FILE_CHANGED=yes|no so callers can decide whether to restart a service.
FILE_CHANGED=no
write_file() {
    local path=$1 mode=${2:-0644} tmp
    tmp="$(mktemp)"
    cat > "$tmp"
    if [[ -f $path ]] && cmp -s "$tmp" "$path"; then
        rm -f "$tmp"
        FILE_CHANGED=no
    else
        install -D -m "$mode" "$tmp" "$path"
        rm -f "$tmp"
        FILE_CHANGED=yes
    fi
    return 0
}

# Idempotent crontab line for a given user.
ensure_cron() {
    local user=$1 line=$2 current
    current="$(crontab -u "$user" -l 2>/dev/null || true)"
    if ! printf '%s\n' "$current" | grep -Fqx "$line"; then
        printf '%s\n%s\n' "$current" "$line" | sed '/^$/d' | crontab -u "$user" -
        log "installed cron entry for ${user}"
    fi
}

CRED_FILE=${CRED_FILE:-/root/pterodactyl-credentials.txt}

# Record a generated secret so the operator can retrieve it later.
save_cred() {
    umask 077
    touch "$CRED_FILE"
    chmod 600 "$CRED_FILE"
    printf '%s\n' "$*" >> "$CRED_FILE"
}

# Remember a generated password across re-runs so the script stays idempotent.
# usage: value="$(persist_secret KEY [LENGTH])"
persist_secret() {
    local key=$1 len=${2:-32} store=/root/.pterodactyl-secrets value
    umask 077
    touch "$store"; chmod 600 "$store"
    value="$(awk -F= -v k="$key" '$1==k {sub(/^[^=]*=/,""); print; exit}' "$store")"
    if [[ -z $value ]]; then
        value="$(rand_pw "$len")"
        printf '%s=%s\n' "$key" "$value" >> "$store"
    fi
    printf '%s' "$value"
}

os_id()      { . /etc/os-release && printf '%s' "$ID"; }
os_codename() { . /etc/os-release && printf '%s' "${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"; }

require_debian_family() {
    local id; id="$(os_id)"
    [[ $id == ubuntu || $id == debian ]] \
        || die "unsupported distribution '${id}'; these scripts target Ubuntu/Debian"
}

# Public IPv4 of this host, used for Wings allocations.
detect_public_ip() {
    local ip
    ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')" || true
    [[ -n $ip ]] || ip="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
    printf '%s' "$ip"
}
