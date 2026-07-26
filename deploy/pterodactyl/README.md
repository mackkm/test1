# Pterodactyl game server rental — 2-VM Hetzner setup

Turns your 2 Hetzner VMs into a small game-server hosting business:
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
                       |  -> Panel   |   panel.example.com  (admin + API)
                       |  -> Paymenter|  billing.example.com (storefront)
                       |  -> Wings   |   this VM is ALSO a game-server node
                       +------+------+
                              | Wings API (8080, restricted to VM A/B only)
                       +------+------+
                       |    VM B     |   pure Wings node - game servers only
                       +-------------+
```

- **Panel** (`ghcr.io/pterodactyl/panel`) — admin web UI + API. Knows about
  nodes, users, servers; doesn't run any game server itself.
- **Wings** — the daemon that actually runs game servers as Docker
  containers. Runs on *every* node, including VM A (co-located with the
  Panel, per your setup).
- **Paymenter** — the storefront. Customers buy a plan, pay via Stripe/PayPal,
  and Paymenter calls the Panel's API to create/suspend/terminate their
  server automatically.
- **Caddy** — reverse proxy in front of Panel + Paymenter, handling
  automatic HTTPS for both domains so neither app needs its own cert.

## Before you start

- Two domains (or subdomains) pointed at VM A's IP: one for the panel, one
  for billing, e.g. `panel.yourdomain.com` and `billing.yourdomain.com`.
  DNS must resolve *before* running `install.sh` (Caddy needs it for the
  Let's Encrypt challenge).
- Both VMs on Ubuntu 22.04/24.04 or Debian 11/12, with root/sudo access.
- Decide your allocation port range up front (e.g. `25565:25665` for a
  Minecraft-focused setup) — you'll open this on both VMs and use it when
  creating Nodes in the Panel.

## Setup order

1. **VM A — Panel + billing + local Wings node**
   ```sh
   cd deploy/pterodactyl/panel-node
   sudo ./install.sh
   ```
   Follow the printed next steps: create the admin user, log in, then
   also run the Wings installer on this same VM so it can host servers too:
   ```sh
   cd ../wings-node
   sudo ./install.sh
   ```

2. **VM B — pure Wings node**
   ```sh
   cd deploy/pterodactyl/wings-node
   sudo ./install.sh
   ```

3. **In the Panel admin** (`https://panel.yourdomain.com`):
   - **Locations** → create one (e.g. "Hetzner - Falkenstein").
   - **Nodes** → create one per VM, using each VM's public IP/FQDN and the
     port range you opened. Set the co-located node's daemon address to
     `127.0.0.1` if you'd rather not expose Wings' API on VM A publicly at
     all (Panel and Wings are the same machine there).
   - Open each Node's **Configuration** tab, paste the block into
     `/etc/pterodactyl/config.yml` on the matching VM, then
     `systemctl enable --now wings` (see `wings-node/install.sh` output).
     The node goes green/"online" in the admin once Wings connects back.
   - **Allocations** → add ports within your range for each node.
   - **Nests/Eggs** → import ready-made eggs instead of writing your own:
     the community egg repo at https://github.com/pelican-eggs/eggs has
     Minecraft (Vanilla/Paper/Forge), Rust, ARK, Valheim, and dozens more —
     Admin → Nests → Import Egg, paste the raw JSON URL.
   - Create one test server yourself and confirm it starts, and that you
     can reach it from a game client and over SFTP (port 2022), before
     selling anything.

4. **Paymenter** (`https://billing.yourdomain.com`):
   - Complete the first-run setup wizard (creates your admin account).
   - **Settings → Payment gateways** → connect Stripe and/or PayPal.
   - **Settings → Servers/Pterodactyl** → add your Panel's URL and an
     **Application API key** (Panel admin → Application API → create key;
     give it server/user/node read+write permissions).
   - **Products** → create one per plan (RAM/disk/CPU tier), mapped to the
     Nest/Egg you imported. This is what customers actually buy.
   - Do a full dry-run purchase yourself (test mode if using Stripe) to
     confirm payment → server auto-creation works end to end.

## Security hardening (do this on both VMs)

- **SSH**: key-only auth (`PasswordAuthentication no` in
  `/etc/ssh/sshd_config`), and `fail2ban` (`apt install fail2ban`) against
  brute-force attempts.
- **Unattended security updates**: `apt install unattended-upgrades` and
  enable it — you're now running internet-facing services you're
  responsible for patching.
- **Firewall**: the install scripts already lock ufw down to only the ports
  each role needs. Don't open anything else without a reason.
- **Backups**:
  - Panel: back up `/srv/pterodactyl/var/.env` (contains `APP_KEY` — losing
    it makes all encrypted panel data unrecoverable) and take regular
    `mysqldump` snapshots of the `panel-database` container's volume.
  - Paymenter: same idea for `/srv/paymenter` and `pay-database`.
  - Customer game data: configure a remote backup destination (S3-compatible
    — Backblaze B2, Wasabi, etc.) in Wings/Panel so per-server backups
    survive a node dying, not just local disk.
- **Don't oversell**: only allocate as much combined RAM/CPU/disk across all
  servers on a node as that VM actually has. Pterodactyl won't stop you from
  overselling, but Linux OOM-killing everyone's server when you do will cost
  you more support tickets than the extra sales are worth.

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
- **Node stuck offline/red**: usually Wings can't be reached on port 8080
  from the Panel, or `/etc/pterodactyl/config.yml` doesn't match what the
  Panel generated. Check `journalctl -u wings -f` on the node and re-copy
  the config from the Node's Configuration tab if in doubt.
- **Caddy won't get a certificate**: DNS for that domain isn't pointing at
  the VM yet, or port 80/443 isn't reachable from the internet (check
  `ufw status`, and your Hetzner Cloud firewall if you also have one
  configured there).
