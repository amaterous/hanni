#!/bin/bash
# Get your CLAUDE_CODE_OAUTH_TOKEN for use in Railway / Fly.io deployment.
#
# Usage:
#   ./scripts/get-claude-token.sh
#
# Requires Claude Code to be installed and logged in (claude login).

set -e

TOKEN="${CLAUDE_CODE_OAUTH_TOKEN:-}"

if [ -z "$TOKEN" ]; then
  echo "Error: CLAUDE_CODE_OAUTH_TOKEN is not set in your environment." >&2
  echo "Make sure Claude Code is installed and you are logged in:" >&2
  echo "  claude login" >&2
  exit 1
fi

echo "Your CLAUDE_CODE_OAUTH_TOKEN:"
echo ""
echo "$TOKEN"
echo ""
echo "Set this as an environment variable in your deployment:"
echo "  Railway: Settings → Variables → CLAUDE_CODE_OAUTH_TOKEN"
echo "  Fly.io:  fly secrets set CLAUDE_CODE_OAUTH_TOKEN=$TOKEN"
