#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io curl git jq sqlite3
systemctl enable --now docker
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
install -d -m 700 /opt/frank /var/lib/frank /etc/frank
if [[ ! -d /opt/frank/repo/.git ]]; then
  git clone --branch main --single-branch git@github.com:Dansatch/frank.git /opt/frank/repo
fi
/opt/frank/repo/deploy/gcp/install-ops.sh /opt/frank/repo
/usr/local/sbin/frank-update
