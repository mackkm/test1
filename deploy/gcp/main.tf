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

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["pocketclaw"]
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

  metadata_startup_script = <<-SCRIPT
    #!/bin/bash
    set -euxo pipefail
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y curl git ca-certificates
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
    npm install -g @anthropic-ai/claude-code

    rm -rf /opt/pocketclaw
    git clone ${var.repo_url} /opt/pocketclaw
    mkdir -p /opt/pocketclaw-workspace

    cat > /etc/systemd/system/pocketclaw.service <<'UNIT'
    [Unit]
    Description=PocketClaw gateway
    After=network-online.target
    Wants=network-online.target

    [Service]
    Environment=PORT=3333
    Environment=POCKETCLAW_WORKSPACE=/opt/pocketclaw-workspace
    EnvironmentFile=/etc/pocketclaw.env
    ExecStart=/usr/bin/node /opt/pocketclaw/server/server.js
    Restart=always
    RestartSec=3

    [Install]
    WantedBy=multi-user.target
    UNIT

    cat > /etc/pocketclaw.env <<ENV
    POCKETCLAW_TOKEN=${var.pocketclaw_token}
    ENV
    chmod 600 /etc/pocketclaw.env

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
