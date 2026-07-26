# Pterodactyl on Hetzner Cloud

Deployment kit for a four-host Pterodactyl fleet:

| Host | Role |
|---|---|
| 3 existing Hetzner VMs | Wings game-server nodes |
| 1 new CPX62 | Pterodactyl Panel + Paymenter billing + Wings |

Everything here is idempotent — re-running a script upgrades in place rather
than starting over.

## Layout

```
pterodactyl/
├── config.env.example        every setting, copy to config.env
├── deploy.sh                 SSH orchestrator (run from your machine)
├── hcloud/hcloud.sh          Hetzner API: create the CPX62, manage firewalls
└── scripts/                  what actually runs on each host
    ├── lib.sh                shared helpers
    ├── 10-common.sh          base packages, timezone, optional ufw
    ├── 20-wings.sh           Docker + Wings daemon
    ├── 30-panel.sh           Panel: PHP 8.3, MariaDB, Redis, nginx, TLS
    ├── 40-billing.sh         Paymenter billing on the same host
    ├── 50-register-node.sh   register the node with the Panel, start Wings
    └── ptero_register.py     Panel application-API client
```

## Order of operations

Wings cannot be configured before a Panel exists — it gets its `config.yml`
*from* the Panel. So even though the goal reads "nodes first, panel second",
the working order is:

1. **Install** the Wings daemon on the three nodes (no Panel needed yet).
2. **Stand up** the Panel + billing on the CPX62.
3. **Register** the three nodes against the Panel, which writes their
   `config.yml` and starts Wings.

`deploy.sh all` does steps 1 and 2, then stops and tells you to mint an API key
for step 3.

## Prerequisites

- SSH access as root to all four hosts.
- `HCLOUD_TOKEN` for the project that will hold the new server.
- DNS A records, all of which must exist **before** the TLS step:

  | Record | Points at | Why |
  |---|---|---|
  | `panel.example.com` | CPX62 | the Panel |
  | `billing.example.com` | CPX62 | Paymenter |
  | `node1/2/3.example.com` | each node | Wings needs its own cert — the browser talks to it directly for console and file transfers |

  Wings will not connect to a Panel over an invalid certificate, and the
  browser will not open a websocket to a node over one either. Plain IPs work
  only if you set `NODE_SCHEME=http`, which disables the web console over HTTPS.

## Usage

```sh
cp config.env.example config.env
$EDITOR config.env
```

### 1. Create the CPX62

```sh
export HCLOUD_TOKEN=...
./hcloud/hcloud.sh list            # sanity-check the project
./hcloud/hcloud.sh create-panel    # creates + bootstraps via cloud-init
```

`create-panel` ships the whole `scripts/` directory inside the server's
cloud-init `user_data`, so the box installs the Panel, billing and Wings on
first boot with no inbound SSH required. Follow along with:

```sh
ssh root@<new-ip> 'tail -f /var/log/pterodactyl-bootstrap.log'
```

It is finished when `/opt/pterodactyl-deploy/.bootstrap-complete` exists.

### 2. Install Wings on the three existing nodes

```sh
./deploy.sh nodes
```

### 3. Register the nodes

Create an application API key at `<panel>/admin/api` with **read/write** on
Nodes, Locations and Allocations, put it in `config.env` as `PTERO_APP_KEY`,
then:

```sh
./deploy.sh register
```

This creates each node and its port allocations in the Panel, pulls the
generated `config.yml` down to the host, and starts Wings.

### 4. Firewalls

```sh
./hcloud/hcloud.sh firewall
```

Creates/updates a `pterodactyl-fleet` Hetzner Cloud Firewall (SSH, HTTP/HTTPS,
Wings 8080/2022, and the game port range) and applies it to every server in the
project. Run it once per project — your VMs are split across two.

### Checking on things

```sh
./deploy.sh status
```

## Credentials

Generated passwords are written to `/root/pterodactyl-credentials.txt` on each
host (mode 600) and cached in `/root/.pterodactyl-secrets` so re-runs stay
idempotent. Nothing secret is written back into this repository —
`config.env` is gitignored.

## Wiring billing to the Panel

Paymenter provisions game servers by calling the Panel's application API. After
both are up, in the Paymenter admin area add a Pterodactyl server integration
pointing at your Panel URL with an application API key, then create products
that map to Panel eggs and nests.

## Notes and limits

- The new CPX62 is deliberately created on **Ubuntu 24.04**, not 26.04:
  Pterodactyl 1.12.x requires PHP 8.2/8.3, and the `ondrej/php` PPA is reliable
  on noble. The nodes only run Docker and a Go binary, so their OS version does
  not matter.
- `GAME_PORT_RANGE` defaults to `25565-25700` (136 allocations per node). Widen
  it in `config.env` if you sell more slots than that.
- Node memory and disk default to 85% of what each host reports, leaving
  headroom for the OS and Docker itself.
- The Hetzner firewall rule for SSH is open to the world by default. Narrow it
  to your own address if you can.

## References

- [Pterodactyl Panel install](https://pterodactyl.io/panel/1.0/getting_started.html)
- [Wings install](https://pterodactyl.io/wings/1.0/installing.html)
- [Webserver configuration](https://pterodactyl.io/panel/1.0/webserver_configuration.html)
- [Paymenter install](https://paymenter.org/docs/installation/install)
