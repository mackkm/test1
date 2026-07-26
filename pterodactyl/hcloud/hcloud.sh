#!/usr/bin/env bash
# Hetzner Cloud provisioning for the Pterodactyl fleet.
#
# Talks to the Hetzner REST API with curl — no hcloud CLI or Terraform needed.
#
#   ./hcloud.sh list           inventory servers, SSH keys and firewalls
#   ./hcloud.sh create-panel   create the Panel/billing server and bootstrap it
#   ./hcloud.sh firewall       create and attach the Pterodactyl firewalls
#   ./hcloud.sh bootstrap-log  tail the cloud-init bootstrap log (needs SSH)
#
# Requires HCLOUD_TOKEN in the environment. Settings come from ../config.env.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT_DIR="$(dirname "$HERE")"
CONFIG_FILE="${CONFIG_FILE:-$KIT_DIR/config.env}"
API=https://api.hetzner.cloud/v1

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

[[ -n ${HCLOUD_TOKEN:-} ]] || die "HCLOUD_TOKEN is not set"
command -v curl    >/dev/null || die "curl is required"
command -v python3 >/dev/null || die "python3 is required"

if [[ -f $CONFIG_FILE ]]; then
    # shellcheck disable=SC1090
    . "$CONFIG_FILE"
else
    warn "no ${CONFIG_FILE}; create-panel needs it"
fi

# ------------------------------------------------------------------- API glue

api() {
    local method=$1 path=$2 data=${3:-} out code
    out="$(mktemp)"
    if [[ -n $data ]]; then
        code="$(curl -sS -o "$out" -w '%{http_code}' -X "$method" \
            -H "Authorization: Bearer ${HCLOUD_TOKEN}" \
            -H 'Content-Type: application/json' \
            -d "$data" "${API}${path}")"
    else
        code="$(curl -sS -o "$out" -w '%{http_code}' -X "$method" \
            -H "Authorization: Bearer ${HCLOUD_TOKEN}" "${API}${path}")"
    fi
    if [[ $code -ge 400 ]]; then
        printf '%s[fail]%s %s %s -> HTTP %s\n' "$C_RED" "$C_OFF" "$method" "$path" "$code" >&2
        cat "$out" >&2; echo >&2
        rm -f "$out"
        exit 1
    fi
    cat "$out"; rm -f "$out"
}

# Run a python snippet with the response already parsed into `d`.
# The snippet is placed on its own line so loops and multi-line code work.
jqp() {
    python3 -c "
import sys, json
d = json.load(sys.stdin)
$1
"
}

# --------------------------------------------------------------------- config

PANEL_SERVER_NAME=${PANEL_SERVER_NAME:-pterodactyl-panel}
PANEL_SERVER_TYPE=${PANEL_SERVER_TYPE:-cpx62}
PANEL_SERVER_IMAGE=${PANEL_SERVER_IMAGE:-ubuntu-24.04}
PANEL_SERVER_LOCATION=${PANEL_SERVER_LOCATION:-nbg1}
GAME_PORT_RANGE=${GAME_PORT_RANGE:-25565-25700}

# ------------------------------------------------------------------ cmd: list

cmd_list() {
    step "Servers"
    api GET '/servers?per_page=50' | jqp '
for s in d["servers"]:
    t = s["server_type"]
    ip = (s.get("public_net") or {}).get("ipv4") or {}
    print("  %-24s %-8s %2sc/%sGB/%sGB  %-15s %s" % (
        s["name"], t["name"], t["cores"], t["memory"], t["disk"],
        ip.get("ip"), s["status"]))
'
    step "SSH keys"
    api GET '/ssh_keys' | jqp 'for k in d["ssh_keys"]: print("  %-12s %s" % (k["id"], k["name"]))'
    step "Firewalls"
    api GET '/firewalls' | jqp '
for f in d["firewalls"]:
    print("  %-12s %-24s applied to %d resource(s)" % (f["id"], f["name"], len(f.get("applied_to") or [])))
'
}

# -------------------------------------------------------------- cmd: firewall

# Rule sets are declared as JSON so the API payload stays readable.
firewall_rules_node() {
    local range="${GAME_PORT_RANGE/-/-}"
    cat <<JSON
[
  {"direction":"in","protocol":"tcp","port":"22","source_ips":["0.0.0.0/0","::/0"],"description":"ssh"},
  {"direction":"in","protocol":"tcp","port":"8080","source_ips":["0.0.0.0/0","::/0"],"description":"wings api"},
  {"direction":"in","protocol":"tcp","port":"2022","source_ips":["0.0.0.0/0","::/0"],"description":"wings sftp"},
  {"direction":"in","protocol":"tcp","port":"443","source_ips":["0.0.0.0/0","::/0"],"description":"wings tls / certbot"},
  {"direction":"in","protocol":"tcp","port":"80","source_ips":["0.0.0.0/0","::/0"],"description":"panel http / certbot http-01"},
  {"direction":"in","protocol":"tcp","port":"8081","source_ips":["0.0.0.0/0","::/0"],"description":"billing (bare-IP fallback port)"},
  {"direction":"in","protocol":"tcp","port":"${range}","source_ips":["0.0.0.0/0","::/0"],"description":"game servers tcp"},
  {"direction":"in","protocol":"udp","port":"${range}","source_ips":["0.0.0.0/0","::/0"],"description":"game servers udp"},
  {"direction":"in","protocol":"icmp","source_ips":["0.0.0.0/0","::/0"],"description":"icmp"}
]
JSON
}

# name -> id, empty when absent
firewall_id() {
    api GET '/firewalls' | jqp "
import sys
m = {f['name']: f['id'] for f in d['firewalls']}
sys.stdout.write(str(m.get('$1', '')))
"
}

cmd_firewall() {
    local name=${PTERO_FIREWALL_NAME:-pterodactyl-fleet}
    local rules; rules="$(firewall_rules_node)"
    local id; id="$(firewall_id "$name")"

    if [[ -z $id ]]; then
        step "Creating firewall '${name}'"
        id="$(api POST /firewalls "$(python3 -c '
import json, sys
print(json.dumps({"name": sys.argv[1], "rules": json.loads(sys.argv[2])}))' "$name" "$rules")" \
            | jqp 'print(d["firewall"]["id"])')"
        log "created firewall id=${id}"
    else
        step "Updating rules on firewall '${name}' (id=${id})"
        api POST "/firewalls/${id}/actions/set_rules" \
            "$(python3 -c 'import json,sys; print(json.dumps({"rules": json.loads(sys.argv[1])}))' "$rules")" \
            >/dev/null
        log "rules updated"
    fi

    step "Attaching firewall to servers"
    # A Hetzner Cloud Firewall default-denies everything it does not name, so
    # attaching it to an unrelated server silently blackholes that server's own
    # services. Only fleet-labelled servers are touched unless '--all' is given.
    local ids
    if [[ ${1:-} == --all ]]; then
        warn "--all: attaching to EVERY server in this project."
        warn "Any port not in the rule list above will be blocked on those hosts."
        ids="$(api GET '/servers?per_page=50' | jqp 'print(" ".join(str(s["id"]) for s in d["servers"]))')"
    else
        ids="$(api GET '/servers?per_page=50&label_selector=managed-by%3Dpterodactyl-kit' \
            | jqp 'print(" ".join(str(s["id"]) for s in d["servers"]))')"
        log "targeting servers labelled managed-by=pterodactyl-kit"
        log "(pass --all to include pre-existing servers — read the warning first)"
    fi
    [[ -n $ids ]] || { warn "no matching servers in this project"; return 0; }

    local payload
    payload="$(python3 -c '
import json, sys
ids = [int(x) for x in sys.argv[1].split()]
print(json.dumps({"apply_to": [{"type": "server", "server": {"id": i}} for i in ids]}))' "$ids")"
    api POST "/firewalls/${id}/actions/apply_to_resources" "$payload" >/dev/null
    log "attached to $(wc -w <<<"$ids") server(s)"
    warn "port 22 is open to the world; narrow the ssh rule to your own IP if you can"
}

# --------------------------------------------------------- cmd: create-panel

build_user_data() {
    # cloud-init that carries the whole scripts directory inline, so the server
    # bootstraps itself with no inbound SSH from the operator.
    local payload
    payload="$(tar -czf - -C "$KIT_DIR" \
        --exclude='__pycache__' --exclude='config.env' scripts | base64 -w0)"

    local rendered_config
    rendered_config="$(sed 's/^/      /' "$CONFIG_FILE")"

    cat <<CLOUDINIT
#cloud-config
package_update: true
write_files:
  - path: /opt/pterodactyl-deploy/payload.b64
    permissions: '0600'
    content: ${payload}
  - path: /opt/pterodactyl-deploy/config.env
    permissions: '0600'
    content: |
${rendered_config}
  - path: /opt/pterodactyl-deploy/bootstrap.sh
    permissions: '0700'
    content: |
      #!/usr/bin/env bash
      set -euo pipefail
      cd /opt/pterodactyl-deploy
      base64 -d payload.b64 | tar -xzf -
      cp config.env scripts/config.env
      chmod 600 scripts/config.env
      chmod +x scripts/*.sh
      set -a; . ./config.env; set +a
      export HOST_ROLE=panel

      # Optional progress publishing. Provisioning happens with no inbound SSH,
      # so a stalled install is otherwise invisible. The log is copied into the
      # web roots and served by nginx on port 80 — deliberately not a separate
      # port, because operators behind restrictive egress often cannot reach
      # anything but 80/443. Removed again after a successful run.
      mkdir -p /run/ptero-status
      exec > >(tee -a /run/ptero-status/bootstrap.log) 2>&1

      if [ "\${BOOTSTRAP_PUBLISH_LOG:-false}" = "true" ]; then
        echo "publishing install log at http://<host>/bootstrap.log"
        mkdir -p /var/www/html
        publish_loop() {
          while true; do
            for root in /var/www/html /var/www/pterodactyl/public; do
              [ -d "\$root" ] || continue
              cp /run/ptero-status/bootstrap.log "\$root/bootstrap.log" 2>/dev/null || true
              cp /var/log/cloud-init-output.log "\$root/cloud-init.log" 2>/dev/null || true
            done
            sleep 5
          done
        }
        publish_loop &
        PUBLISH_PID=\$!
        finish() {
          rc=\$?
          echo "=== bootstrap finished with exit code \${rc} ==="
          sleep 8
          if [ "\$rc" -eq 0 ]; then
            kill "\$PUBLISH_PID" 2>/dev/null || true
            rm -f /var/www/html/bootstrap.log /var/www/html/cloud-init.log \\
                  /var/www/pterodactyl/public/bootstrap.log \\
                  /var/www/pterodactyl/public/cloud-init.log
          else
            echo "=== leaving the log published so the failure can be read ==="
          fi
        }
        trap finish EXIT
      fi

      bash scripts/10-common.sh
      bash scripts/30-panel.sh
      if [ "\${INSTALL_BILLING:-true}" = "true" ]; then bash scripts/40-billing.sh; fi
      bash scripts/20-wings.sh
      touch /opt/pterodactyl-deploy/.bootstrap-complete
runcmd:
  - [ bash, -lc, "/opt/pterodactyl-deploy/bootstrap.sh >> /var/log/pterodactyl-bootstrap.log 2>&1" ]
CLOUDINIT
}

cmd_create_panel() {
    [[ -f $CONFIG_FILE ]] || die "need ${CONFIG_FILE} — copy config.env.example and edit it"

    local existing
    existing="$(api GET "/servers?name=${PANEL_SERVER_NAME}" \
        | jqp 'print(d["servers"][0]["id"] if d["servers"] else "")')"
    if [[ -n $existing ]]; then
        warn "server '${PANEL_SERVER_NAME}' already exists (id=${existing}) — nothing to do"
        api GET "/servers/${existing}" | jqp '
s = d["server"]
print("  ip     :", (s.get("public_net") or {}).get("ipv4", {}).get("ip"))
print("  status :", s["status"])
'
        return 0
    fi

    step "Building cloud-init payload"
    local user_data size
    user_data="$(build_user_data)"
    size=${#user_data}
    log "user_data is ${size} bytes"
    (( size < 32000 )) || die "user_data is ${size} bytes; Hetzner caps it at 32 KiB. Trim the scripts directory."

    step "Creating ${PANEL_SERVER_TYPE} '${PANEL_SERVER_NAME}' in ${PANEL_SERVER_LOCATION}"
    local ssh_key_ids payload
    ssh_key_ids="$(api GET '/ssh_keys' | jqp 'print(",".join(str(k["id"]) for k in d["ssh_keys"]))')"
    [[ -n $ssh_key_ids ]] || warn "no SSH keys in this project — you will not be able to log in"

    # user_data goes via a temp file: the python script itself already occupies
    # stdin, so it cannot be piped in.
    local ud_file
    ud_file="$(mktemp)"
    printf '%s\n' "$user_data" > "$ud_file"

    payload="$(python3 - "$PANEL_SERVER_NAME" "$PANEL_SERVER_TYPE" "$PANEL_SERVER_IMAGE" \
                          "$PANEL_SERVER_LOCATION" "$ssh_key_ids" "$ud_file" <<'PY'
import json, sys
name, stype, image, location, keys, ud_path = sys.argv[1:7]
with open(ud_path, encoding="utf-8") as handle:
    user_data = handle.read()
body = {
    "name": name,
    "server_type": stype,
    "image": image,
    "location": location,
    "start_after_create": True,
    "public_net": {"enable_ipv4": True, "enable_ipv6": True},
    "labels": {"role": "pterodactyl-panel", "managed-by": "pterodactyl-kit"},
    "user_data": user_data,
}
if keys:
    body["ssh_keys"] = [int(k) for k in keys.split(",") if k]
print(json.dumps(body))
PY
)"
    rm -f "$ud_file"

    local created id ip
    created="$(api POST /servers "$payload")"
    id="$(jqp 'print(d["server"]["id"])' <<<"$created")"
    ip="$(jqp 'print((d["server"].get("public_net") or {}).get("ipv4", {}).get("ip"))' <<<"$created")"
    log "created server id=${id} ip=${ip}"

    step "Waiting for the server to boot"
    local status
    for _ in $(seq 1 60); do
        status="$(api GET "/servers/${id}" | jqp 'print(d["server"]["status"])')"
        [[ $status == running ]] && break
        sleep 5
    done
    log "status: ${status}"

    cat <<EOF

${C_BOLD}Server is up.${C_OFF} cloud-init is now installing the panel and billing stack;
that takes roughly 5-10 minutes.

  ip      : ${ip}
  follow  : ssh root@${ip} 'tail -f /var/log/pterodactyl-bootstrap.log'
  done when: /opt/pterodactyl-deploy/.bootstrap-complete exists
  creds   : ssh root@${ip} 'cat /root/pterodactyl-credentials.txt'

Point these DNS A records at ${ip} before the TLS step can succeed:
  ${PANEL_FQDN:-panel.example.com}
  ${BILLING_FQDN:-billing.example.com}
  ${PANEL_NODE_FQDN:-node-panel.example.com}
EOF
}

cmd_bootstrap_log() {
    local ip=${1:-${PANEL_HOST:-}}
    [[ -n $ip ]] || die "usage: ./hcloud.sh bootstrap-log <ip>"
    ssh -o StrictHostKeyChecking=accept-new "root@${ip}" \
        'tail -f /var/log/pterodactyl-bootstrap.log'
}

case "${1:-}" in
    list)          cmd_list ;;
    firewall)      shift; cmd_firewall "$@" ;;
    create-panel)  cmd_create_panel ;;
    bootstrap-log) shift; cmd_bootstrap_log "$@" ;;
    *)
        sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
        exit 1
        ;;
esac
