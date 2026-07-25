#!/usr/bin/env bash
# Create (or manage) a Hetzner Cloud VM running the Campaign Shorts Autopilot,
# using only curl + the Hetzner Cloud API — no hcloud CLI or terraform needed.
#
#   export HCLOUD_TOKEN=...        # Hetzner console -> project -> Security -> API tokens (Read & Write)
#   ./provision.sh create          # ~1 min: creates VM + installs everything via cloud-init
#   ./provision.sh list            # show your servers (name, status, IP)
#   ./provision.sh delete NAME     # tear a server down
#
# Options via env: NAME (shorts-autopilot), TYPE (cpx21), LOCATION (fsn1),
# IMAGE (ubuntu-24.04), SSH_PUBKEY_FILE (~/.ssh/id_ed25519.pub or id_rsa.pub),
# REPO_URL / REPO_BRANCH (what the VM clones).

set -euo pipefail

API=https://api.hetzner.cloud/v1
NAME="${NAME:-shorts-autopilot}"
TYPE="${TYPE:-cpx21}"
LOCATION="${LOCATION:-fsn1}"
IMAGE="${IMAGE:-ubuntu-24.04}"
REPO_URL="${REPO_URL:-https://github.com/mackkm/test1.git}"
REPO_BRANCH="${REPO_BRANCH:-master}"
HERE="$(cd "$(dirname "$0")" && pwd)"

[ -n "${HCLOUD_TOKEN:-}" ] || { echo "HCLOUD_TOKEN is not set"; exit 1; }

hz() { # method path [json-body]
  local method=$1 path=$2 body=${3:-}
  curl -fsS -X "$method" "$API$path" \
    -H "Authorization: Bearer $HCLOUD_TOKEN" \
    ${body:+-H "Content-Type: application/json" -d "$body"}
}

json_escape() { node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(0,"utf8")))'; }

cmd_list() {
  hz GET /servers | node -e '
    const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
    for (const s of d.servers || [])
      console.log(`${s.name}\t${s.status}\t${s.public_net?.ipv4?.ip || "-"}\t${s.server_type?.name}\t${s.datacenter?.location?.name}`);
    if (!(d.servers || []).length) console.log("(no servers in this project)");'
}

cmd_delete() {
  local name=${1:?usage: provision.sh delete NAME}
  local id
  id=$(hz GET "/servers?name=$name" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.servers?.[0]?.id ?? ""))')
  [ -n "$id" ] || { echo "no server named $name"; exit 1; }
  hz DELETE "/servers/$id" >/dev/null
  echo "deleted $name (#$id)"
}

cmd_create() {
  # ssh key: register the local public key so you can ssh in (Hetzner also
  # emails a root password if no key is given, but keys are nicer)
  local ssh_ids="[]"
  local pub="${SSH_PUBKEY_FILE:-}"
  [ -z "$pub" ] && for f in ~/.ssh/id_ed25519.pub ~/.ssh/id_rsa.pub; do [ -f "$f" ] && pub="$f" && break; done
  if [ -n "$pub" ] && [ -f "$pub" ]; then
    local key fp keyname
    key=$(cat "$pub")
    keyname="autopilot-$(whoami)-$(hostname -s)"
    # reuse if already uploaded, else create
    local existing
    existing=$(hz GET "/ssh_keys?name=$keyname" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.ssh_keys?.[0]?.id ?? ""))')
    if [ -z "$existing" ]; then
      existing=$(hz POST /ssh_keys "{\"name\":\"$keyname\",\"public_key\":$(printf '%s' "$key" | json_escape)}" \
        | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.ssh_key.id))')
      echo "registered ssh key $keyname (#$existing)"
    fi
    ssh_ids="[$existing]"
  else
    echo "note: no ssh public key found — Hetzner will email a root password instead"
  fi

  local user_data
  user_data=$(sed -e "s|__REPO_URL__|$REPO_URL|" -e "s|__REPO_BRANCH__|$REPO_BRANCH|" "$HERE/cloud-init.yaml")

  echo "creating $NAME ($TYPE, $IMAGE, $LOCATION)…"
  local res id ip
  res=$(hz POST /servers "$(node -e '
    const [name,type,location,image,sshIds] = process.argv.slice(1);
    const user_data = require("fs").readFileSync(0, "utf8");
    process.stdout.write(JSON.stringify({name, server_type: type, location, image, ssh_keys: JSON.parse(sshIds), user_data}));
  ' "$NAME" "$TYPE" "$LOCATION" "$IMAGE" "$ssh_ids" <<<"$user_data")")
  id=$(printf '%s' "$res" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.server.id))')
  ip=$(printf '%s' "$res" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.server.public_net.ipv4.ip))')

  echo -n "waiting for server #$id to run"
  for _ in $(seq 1 30); do
    sleep 4
    local st
    st=$(hz GET "/servers/$id" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(d.server.status)')
    echo -n "."
    [ "$st" = "running" ] && break
  done
  echo

  cat <<EOF

──────────────────────────────────────────────────────────────
 $NAME is up at $ip — cloud-init is now installing the
 autopilot (~2 min). Then:

   ssh root@$ip
   nano /etc/autopilot.env        # add ANTHROPIC_API_KEY, NICHE, platform keys
   systemctl restart autopilot
   journalctl -fu autopilot       # watch: research -> render -> post

 Status JSON: http://$ip:3444/status
 Bootstrap log on the VM: /var/log/autopilot-bootstrap.log
──────────────────────────────────────────────────────────────
EOF
}

case "${1:-create}" in
  create) cmd_create ;;
  list) cmd_list ;;
  delete) shift; cmd_delete "$@" ;;
  *) echo "usage: provision.sh [create|list|delete NAME]"; exit 2 ;;
esac
