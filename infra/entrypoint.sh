#!/bin/bash
set -euo pipefail

# Required environment variables
: "${CLAUDE_CODE_OAUTH_TOKEN:?CLAUDE_CODE_OAUTH_TOKEN is required}"
: "${GH_TOKEN:?GH_TOKEN is required}"

# Configure GitHub CLI
echo "$GH_TOKEN" | su - hanni -c "gh auth login --with-token"
su - hanni -c "gh auth setup-git"

# Configure git
su - hanni -c "git config --global user.name 'hanni'"
su - hanni -c "git config --global user.email 'hanni@noreply.github.com'"

# Setup Caddy if DOMAIN is provided
if [ -n "${HANNI_DOMAIN:-}" ]; then
  cat > /etc/caddy/Caddyfile <<EOF
${HANNI_DOMAIN} {
    reverse_proxy localhost:3460
}
EOF
  caddy start --config /etc/caddy/Caddyfile &
  echo "Caddy started for ${HANNI_DOMAIN}"
fi

# Configure OpenClaw if ANTHROPIC_API_KEY is provided
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  echo "Configuring OpenClaw authentication..."
  su - hanni -c "mkdir -p /home/hanni/.openclaw/agents/main/agent"
  su - hanni -c "cat > /home/hanni/.openclaw/agents/main/agent/auth-profiles.json <<EOF
{
  \"anthropic\": {
    \"provider\": \"anthropic\",
    \"key\": \"${ANTHROPIC_API_KEY}\",
    \"profiles\": [
      {
        \"id\": \"default\",
        \"name\": \"Default Anthropic Profile\",
        \"selected\": true
      }
    ]
  }
}
EOF"
fi

# Seed CLAUDE.md if not already present (volume persists hanni's own edits)
if [ ! -s /home/hanni/.claude/CLAUDE.md ]; then
  cp /opt/hanni/CLAUDE.md.default /home/hanni/.claude/CLAUDE.md
  chown hanni:hanni /home/hanni/.claude/CLAUDE.md
  echo "Seeded CLAUDE.md from default"
fi
# Ensure onboarding skip exists in volume
if [ ! -f /home/hanni/.claude.json ]; then
  echo '{"hasCompletedOnboarding":true}' > /home/hanni/.claude.json
  chown hanni:hanni /home/hanni/.claude.json
fi

# Fix npm cache permissions (may be root-owned from previous builds)
chown -R hanni:hanni /home/hanni/.npm 2>/dev/null || true

# Start hanni
echo "Starting hanni..."
exec su - hanni -c "cd /opt/hanni && CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_CODE_OAUTH_TOKEN} PATH=/home/hanni/.local/bin:/home/hanni/.bun/bin:\$PATH bun run src/index.ts"
