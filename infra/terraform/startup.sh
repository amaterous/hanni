#!/bin/bash
set -euo pipefail

# Skip if Docker is already installed
if command -v docker &>/dev/null; then
  echo "Docker already installed, skipping setup"
  exit 0
fi

echo "=== Installing Docker ==="
apt-get update
apt-get install -y ca-certificates curl gnupg

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Allow non-root users to use Docker
for user in yun ubuntu deploy claude; do
  if id "$user" &>/dev/null; then
    usermod -aG docker "$user"
  fi
done

systemctl enable docker
systemctl start docker

echo "=== Docker installed successfully ==="
docker --version
docker compose version
