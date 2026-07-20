#!/bin/bash
set -euo pipefail

# Deploy script for hanni on Hetzner (docker compose)
# Usage: ./deploy.sh [command]
#
# Requires: infra/scripts/.env.deploy (copy from .env.deploy.example and fill in values)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.deploy"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found."
  echo "Copy $SCRIPT_DIR/.env.deploy.example to $ENV_FILE and fill in your Hetzner values."
  exit 1
fi

# shellcheck source=.env.deploy
source "$ENV_FILE"

REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

ssh_hanni() {
  ssh "$HETZNER_HOST" "$1"
}
scp_to_hanni() {
  scp -r "$1" "$HETZNER_HOST:$2"
}

deploy_hanni() {
  local infra_dir="$REPO_ROOT/infra"
  local staging_dir="/tmp/hanni-deploy-staging"

  echo "=== Deploying hanni to Hetzner ($HETZNER_HOST:$REMOTE_DIR) ==="

  rm -rf "$staging_dir"
  mkdir -p "$staging_dir/hanni"

  tar cf - \
    --exclude=repos --exclude=worktrees --exclude=logs \
    --exclude=node_modules --exclude=.git --exclude=config.json \
    -C "$REPO_ROOT" . | tar xf - -C "$staging_dir/hanni"

  cp "$infra_dir/Dockerfile" "$staging_dir/"
  cp "$infra_dir/entrypoint.sh" "$staging_dir/"
  cp "$infra_dir/docker-compose.yml" "$staging_dir/"
  # config.json is intentionally NOT deployed here — server config is live state
  # (schedule jobs etc. would be silently wiped). Use ./deploy.sh config instead.
  [ -f "$REPO_ROOT/CLAUDE.md" ] && cp "$REPO_ROOT/CLAUDE.md" "$staging_dir/"

  tar czf /tmp/hanni-deploy.tar.gz -C "$staging_dir" .
  rm -rf "$staging_dir"

  scp_to_hanni "/tmp/hanni-deploy.tar.gz" "$REMOTE_DIR/hanni-deploy.tar.gz"
  rm -f /tmp/hanni-deploy.tar.gz

  ssh_hanni "
    cd $REMOTE_DIR &&
    tar xzf hanni-deploy.tar.gz &&
    rm hanni-deploy.tar.gz &&
    [ -f tokens.json ] || echo '{}' > tokens.json &&
    echo '=== Rebuilding hanni container ===' &&
    docker compose up -d --build hanni &&
    docker compose logs --tail=10 hanni
  "
}

push_config() {
  local local_cfg="$REPO_ROOT/config.json"
  local remote_cfg="$REMOTE_DIR/config.json"
  local server_copy="/tmp/hanni-server-config.json"

  if ! python3 -m json.tool "$local_cfg" > /dev/null; then
    echo "Error: local config.json is not valid JSON. Aborting."
    exit 1
  fi

  ssh_hanni "cat $remote_cfg" > "$server_copy" 2>/dev/null || echo '{}' > "$server_copy"

  echo "=== Diff: server config → local config ==="
  if diff -u "$server_copy" "$local_cfg"; then
    echo "(no diff — server already matches local)"
  fi

  # Guard: top-level keys present on server but missing locally = likely stale local copy
  local missing
  missing=$(python3 -c "
import json, sys
server = json.load(open('$server_copy'))
local = json.load(open('$local_cfg'))
print(' '.join(sorted(set(server) - set(local))))
")
  if [ -n "$missing" ]; then
    echo ""
    echo "WARNING: these top-level keys exist on the SERVER but not in your local config.json:"
    echo "  $missing"
    echo "Pushing would DELETE them. Merge them into local config.json first."
  fi

  echo ""
  read -r -p "Push local config.json to server and restart hanni? [y/N] " ans
  if [ "$ans" != "y" ]; then
    echo "Aborted. Server config untouched."
    exit 1
  fi

  ssh_hanni "cp $remote_cfg $remote_cfg.bak.\$(date +%Y%m%d-%H%M%S) 2>/dev/null || true"
  scp_to_hanni "$local_cfg" "$remote_cfg"
  ssh_hanni "cd $REMOTE_DIR && docker compose restart hanni && docker compose logs --tail=10 hanni"
}

pull_config() {
  local local_cfg="$REPO_ROOT/config.json"
  cp "$local_cfg" "$local_cfg.bak.$(date +%Y%m%d-%H%M%S)"
  ssh_hanni "cat $REMOTE_DIR/config.json" > "$local_cfg"
  echo "Pulled server config.json → local (previous local saved as config.json.bak.*)"
}

status() {
  ssh_hanni "cd $REMOTE_DIR && docker compose ps"
}

logs() {
  local service="${2:-hanni}"
  ssh_hanni "cd $REMOTE_DIR && docker compose logs --tail=50 $service"
}

stream_logs() {
  local service="${2:-hanni}"
  ssh_hanni "cd $REMOTE_DIR && docker compose logs --follow --tail=100 $service"
}

case "${1:-help}" in
  deploy)             deploy_hanni ;;
  config)             push_config ;;
  pull-config)        pull_config ;;
  status)             status ;;
  logs)               logs "$@" ;;
  stream-logs)        stream_logs "$@" ;;
  help)
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  deploy        Deploy hanni code to Hetzner (does NOT touch server config.json)"
    echo "  config        Push local config.json to server (shows diff, backs up, confirms)"
    echo "  pull-config   Pull server config.json down to local"
    echo "  status        Show container status"
    echo "  logs [svc]    Show logs"
    echo "  stream-logs   Stream logs in real-time"
    ;;
  *) echo "Unknown command: $1"; exit 1 ;;
esac
