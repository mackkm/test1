# Pterodactyl game server rental — 3-VM Hetzner setup

Turns your Hetzner VMs into a small game-server hosting business:
[Pterodactyl](https://pterodactyl.io) manages the servers, [Paymenter](https://paymenter.org)
takes payment and provisions them automatically.

## Architecture

```
                          customers
                              |
                       (DNS: your domain)
                              |
                       +------+------+
                       |    VM A     |   Panel node
                       | Caddy (TLS) |
                       |  -> Panel   |   panel.example.com   (admin + API)
                       |  -> Paymenter|  billing.example.com (storefront)
                       |  -> Wings   |   node-a.example.com  (game node)
                       +------+------+
                              |  Panel <-> Wings API (HTTPS)
                +-------------+-------------+
                |                           |
         +------+------+            +------+------+
         |    VM B     |            |    VM C     |
         |   Wings     |            |   Wings     |
         | node-b.…    |            | node-c.…    |
         +-------------+            +-------------+
```

- **Panel** (`ghcr.io/pterodactyl/panel`) — admin web UI + API. Knows about
  nodes, users, servers; doesn't run any game server itself.
- **Wings** — the daemon that actually runs game servers as Docker
  containers. Runs on *every* node, including VM A (co-located with the
  Panel). Customer browsers talk to Wings directly (server console over
  websockets), so every node needs a domain + TLS: VM A's Wings sits behind
  Caddy, VM B/C get their own Let's Encrypt certs via certbot.
- **Paymenter** — the storefront. Customers buy a plan, pay via Stripe/PayPal,
  and Paymenter calls the Panel's API to create/suspend/terminate their
  server automatically.
- **Caddy** — reverse proxy on VM A, automatic HTTPS for panel + billing +
  the local Wings daemon.
- **`provision.py`** — creates the location, nodes, and port allocations in
  the Panel via its API and prints a single-paste install command per VM
  with that node's Wings config embedded.

## Before you start

Create these DNS A records first (TLS issuance depends on them):

| Record | Points at |
|---|---|
| `panel.example.com` | VM A public IP |
| `billing.example.com` | VM A public IP |
| `node-a.example.com` | VM A public IP |
| `node-b.example.com` | VM B public IP |
| `node-c.example.com` | VM C public IP |

Also decide your allocation port range up front (default `25565-25665`).
All VMs: Ubuntu 22.04/24.04 or Debian 11/12, root/sudo access.

## Setup order

Every step is a copy-paste block; the install scripts are non-interactive
when their inputs are passed as env vars (and prompt for anything missing).

1. **VM A — panel stack** (edit the four values, then paste):
   ```sh
   sudo apt-get update && sudo apt-get install -y git
   git clone https://github.com/mackkm/test1.git
   cd test1/deploy/pterodactyl/panel-node
   sudo PANEL_DOMAIN=panel.example.com \
        BILLING_DOMAIN=billing.example.com \
        NODE_DOMAIN=node-a.example.com \
        ACME_EMAIL=you@example.com \
        ./install.sh
   ```
   It prints the panel URL and generated admin login when done.

2. **Create an Application API key**: log in to the Panel, go to
   `https://panel.example.com/admin/api/new`, tick read/write on all
   resources, create.

3. **Provision all nodes** (from VM A or any machine with python3):
   ```sh
   cd test1/deploy/pterodactyl
   PANEL_URL=https://panel.example.com APP_API_KEY=ptla_... \
   NODE_A_FQDN=node-a.example.com NODE_A_IP=<VM-A-IP> \
   NODE_B_FQDN=node-b.example.com NODE_B_IP=<VM-B-IP> \
   NODE_C_FQDN=node-c.example.com NODE_C_IP=<VM-C-IP> \
   ACME_EMAIL=you@example.com \
   ./provision.py
   ```
   It creates the location/nodes/allocations and prints one paste block per
   VM (including VM A's own Wings) with the node's config embedded — run
   each block on its VM and the node comes up green in the Panel.

4. **In the Panel admin**, import eggs (game templates) instead of writing
   your own: https://github.com/pelican-eggs/eggs has Minecraft
   (Vanilla/Paper/Forge), Rust, ARK, Valheim, and dozens more —
   Admin → Nests → Import Egg, paste the raw JSON URL. Then create one test
   server yourself and confirm it starts and is reachable from a game
   client and over SFTP (port 2022) before selling anything.

5. **Paymenter** (`https://billing.example.com`):
   - Complete the first-run setup wizard (creates your admin account).
   - **Settings → Payment gateways** → connect Stripe and/or PayPal.
   - **Settings → Servers/Pterodactyl** → add your Panel's URL and a second
     Application API key.
   - **Products** → create one per plan (RAM/disk/CPU tier), mapped to the
     Nest/Egg you imported. This is what customers actually buy.
   - Do a full dry-run purchase yourself (test mode if using Stripe) to
     confirm payment → server auto-creation works end to end.

## Security hardening (do this on all VMs)

- **SSH**: key-only auth (`PasswordAuthentication no` in
  `/etc/ssh/sshd_config`), and `fail2ban` (`apt install fail2ban`) against
  brute-force attempts.
- **Unattended security updates**: `apt install unattended-upgrades` and
  enable it — you're now running internet-facing services you're
  responsible for patching.
- **Firewall**: the install scripts lock ufw down to only the ports each
  role needs (Wings' 8080 stays public on B/C by design — customer consoles
  connect to it; TLS + Panel-issued tokens protect it). Don't open anything
  else without a reason.
- **Backups**:
  - Panel: back up `/srv/pterodactyl/var/.env` (contains `APP_KEY` — losing
    it makes all encrypted panel data unrecoverable) and take regular
    `mysqldump` snapshots of the `panel-database` container's volume.
  - Paymenter: same idea for `/srv/paymenter` and `pay-database`.
  - Customer game data: configure a remote backup destination (S3-compatible
    — Backblaze B2, Wasabi, etc.) in Wings/Panel so per-server backups
    survive a node dying, not just local disk.
- **Don't oversell**: `provision.py` registers each node with 30 GB RAM /
  550 GB disk allocatable (of 32/640) and 0% overallocation. Pterodactyl
  would let you oversell past physical capacity, but Linux OOM-killing
  everyone's server when you do costs more in support tickets than the
  extra sales earn.

## Business & legal — read before taking real payments

- **Hetzner's terms**: review Hetzner's
  [Terms & Conditions](https://www.hetzner.com/legal/terms-and-conditions/)
  and [System/abuse policies](https://www.hetzner.com/legal/system-policies/)
  before reselling. Reselling itself is generally fine, but *you* remain the
  account holder responsible for everything your customers do on these
  VMs — abuse complaints, DMCA takedowns, or attacks originating from a
  customer's game server land on you, and unresolved abuse can get the
  whole account suspended. Have a plan (and a clear customer ToS/AUP) for
  handling that quickly.
- **DDoS reality check**: game servers are a common DDoS target, and
  Hetzner Cloud's baseline protection is aimed at protecting *their*
  network (typically null-routing an attacked IP) rather than keeping
  *your* server up through an attack. If uptime-under-attack matters to your
  customers, budget for a dedicated game-traffic protection layer
  (e.g. a proxy service in front of the game ports) rather than assuming
  the included protection covers it.
- **Payments & tax**: recurring customer billing is a real business
  activity in most jurisdictions — check whether it requires business
  registration and tax/VAT handling where you live before going live with
  Stripe/PayPal, and budget for chargebacks/refunds (Paymenter can display
  your refund policy, but you decide what it says).
- **Customer ToS/AUP**: write one (no illegal content, no attacking other
  customers/third parties, refund terms, data-loss disclaimers) and link it
  from Paymenter's checkout — this is also what you'll point to when you
  have to suspend an abusive customer.

## Troubleshooting

- **Redirect loop / mixed-content (http) links on the Panel**: this means
  the Panel isn't trusting Caddy as a proxy. Confirm `TRUSTED_PROXIES=*` and
  `APP_URL=https://...` are set (already in `docker-compose.yml`) — see
  https://pterodactyl.io/panel/1.0/additional_configuration.html if it
  persists after a restart (`docker compose restart panel`).
- **Node stuck offline/red**: check `journalctl -u wings -n 50` on the
  node. Usual causes: `/etc/pterodactyl/config.yml` doesn't match what the
  Panel generated (re-run the provision paste block), the cert failed to
  issue (DNS not pointing at the VM yet), or port 8080 blocked.
- **Console "connection lost" in the browser for servers on a node**: the
  browser can't reach that node's daemon — usually the node's TLS cert or
  its public 8080 (443 for node-a) being blocked.
- **Caddy won't get a certificate**: DNS for that domain isn't pointing at
  the VM yet, or port 80/443 isn't reachable from the internet (check
  `ufw status`, and your Hetzner Cloud firewall if you also have one
  configured there).
