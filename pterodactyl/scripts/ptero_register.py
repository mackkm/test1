#!/usr/bin/env python3
"""Register this host as a Pterodactyl node using the Panel application API.

Idempotent: a node is matched by name, allocations are only added for ports the
node does not already have, and the Wings configuration is re-fetched every run.

Reads its settings from the environment (see config.env.example) and writes the
Wings configuration to /etc/pterodactyl/config.yml.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

CONFIG_PATH = "/etc/pterodactyl/config.yml"


def fail(message: str) -> "NoReturn":  # type: ignore[valid-type]
    print(f"[fail] {message}", file=sys.stderr)
    raise SystemExit(1)


def env(name: str, default: str | None = None, required: bool = False) -> str:
    value = os.environ.get(name) or default or ""
    if required and not value:
        fail(f"required setting {name} is not set")
    return value


class Panel:
    def __init__(self, base_url: str, key: str) -> None:
        self.base = base_url.rstrip("/")
        self.key = key

    def request(self, method: str, path: str, payload: dict | None = None):
        url = f"{self.base}/api/application{path}"
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.key}")
        req.add_header("Accept", "application/json")
        if data:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read().decode()
                return json.loads(body) if body.strip() else {}
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:800]
            fail(f"{method} {url} -> HTTP {exc.code}\n{detail}")
        except urllib.error.URLError as exc:
            fail(f"cannot reach the panel at {url}: {exc.reason}")

    def paged(self, path: str):
        """Yield every attribute dict across all pages of a list endpoint."""
        page = 1
        while True:
            sep = "&" if "?" in path else "?"
            body = self.request("GET", f"{path}{sep}page={page}&per_page=100")
            for item in body.get("data", []):
                yield item["attributes"]
            meta = body.get("meta", {}).get("pagination", {})
            if page >= meta.get("total_pages", 1):
                return
            page += 1


def parse_ports(spec: str) -> list[int]:
    """Expand '25565-25700,27015' into a sorted list of port numbers."""
    ports: set[int] = set()
    for chunk in spec.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "-" in chunk:
            lo_s, hi_s = chunk.split("-", 1)
            lo, hi = int(lo_s), int(hi_s)
            if lo > hi:
                fail(f"invalid port range '{chunk}'")
            ports.update(range(lo, hi + 1))
        else:
            ports.add(int(chunk))
    for port in ports:
        if not 1024 <= port <= 65535:
            fail(f"port {port} is outside the usable range 1024-65535")
    return sorted(ports)


def ensure_location(panel: Panel, short: str) -> int:
    for loc in panel.paged("/locations"):
        if loc["short"] == short:
            print(f"[ok] using existing location '{short}' (id={loc['id']})")
            return loc["id"]
    created = panel.request(
        "POST", "/locations", {"short": short, "long": f"{short} (auto-created)"}
    )
    location_id = created["attributes"]["id"]
    print(f"[ok] created location '{short}' (id={location_id})")
    return location_id


def ensure_node(panel: Panel, cfg: dict, location_id: int) -> dict:
    for node in panel.paged("/nodes"):
        if node["name"] == cfg["name"]:
            print(f"[ok] node '{cfg['name']}' already registered (id={node['id']})")
            return node

    payload = {
        "name": cfg["name"],
        "location_id": location_id,
        "fqdn": cfg["fqdn"],
        "scheme": cfg["scheme"],
        "memory": cfg["memory"],
        "memory_overallocate": cfg["memory_overallocate"],
        "disk": cfg["disk"],
        "disk_overallocate": cfg["disk_overallocate"],
        "upload_size": 100,
        "daemon_sftp": cfg["sftp_port"],
        "daemon_listen": cfg["listen_port"],
        "behind_proxy": False,
        "maintenance_mode": False,
    }
    node = panel.request("POST", "/nodes", payload)["attributes"]
    print(f"[ok] created node '{cfg['name']}' (id={node['id']})")
    return node


def ensure_allocations(panel: Panel, node_id: int, ip: str, ports: list[int]) -> None:
    existing = {
        int(a["port"])
        for a in panel.paged(f"/nodes/{node_id}/allocations")
        if a["ip"] == ip
    }
    missing = [p for p in ports if p not in existing]
    if not missing:
        print(f"[ok] all {len(ports)} allocations already exist on {ip}")
        return

    # The panel validates allocations per request; keep batches modest.
    batch_size = 100
    for start in range(0, len(missing), batch_size):
        batch = missing[start : start + batch_size]
        panel.request(
            "POST",
            f"/nodes/{node_id}/allocations",
            {"ip": ip, "ports": [str(p) for p in batch]},
        )
        print(f"[ok] added {len(batch)} allocations ({batch[0]}-{batch[-1]})")


def write_wings_config(panel: Panel, node_id: int) -> None:
    config = panel.request("GET", f"/nodes/{node_id}/configuration")
    try:
        import yaml  # provided by the python3-yaml package

        rendered = yaml.safe_dump(config, default_flow_style=False, sort_keys=False)
    except ImportError:
        # JSON is valid YAML, so this still produces a config Wings can read.
        print("[warn] python3-yaml missing; writing the config as JSON instead")
        rendered = json.dumps(config, indent=2)

    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as handle:
        handle.write(rendered)
    os.chmod(CONFIG_PATH, 0o600)
    print(f"[ok] wrote {CONFIG_PATH}")


def main() -> None:
    panel = Panel(
        env("PANEL_URL", required=True),
        env("PTERO_APP_KEY", required=True),
    )
    node_cfg = {
        "name": env("NODE_NAME", required=True),
        "fqdn": env("NODE_FQDN", required=True),
        "scheme": env("NODE_SCHEME", "https"),
        "memory": int(env("NODE_MEMORY", "0") or 0),
        "disk": int(env("NODE_DISK", "0") or 0),
        "memory_overallocate": int(env("NODE_MEMORY_OVERALLOCATE", "0")),
        "disk_overallocate": int(env("NODE_DISK_OVERALLOCATE", "0")),
        "sftp_port": int(env("NODE_SFTP_PORT", "2022")),
        "listen_port": int(env("NODE_LISTEN_PORT", "8080")),
    }
    if node_cfg["memory"] <= 0 or node_cfg["disk"] <= 0:
        fail("NODE_MEMORY and NODE_DISK must be set (in MiB)")

    if node_cfg["scheme"] == "https" and _is_ip(node_cfg["fqdn"]):
        fail(
            "NODE_FQDN is a bare IP but NODE_SCHEME is https — Wings needs a real "
            "hostname with a certificate. Set a DNS name, or use NODE_SCHEME=http."
        )

    location_id = ensure_location(panel, env("NODE_LOCATION", "hetzner"))
    node = ensure_node(panel, node_cfg, location_id)
    ensure_allocations(
        panel,
        node["id"],
        env("NODE_PUBLIC_IP", required=True),
        parse_ports(env("GAME_PORT_RANGE", "25565-25700")),
    )
    write_wings_config(panel, node["id"])
    print(f"[ok] node '{node_cfg['name']}' is registered — restart wings to apply")


def _is_ip(value: str) -> bool:
    parts = value.split(".")
    return len(parts) == 4 and all(p.isdigit() and 0 <= int(p) <= 255 for p in parts)


if __name__ == "__main__":
    main()
