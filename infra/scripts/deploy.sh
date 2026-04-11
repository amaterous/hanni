#!/bin/bash
set -euo pipefail

# Deploy script for hanni on GCE
# Usage: ./deploy.sh [command]

PROJECT="hanni-hosting-2025"
ZONE="us-east1-b"
INSTANCE="bro-runners-new"
REMOTE_DIR="github-runners"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

ssh_hanni() {
  gcloud compute ssh "$INSTANCE" --project="$PROJECT" --zone="$ZONE" --command="$1"
}
scp_to_hanni() {
  gcloud compute scp --recurse "$1" "$INSTANCE:$2" --project="$PROJECT" --zone="$ZONE"
}

deploy_hanni() {
  local infra_dir="$REPO_ROOT/infra"
  local staging_dir="/tmp/hanni-deploy-staging"

  echo "=== Deploying hanni ==="

  rm -rf "$staging_dir"
  mkdir -p "$staging_dir/hanni"

  tar cf - \
    --exclude=repos --exclude=worktrees --exclude=logs \
    --exclude=node_modules --exclude=.git --exclude=config.json \
    -C "$REPO_ROOT" . | tar xf - -C "$staging_dir/hanni"

  cp "$infra_dir/Dockerfile" "$staging_dir/"
  cp "$infra_dir/entrypoint.sh" "$staging_dir/"
  cp "$infra_dir/docker-compose.yml" "$staging_dir/"
  [ -f "$infra_dir/config.json" ] && cp "$infra_dir/config.json" "$staging_dir/"
  [ -f "$infra_dir/.env" ] && cp "$infra_dir/.env" "$staging_dir/"
  [ -f "$REPO_ROOT/CLAUDE.md" ] && cp "$REPO_ROOT/CLAUDE.md" "$staging_dir/"

  tar czf /tmp/hanni-deploy.tar.gz -C "$staging_dir" .
  rm -rf "$staging_dir"

  scp_to_hanni "/tmp/hanni-deploy.tar.gz" "~/$REMOTE_DIR/"
  rm -f /tmp/hanni-deploy.tar.gz

  ssh_hanni "
    cd ~/$REMOTE_DIR &&
    mkdir -p hanni &&
    tar xzf hanni-deploy.tar.gz &&
    rm hanni-deploy.tar.gz &&
    [ -f tokens.json ] || echo '{}' > tokens.json &&
    echo '=== Rebuilding hanni container ===' &&
    docker compose up -d --build hanni &&
    docker compose logs --tail=10 hanni
  "
}

status() {
  ssh_hanni "cd ~/$REMOTE_DIR && docker compose ps"
}

logs() {
  local service="${2:-hanni}"
  ssh_hanni "cd ~/$REMOTE_DIR && docker compose logs --tail=50 $service"
}

stream_logs() {
  local service="${2:-hanni}"
  ssh_hanni "cd ~/$REMOTE_DIR && docker compose logs --follow --tail=100 $service"
}

install_docker() {
  echo "=== Installing Docker on hanni VM ==="
  ssh_hanni "$(cat "$(dirname "$0")/../terraform/startup.sh")"
}

case "${1:-help}" in
  deploy)             deploy_hanni ;;
  status)             status ;;
  logs)               logs "$@" ;;
  stream-logs)        stream_logs "$@" ;;
  install-docker)     install_docker ;;
  help)
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  deploy        Deploy hanni to GCE"
    echo "  status        Show container status"
    echo "  logs [svc]    Show logs"
    echo "  stream-logs   Stream logs in real-time"
    echo "  install-docker  Install Docker on VM"
    ;;
  *) echo "Unknown command: $1"; exit 1 ;;
esac
