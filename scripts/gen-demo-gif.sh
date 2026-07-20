#!/bin/bash
# gen-demo-gif.sh — hanni のデモ GIF を自動生成
#
# 動作:
#   1. 画面録画を自動スタート（ffmpeg）
#   2. ユーザーが Slack で @hanni にメッセージを送る（手動）
#   3. GitHub API で PR 作成を監視
#   4. PR 検知 → 録画停止 → GIF 変換
#
# 必要な環境変数:
#   GITHUB_TOKEN   repo scope の Personal Access Token
#   GITHUB_REPO    監視するリポジトリ (例: yuppppppppppqi/cortexlab)
#
# 使い方:
#   export GITHUB_TOKEN=ghp_xxx
#   export GITHUB_REPO=yuppppppppppqi/cortexlab
#   ./scripts/gen-demo-gif.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TMP_DIR="/tmp/hanni-demo-$$"
OUTPUT_MP4="$TMP_DIR/recording.mp4"
OUTPUT_GIF="$REPO_ROOT/demo.gif"
TIMEOUT_SEC=600   # 10分でタイムアウト
SPEED_FACTOR=5    # GIF の早送り倍率

# --- 必須 env var チェック ---
: "${GITHUB_TOKEN:?GITHUB_TOKEN が設定されていません}"
: "${GITHUB_REPO:?GITHUB_REPO が設定されていません (例: yuppppppppppqi/cortexlab)}"

mkdir -p "$TMP_DIR"

# --- 開始前の PR 番号を記録 ---
LATEST_PR_BEFORE=$(curl -s \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/$GITHUB_REPO/pulls?state=open&sort=created&direction=desc&per_page=1" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['number'] if d else 0)" 2>/dev/null || echo "0")

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎬 hanni デモ GIF 生成"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "監視リポ: $GITHUB_REPO (PR #${LATEST_PR_BEFORE} 以降を検知)"
echo "出力先  : $OUTPUT_GIF"
echo ""
echo "準備:"
echo "  1. Slack の hanni チャンネルを画面に表示"
echo "  2. GitHub のリポジトリページも開いておく（横並びで）"
echo ""
read -p "▶  準備できたら Enter を押してください..."

# --- 画面録画スタート ---
echo ""
echo "🔴 録画開始！"
echo "   → Slack で @hanni にタスクを送ってください"
echo "   → PR が作られたら自動で録画が止まります"
echo ""

ffmpeg -f avfoundation -i "1:none" \
  -r 10 -vf "scale=1200:-2" -c:v libx264 -preset ultrafast -crf 28 \
  "$OUTPUT_MP4" -y 2>/tmp/hanni-ffmpeg-$$.log &
FFMPEG_PID=$!

# ffmpeg が起動するまで少し待つ
sleep 2

# --- PR 監視ループ ---
START=$(date +%s)
PR_URL=""

while true; do
  sleep 8
  ELAPSED=$(( $(date +%s) - START ))

  RESULT=$(curl -s \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
    "https://api.github.com/repos/$GITHUB_REPO/pulls?state=open&sort=created&direction=desc&per_page=1" \
    | python3 -c "
import sys,json
d=json.load(sys.stdin)
if d and d[0]['number'] > $LATEST_PR_BEFORE:
    print(d[0]['number'], d[0]['html_url'])
else:
    print('0')
" 2>/dev/null || echo "0")

  NEW_NUM=$(echo "$RESULT" | awk '{print $1}')
  NEW_URL=$(echo "$RESULT" | awk '{print $2}')

  if [ "$NEW_NUM" != "0" ] && [ -n "$NEW_URL" ]; then
    PR_URL="$NEW_URL"
    echo "✅ PR を検知: $PR_URL"
    break
  fi

  if [ "$ELAPSED" -ge "$TIMEOUT_SEC" ]; then
    echo "⚠️  ${TIMEOUT_SEC}秒タイムアウト"
    break
  fi

  MINS=$((ELAPSED / 60))
  SECS=$((ELAPSED % 60))
  printf "\r   ⏳ PR 待機中... %02d:%02d" "$MINS" "$SECS"
done

echo ""

# PR 検知後、Slack に通知が出るまで少し待つ
if [ -n "$PR_URL" ]; then
  echo "   5秒後に録画停止..."
  sleep 5
fi

# --- 録画停止 ---
echo "⏹  録画停止"
kill "$FFMPEG_PID" 2>/dev/null || true
wait "$FFMPEG_PID" 2>/dev/null || true

if [ ! -f "$OUTPUT_MP4" ] || [ ! -s "$OUTPUT_MP4" ]; then
  echo "❌ 録画ファイルがありません。ffmpeg のログ: /tmp/hanni-ffmpeg-$$.log"
  exit 1
fi

# --- GIF 変換 ---
echo ""
echo "🎨 GIF 変換中... (${SPEED_FACTOR}倍速)"

SPEED_PTS=$(python3 -c "print(round(1/$SPEED_FACTOR, 4))")
ffmpeg -i "$OUTPUT_MP4" \
  -vf "setpts=${SPEED_PTS}*PTS,fps=8,scale=1000:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" \
  "$OUTPUT_GIF" -y 2>/dev/null

GIF_SIZE=$(du -h "$OUTPUT_GIF" | cut -f1)

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 完了！"
echo "   GIF: $OUTPUT_GIF ($GIF_SIZE)"
[ -n "$PR_URL" ] && echo "   PR : $PR_URL"
echo ""
echo "README.md に貼る:"
echo '   ![hanni demo](./demo.gif)'
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

rm -rf "$TMP_DIR"
