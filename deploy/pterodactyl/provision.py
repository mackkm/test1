#!/usr/bin/env python3
"""Provision Pterodactyl nodes + allocations via the Panel's Application API.

Two modes:

SELF mode (SELF=1) - run ON a wings VM (wings-node/install.sh does this for
you): detects the VM's own public IP, registers this machine as a node with
an sslip.io hostname (or NODE_FQDN), creates its allocations, fetches its
Wings config, and writes it to WRITE_CONFIG (default
/etc/pterodactyl/config.yml). Set CO_LOCATED=1 on the panel VM itself.
  Required: PANEL_URL, APP_API_KEY

Fleet mode (default) - run anywhere with HTTPS access to the panel: creates
a location, one node per VM, and allocations, then prints a single-paste
install command per VM with that node's Wings config embedded.

Required env vars (fleet mode):
  PANEL_URL      e.g. https://panel.example.com
  APP_API_KEY    Application API key (ptla_...), all read/write permissions
  NODE_A_FQDN    node-a.example.com   (the Panel VM itself, behind Caddy)
  NODE_A_IP      public IP of VM A
  NODE_B_FQDN / NODE_B_IP / NODE_C_FQDN / NODE_C_IP   (omit any you don't have)

Optional env vars:
  GAME_PORTS     default 25565-25665
  NODE_RAM_MB    per-node allocatable RAM, default 30720 (30 GB of 32)
  NODE_DISK_MB   per-node allocatable disk, default 550000 (~550 GB of 640)
  ACME_EMAIL     baked into the printed VM B/C commands
  LOCATION       location short-code, default "hetzner"

Example:
  PANEL_URL=https://panel.example.com APP_API_KEY=ptla_xxx \
  NODE_A_FQDN=node-a.example.com NODE_A_IP=1.2.3.4 \
  NODE_B_FQDN=node-b.example.com NODE_B_IP=5.6.7.8 \
  NODE_C_FQDN=node-c.example.com NODE_C_IP=9.10.11.12 \
  ./provision.py
"""
import base64
import json
import os
import sys
import urllib.error
import urllib.request

PANEL_URL = os.environ.get("PANEL_URL", "").rstrip("/")
API_KEY = os.environ.get("APP_API_KEY", "")
if not PANEL_URL or not API_KEY:
    sys.exit("Set PANEL_URL and APP_API_KEY (see header of this script).")

GAME_PORTS = os.environ.get("GAME_PORTS", "25565-25665").replace(":", "-")
RAM_MB = int(os.environ.get("NODE_RAM_MB", "30720"))
DISK_MB = int(os.environ.get("NODE_DISK_MB", "550000"))
ACME_EMAIL = os.environ.get("ACME_EMAIL", "you@example.com")
LOCATION = os.environ.get("LOCATION", "hetzner")


def api(method, path, payload=None):
    req = urllib.request.Request(
        f"{PANEL_URL}/api/application{path}",
        method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/vnd.pterodactyl.v1+json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read()
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        raise RuntimeError(f"{method} {path} -> HTTP {e.code}: {detail}") from e


def find_or_create_location():
    for loc in api("GET", "/locations?per_page=100")["data"]:
        if loc["attributes"]["short"] == LOCATION:
            return loc["attributes"]["id"]
    created = api("POST", "/locations", {"short": LOCATION, "long": "Hetzner Cloud"})
    return created["attributes"]["id"]


def find_or_create_node(name, fqdn, location_id, behind_proxy):
    for node in api("GET", "/nodes?per_page=100")["data"]:
        if node["attributes"]["name"] == name:
            print(f"  node {name}: already exists (id {node['attributes']['id']})")
            return node["attributes"]["id"]
    payload = {
        "name": name,
        "location_id": location_id,
        "fqdn": fqdn,
        "scheme": "https",
        "behind_proxy": behind_proxy,
        "public": True,
        "memory": RAM_MB,
        "memory_overallocate": 0,
        "disk": DISK_MB,
        "disk_overallocate": 0,
        "upload_size": 100,
        # Behind Caddy the public daemon port is 443 (Caddy -> wings :8080);
        # standalone nodes serve TLS themselves directly on 8080.
        "daemon_listen": 443 if behind_proxy else 8080,
        "daemon_sftp": 2022,
        "daemon_base": "/var/lib/pterodactyl/volumes",
    }
    created = api("POST", "/nodes", payload)
    print(f"  node {name}: created (id {created['attributes']['id']})")
    return created["attributes"]["id"]


def ensure_allocations(node_id, ip):
    try:
        api("POST", f"/nodes/{node_id}/allocations", {"ip": ip, "ports": [GAME_PORTS]})
        print(f"    allocations {GAME_PORTS} on {ip}: created")
    except RuntimeError as e:
        if "422" in str(e):
            print(f"    allocations {GAME_PORTS} on {ip}: already exist, skipping")
        else:
            raise


def wings_config(node_id, behind_proxy):
    cfg = api("GET", f"/nodes/{node_id}/configuration")
    if behind_proxy:
        # The Panel reports the public daemon port (443, Caddy). Wings itself
        # must bind 8080 behind the proxy.
        cfg["api"]["port"] = 8080
        cfg["api"]["ssl"]["enabled"] = False
    # JSON is valid YAML, so this can be written to config.yml as-is.
    return json.dumps(cfg, indent=2)


def own_public_ip():
    for url in ("https://api.ipify.org", "https://ifconfig.me/ip"):
        try:
            with urllib.request.urlopen(url, timeout=15) as resp:
                ip = resp.read().decode().strip()
                if ip:
                    return ip
        except OSError:
            continue
    sys.exit("Could not determine this VM's public IP - set NODE_IP manually.")


def self_register():
    co_located = os.environ.get("CO_LOCATED", "0") == "1"
    ip = os.environ.get("NODE_IP") or own_public_ip()
    dashed = ip.replace(".", "-")
    default_fqdn = f"node-{'a-' if co_located else ''}{dashed}.sslip.io"
    fqdn = os.environ.get("NODE_FQDN", default_fqdn)
    name = fqdn.split(".")[0]
    write_path = os.environ.get("WRITE_CONFIG", "/etc/pterodactyl/config.yml")

    print(f"==> Registering this VM ({ip}) as node '{name}' ({fqdn})")
    location_id = find_or_create_location()
    node_id = find_or_create_node(name, fqdn, location_id, co_located)
    ensure_allocations(node_id, ip)
    cfg = wings_config(node_id, co_located)
    with open(write_path, "w") as f:
        f.write(cfg)
    os.chmod(write_path, 0o600)
    print(f"==> Wrote {write_path}")


def main():
    if os.environ.get("SELF", "0") == "1":
        self_register()
        return

    nodes = []
    for key, behind_proxy in (("A", True), ("B", False), ("C", False)):
        fqdn = os.environ.get(f"NODE_{key}_FQDN")
        ip = os.environ.get(f"NODE_{key}_IP")
        if fqdn and ip:
            nodes.append((f"node-{key.lower()}", fqdn, ip, behind_proxy))
    if not nodes:
        sys.exit("No nodes defined - set NODE_A_FQDN/NODE_A_IP etc.")

    print(f"==> Panel: {PANEL_URL}")
    location_id = find_or_create_location()
    print(f"==> Location '{LOCATION}' (id {location_id})")

    blocks = []
    for name, fqdn, ip, behind_proxy in nodes:
        node_id = find_or_create_node(name, fqdn, location_id, behind_proxy)
        ensure_allocations(node_id, ip)
        b64 = base64.b64encode(wings_config(node_id, behind_proxy).encode()).decode()
        if behind_proxy:
            cmd = (
                "cd test1/deploy/pterodactyl/wings-node\n"
                f"sudo CO_LOCATED=1 GAME_PORTS={GAME_PORTS.replace('-', ':')} \\\n"
                f"     WINGS_CONFIG_B64={b64} \\\n"
                "     ./install.sh"
            )
        else:
            cmd = (
                "sudo apt-get update && sudo apt-get install -y git\n"
                "git clone --branch claude/pterodactyl-vm-rental-lxun3e "
                "https://github.com/mackkm/test1.git\n"
                "cd test1/deploy/pterodactyl/wings-node\n"
                f"sudo NODE_FQDN={fqdn} ACME_EMAIL={ACME_EMAIL} \\\n"
                f"     GAME_PORTS={GAME_PORTS.replace('-', ':')} \\\n"
                f"     WINGS_CONFIG_B64={b64} \\\n"
                "     ./install.sh"
            )
        blocks.append((name, fqdn, cmd))

    print("\n" + "=" * 70)
    print(" Paste block for each VM (runs everything, starts Wings):")
    for name, fqdn, cmd in blocks:
        print(f"\n----- {name} ({fqdn}) " + "-" * 30 + "\n")
        print(cmd)
    print("\n" + "=" * 70)
    print(" When each block finishes, the node shows green/online in the Panel.")


if __name__ == "__main__":
    main()
