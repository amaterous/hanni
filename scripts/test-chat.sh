#!/bin/bash
# Test hanni's Slack chat mode via GCE server
# Usage: ./test-chat.sh "メッセージ"                    (dry-run, default: MyWork)
#        ./test-chat.sh --sky "メッセージ"               (dry-run, SKY workspace)
#        ./test-chat.sh --live "メッセージ"              (LIVE: posts to #random)
#        ./test-chat.sh --live --sky "メッセージ"        (LIVE: posts to SKY #random)
#
# Required env vars:
#   HANNI_URL                   Base URL of hanni server (e.g. https://your-server.example.com)
#   SLACK_SIGNING_SECRET        Signing secret for MyWork workspace
#   SLACK_SIGNING_SECRET_SKY    Signing secret for SKY workspace

set -euo pipefail

# Parse flags
WORKSPACE="mywork"
LIVE=false
while [[ "${1:-}" == --* ]]; do
  case "$1" in
    --sky)  WORKSPACE="sky"; shift ;;
    --live) LIVE=true; shift ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

RAW_MESSAGE="${1:?Usage: ./test-chat.sh [--live] [--sky] \"メッセージ\"}"

# Simulate Slack's URL formatting: domain.tld → <http://domain.tld|domain.tld>
# This matches what Slack actually does when a user types a URL
MESSAGE=$(echo "$RAW_MESSAGE" | perl -pe 's{(https?://[^ ]+)}{<$1|$1>}g; s{([a-zA-Z0-9.-]+\.(?:site|com|net|org|dev|app|io))([^ ]*)}{<http://$1$2|$1$2>}g')

case "$WORKSPACE" in
  mywork) SIGNING_SECRET="${SLACK_SIGNING_SECRET:?SLACK_SIGNING_SECRET is not set}" ;;
  sky)    SIGNING_SECRET="${SLACK_SIGNING_SECRET_SKY:?SLACK_SIGNING_SECRET_SKY is not set}" ;;
esac

BASE_URL="${HANNI_URL:?HANNI_URL is not set}"
URL="${BASE_URL%/}/slack/events"

# Live mode: use real channel + real user ID (not U_TEST → no dry-run)
# Dry-run mode: use C_TEST + U_TEST (logs only, no Slack posting)
if [ "$LIVE" = true ]; then
  case "$WORKSPACE" in
    mywork) CHANNEL="C0AF6BJ1Z4K" ;;  # #random (MyWork)
    sky)    CHANNEL="C0AG9H67KE2" ;;   # TODO: set SKY test channel
  esac
  USER_ID="U_LIVE_TEST"
  echo "🔴 LIVE MODE — posting to Slack #random"
else
  CHANNEL="C_TEST"
  USER_ID="U_TEST"
fi

TIMESTAMP=$(date +%s)
UNIQUE_TS="${TIMESTAMP}.$(printf '%06d' $((RANDOM * RANDOM % 1000000)))"
BODY=$(cat <<EOF
{"type":"event_callback","event":{"type":"app_mention","text":"<@U1234> ${MESSAGE}","user":"${USER_ID}","channel":"${CHANNEL}","ts":"${UNIQUE_TS}"}}
EOF
)

# Generate Slack signature
SIG_BASE="v0:${TIMESTAMP}:${BODY}"
SIGNATURE="v0=$(echo -n "$SIG_BASE" | openssl dgst -sha256 -hmac "$SIGNING_SECRET" | awk '{print $2}')"

echo "💬 [${WORKSPACE}$([ "$LIVE" = true ] && echo " LIVE" || echo " dry-run")] \"${MESSAGE}\""
echo "⏳ sending to hanni..."
echo ""

# Send request
RESPONSE=$(curl -s -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "X-Slack-Signature: ${SIGNATURE}" \
  -H "X-Slack-Request-Timestamp: ${TIMESTAMP}" \
  -d "$BODY")

echo "📨 Server response: ${RESPONSE}"
echo ""
if [ "$LIVE" = true ]; then
  echo "📋 Check Slack #random for hanni's reply"
else
  echo "📋 Check logs for hanni's reply:"
  echo "   bash infra/scripts/deploy.sh logs hanni"
fi
