# PocketClaw gateway on a Hetzner Cloud VM — same idea as deploy/gcp, but
# driven by the Hetzner Cloud API so you never have to SSH in to install it.
#
# From any machine with Terraform and network access to api.hetzner.cloud:
#
#   git clone https://github.com/mackkm/test1.git && cd test1/deploy/hetzner
#   terraform init
#   terraform apply -var hcloud_token=YOUR_HETZNER_API_TOKEN \
#                   -var pocketclaw_token=PICK_A_PASSWORD
#
# Create the API token in the Hetzner Cloud Console under
# Security → API tokens → Generate API token (needs Read & Write).
#
# Then open the printed URL on your phone, add to home screen, and paste your
# Anthropic API key + the gateway password in the app's settings.
#
# Boots in sandbox mode by default (safest for a VM open to the internet): the
# agent gets read/research tools only, no shell or file writes. Turn it off
# with -var sandbox=false, or flip it per-request later in the app (⚙ →
# Sandbox mode).

terraform {
  required_providers {
    hcloud = {
      source = "hetznercloud/hcloud"
    }
  }
}

variable "hcloud_token" {
  description = "Hetzner Cloud API token (Read & Write). Prefer the HCLOUD_TOKEN env var over passing this on the command line."
  sensitive   = true
  default     = null
}

variable "pocketclaw_token" {
  description = "Password the app must present to use the gateway — pick something long"
  sensitive   = true

  # It gets interpolated into a single-quoted shell assignment in user_data, so
  # a quote or backslash would break the boot script rather than fail loudly.
  validation {
    condition     = can(regex("^[A-Za-z0-9._~-]{12,}$", var.pocketclaw_token))
    error_message = "Use at least 12 characters from A-Z a-z 0-9 . _ ~ - (no quotes or spaces — the token is passed through a shell script on first boot)."
  }
}

variable "name" {
  default     = "pocketclaw-gateway"
  description = "Name for the server and its firewall"
}

variable "allowed_source_ranges" {
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
  description = "CIDRs allowed to reach the gateway on TCP 3333. The gateway is token-protected, but it serves plain HTTP — narrow this to your own networks (or front it with a VPN/Tailscale) when you can."
}

variable "ssh_source_ranges" {
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
  description = "CIDRs allowed to reach SSH. Attaching a Hetzner firewall switches inbound to default-deny, so this rule is what keeps your own SSH access working — narrow it to your own IP rather than removing it."
}

variable "ssh_keys" {
  type        = list(string)
  default     = []
  description = "Names or IDs of SSH keys already uploaded to your Hetzner project, e.g. [\"my-laptop\"]. Nothing here needs SSH, but without a key you have no way in if you ever need to debug the VM."
}

variable "location" {
  default     = "nbg1"
  description = "nbg1/fsn1/hel1 (EU), ash/hil (US), sin (Singapore)"
}

variable "server_type" {
  default     = "cx22"
  description = "cx22 is the small x86 shared-vCPU box; cax11 is the cheaper ARM equivalent and also works"
}

variable "image" {
  default = "debian-12"
}

variable "sandbox" {
  type        = bool
  default     = true
  description = "Run the agent restricted by default (isolated workspace, no shell/file writes — safest default for a VM reachable from the internet). Flip off with -var sandbox=false, or toggle per-request in the app (⚙ → Sandbox mode) once it's running."
}

variable "repo_url" {
  default = "https://github.com/mackkm/test1.git"
}

variable "setup_script_url" {
  default     = "https://raw.githubusercontent.com/mackkm/test1/master/deploy/setup.sh"
  description = "The same installer Option B uses — cloud-init runs it on first boot instead of you SSHing in"
}

provider "hcloud" {
  token = var.hcloud_token
}

# Attaching a firewall makes inbound default-deny, so every port we still want
# has to be named here — including SSH, or you lock yourself out of your own VM.
resource "hcloud_firewall" "pocketclaw" {
  name = "${var.name}-fw"

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "3333"
    source_ips = var.allowed_source_ranges
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.ssh_source_ranges
  }

  rule {
    direction  = "in"
    protocol   = "icmp"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_server" "pocketclaw" {
  name         = var.name
  image        = var.image
  server_type  = var.server_type
  location     = var.location
  ssh_keys     = var.ssh_keys
  firewall_ids = [hcloud_firewall.pocketclaw.id]

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  # Reuses deploy/setup.sh (the Option B installer) rather than repeating the
  # Node + Claude Code + systemd steps here — it already takes its config from
  # the environment. Everything after it is the hardening the GCP module does:
  # run the agent as an unprivileged user, and keep it away from metadata.
  #
  # Note: bash ${...} is avoided throughout — Terraform would interpolate it.
  user_data = <<-SCRIPT
    #!/bin/bash
    # No -x: the token is exported below and this log is kept forever in
    # /var/log/cloud-init-output.log.
    set -euo pipefail
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y curl git ca-certificates iptables

    export POCKETCLAW_TOKEN='${var.pocketclaw_token}'
    export POCKETCLAW_SANDBOX='${var.sandbox ? "1" : "0"}'
    export REPO_URL='${var.repo_url}'
    curl -fsSL '${var.setup_script_url}' | bash

    # Dedicated unprivileged user for the agent (never run it as root).
    id -u pocketclaw >/dev/null 2>&1 \
      || useradd --system --create-home --home-dir /opt/pocketclaw-home pocketclaw
    mkdir -p /opt/pocketclaw-workspace
    chown -R pocketclaw:pocketclaw /opt/pocketclaw-workspace /opt/pocketclaw-home

    # setup.sh writes this 0600 root-owned; the service user needs to read it.
    chown root:pocketclaw /etc/pocketclaw.env
    chmod 640 /etc/pocketclaw.env

    # Drop-in over the unit setup.sh installed, so the install logic stays in
    # one place and only the hardening lives here.
    mkdir -p /etc/systemd/system/pocketclaw.service.d
    cat > /etc/systemd/system/pocketclaw.service.d/hardening.conf <<'UNIT'
    [Service]
    User=pocketclaw
    NoNewPrivileges=true
    PrivateTmp=true
    ProtectSystem=full
    ProtectHome=true
    ReadWritePaths=/opt/pocketclaw-workspace /opt/pocketclaw-home
    UNIT

    # Hetzner serves this script — gateway password included — back to the VM
    # from the metadata service, so stop the agent user from reading it.
    # (GCP had Secret Manager to avoid this; Hetzner has no managed equivalent,
    # see the security note in deploy/README.md.)
    iptables -C OUTPUT -m owner --uid-owner pocketclaw -d 169.254.169.254 -j REJECT 2>/dev/null \
      || iptables -A OUTPUT -m owner --uid-owner pocketclaw -d 169.254.169.254 -j REJECT

    systemctl daemon-reload
    systemctl restart pocketclaw
  SCRIPT
}

output "pocketclaw_url" {
  value       = "http://${hcloud_server.pocketclaw.ipv4_address}:3333"
  description = "Open this on your phone (give the VM ~2-3 minutes to finish installing)"
}

output "server_ip" {
  value = hcloud_server.pocketclaw.ipv4_address
}

output "gateway_token_reminder" {
  value = "In the app: Settings → backend 'Claude Code CLI' → Gateway URL = the URL above, Gateway token = the pocketclaw_token you chose, and paste your Anthropic API key."
}

output "sandbox_note" {
  value = var.sandbox ? "Sandbox mode is ON by default — the agent has read/research tools only. Turn it off in Settings (⚙ → Sandbox mode) or redeploy with -var sandbox=false." : "Sandbox mode is OFF — the agent has full tool access on this VM."
}
