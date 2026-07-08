# PocketClaw gateway on a Google Cloud VM — one command, runs 24/7 so your
# phone never needs your computer.
#
# From Google Cloud Shell (works from a phone browser at shell.cloud.google.com):
#
#   git clone https://github.com/mackkm/test1.git && cd test1/deploy/gcp
#   terraform init
#   terraform apply -var project=YOUR_PROJECT_ID -var pocketclaw_token=PICK_A_PASSWORD
#
# Then open the printed URL on your phone, add to home screen, and paste your
# Anthropic API key + the token in the app's settings. The e2-micro machine is
# inside GCP's Always Free tier in this region.
#
# Boots in sandbox mode by default (safest for a VM open to the internet): the
# agent gets read/research tools only, no shell or file writes. Turn it off
# with -var sandbox=false, or flip it per-request later in the app (⚙ →
# Sandbox mode).

terraform {
  required_providers {
    google = {
      source = "hashicorp/google"
    }
  }
}

variable "project" {
  description = "Your GCP project id"
}

variable "pocketclaw_token" {
  description = "Password the app must present to use the gateway — pick something long"
  sensitive   = true
}

variable "allowed_source_ranges" {
  type        = list(string)
  default     = ["0.0.0.0/0"]
  description = "CIDRs allowed to reach the gateway. The gateway is token-protected, but it serves plain HTTP — narrow this to your own networks (or front it with a VPN/Tailscale) when you can."
}

variable "region" {
  default = "us-central1" # e2-micro free-tier region
}

variable "zone" {
  default = "us-central1-a"
}

variable "repo_url" {
  default = "https://github.com/mackkm/test1.git"
}

variable "machine_type" {
  default = "e2-micro" # always-free in us-central1/us-west1/us-east1
}

variable "sandbox" {
  type        = bool
  default     = true
  description = "Run the agent restricted by default (isolated workspace, no shell/file writes — safest default for a VM reachable from the internet). Flip off with -var sandbox=false, or toggle per-request in the app (⚙ → Sandbox mode) once it's running."
}

provider "google" {
  project = var.project
  region  = var.region
  zone    = var.zone
}

resource "google_compute_firewall" "pocketclaw" {
  name    = "pocketclaw-allow-3333"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["3333"]
  }

  source_ranges = var.allowed_source_ranges
  target_tags   = ["pocketclaw"]
}

# Keep the gateway password out of instance metadata (which any process on the
# VM — including the agent — can read via 169.254.169.254). Store it in Secret
# Manager and let only the VM's own service account read it.
resource "google_project_service" "secretmanager" {
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

resource "google_service_account" "pocketclaw" {
  account_id   = "pocketclaw-gateway"
  display_name = "PocketClaw gateway VM"
}

resource "google_secret_manager_secret" "token" {
  secret_id = "pocketclaw-token"
  replication {
    auto {}
  }
  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "token" {
  secret      = google_secret_manager_secret.token.id
  secret_data = var.pocketclaw_token
}

resource "google_secret_manager_secret_iam_member" "token_access" {
  secret_id = google_secret_manager_secret.token.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.pocketclaw.email}"
}

resource "google_compute_instance" "pocketclaw" {
  name         = "pocketclaw-gateway"
  machine_type = var.machine_type
  tags         = ["pocketclaw"]

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 20
      type  = "pd-standard" # free-tier eligible
    }
  }

  network_interface {
    network = "default"
    access_config {} # ephemeral public IP
  }

  service_account {
    email  = google_service_account.pocketclaw.email
    scopes = ["cloud-platform"]
  }

  depends_on = [
    google_secret_manager_secret_version.token,
    google_secret_manager_secret_iam_member.token_access,
  ]

  metadata_startup_script = <<-SCRIPT
    #!/bin/bash
    set -euxo pipefail
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y curl git ca-certificates jq
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
    npm install -g @anthropic-ai/claude-code

    rm -rf /opt/pocketclaw
    git clone ${var.repo_url} /opt/pocketclaw
    mkdir -p /opt/pocketclaw-workspace

    # Dedicated unprivileged user for the agent (never run it as root).
    id -u pocketclaw >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/pocketclaw-home pocketclaw
    chown -R pocketclaw:pocketclaw /opt/pocketclaw-workspace /opt/pocketclaw-home

    # Fetch the gateway token from Secret Manager (using the VM's own service
    # account) instead of baking it into metadata.
    ACCESS_TOKEN=$(curl -s -H "Metadata-Flavor: Google" \
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" | jq -r .access_token)
    PC_TOKEN=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
      "https://secretmanager.googleapis.com/v1/projects/${var.project}/secrets/pocketclaw-token/versions/latest:access" \
      | jq -r .payload.data | base64 -d)

    umask 077
    printf 'POCKETCLAW_TOKEN=%s\n' "$PC_TOKEN" > /etc/pocketclaw.env
    chown root:pocketclaw /etc/pocketclaw.env
    chmod 640 /etc/pocketclaw.env

    # Stop the agent process from reading VM metadata (SA tokens, other secrets).
    iptables -C OUTPUT -m owner --uid-owner pocketclaw -d 169.254.169.254 -j REJECT 2>/dev/null \
      || iptables -A OUTPUT -m owner --uid-owner pocketclaw -d 169.254.169.254 -j REJECT

    cat > /etc/systemd/system/pocketclaw.service <<'UNIT'
    [Unit]
    Description=PocketClaw gateway
    After=network-online.target
    Wants=network-online.target

    [Service]
    User=pocketclaw
    Environment=PORT=3333
    Environment=POCKETCLAW_WORKSPACE=/opt/pocketclaw-workspace
    Environment=POCKETCLAW_SANDBOX=${var.sandbox ? "1" : "0"}
    EnvironmentFile=/etc/pocketclaw.env
    ExecStart=/usr/bin/node /opt/pocketclaw/server/server.js
    Restart=always
    RestartSec=3

    [Install]
    WantedBy=multi-user.target
    UNIT

    systemctl daemon-reload
    systemctl enable --now pocketclaw
  SCRIPT
}

output "pocketclaw_url" {
  value       = "http://${google_compute_instance.pocketclaw.network_interface[0].access_config[0].nat_ip}:3333"
  description = "Open this on your phone (give the VM ~2 minutes to finish installing)"
}

output "gateway_token_reminder" {
  value = "In the app: Settings → backend 'Claude Code CLI' → Gateway URL = the URL above, Gateway token = the pocketclaw_token you chose, and paste your Anthropic API key."
}

output "sandbox_note" {
  value = var.sandbox ? "Sandbox mode is ON by default — the agent has read/research tools only. Turn it off in Settings (⚙ → Sandbox mode) or redeploy with -var sandbox=false." : "Sandbox mode is OFF — the agent has full tool access on this VM."
}
