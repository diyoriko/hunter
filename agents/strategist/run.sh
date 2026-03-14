#!/bin/bash
# Hunter Strategist Agent
# Runs daily, analyzes project, outputs report, notifies admin via Telegram

set -euo pipefail

PROJECT_DIR="${HUNTER_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
REPORTS_DIR="$PROJECT_DIR/reports/strategist"
AGENT_DIR="$PROJECT_DIR/agents/strategist"
DATE=$(date +%Y-%m-%d)
REPORT_FILE="$REPORTS_DIR/$DATE.md"
TMP_PROMPT=$(mktemp)

# Telegram notification config — prefer env var, fall back to .env file
BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
if [ -z "$BOT_TOKEN" ] && [ -f "$PROJECT_DIR/.env" ]; then
  BOT_TOKEN=$(grep TELEGRAM_BOT_TOKEN "$PROJECT_DIR/.env" | cut -d= -f2)
fi
ADMIN_CHAT_ID="${ADMIN_TELEGRAM_ID:?Set ADMIN_TELEGRAM_ID env var}"

# Bot HTTP URL for proposal API (Railway)
BOT_URL="${HUNTER_BOT_URL:-https://hunter-production-0b65.up.railway.app}"

# PATH for claude CLI and node (Mac-specific paths added only if they exist)
if [ -d "$HOME/.nvm/versions/node" ]; then
  NVM_BIN=$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | tail -1)
  export PATH="$HOME/.local/bin:${NVM_BIN:-}:/usr/local/bin:/usr/bin:/bin:$PATH"
fi

# Don't run inside Claude Code
unset CLAUDECODE 2>/dev/null || true

cleanup() { rm -f "$TMP_PROMPT"; }
trap cleanup EXIT

mkdir -p "$REPORTS_DIR"

# Skip if report already exists today
if [ -f "$REPORT_FILE" ]; then
  echo "Report for $DATE already exists, skipping"
  exit 0
fi

# Apply previously approved proposals to BACKLOG.md
echo "$(date -Iseconds) Checking for approved proposals..."
bash "$AGENT_DIR/apply-proposals.sh" "$PROJECT_DIR/BACKLOG.md" "$BOT_TOKEN" "$BOT_URL" || \
  echo "$(date -Iseconds) Proposal fetch failed (non-critical)"

echo "$(date -Iseconds) Starting strategist analysis..."

# Build prompt as a file (avoids bash string issues with large content)
{
  cat "$AGENT_DIR/prompt.md"
  echo ""
  echo "---"
  echo ""
  echo "Сегодня: $DATE"
  echo ""
  echo "=== CLAUDE.md ==="
  cat "$PROJECT_DIR/CLAUDE.md"
  echo ""
  echo "=== BACKLOG.md ==="
  cat "$PROJECT_DIR/BACKLOG.md"

  # Include last report for continuity
  LAST_REPORT=$(ls -t "$REPORTS_DIR"/*.md 2>/dev/null | head -1 || true)
  if [ -n "$LAST_REPORT" ]; then
    echo ""
    echo "=== Предыдущий отчёт ==="
    cat "$LAST_REPORT"
  fi

  # Include one-time extra tasks if they exist
  EXTRA_DIR="$AGENT_DIR/extra"
  if [ -d "$EXTRA_DIR" ]; then
    for f in "$EXTRA_DIR"/*.md; do
      [ -f "$f" ] || continue
      echo ""
      echo "=== ДОПОЛНИТЕЛЬНОЕ ЗАДАНИЕ ==="
      cat "$f"
    done
  fi

  echo ""
  echo "---"
  echo ""
  echo "Напиши отчёт стратега на сегодня. Следуй формату из промпта. Будь конкретным и actionable."
} > "$TMP_PROMPT"

# Run Claude
echo "$(date -Iseconds) Running Claude analysis..."
if ! REPORT=$(claude --print --model claude-sonnet-4-6 < "$TMP_PROMPT" 2>&1); then
  echo "$(date -Iseconds) Claude failed: $REPORT"
  exit 1
fi

# Save report
echo "$REPORT" > "$REPORT_FILE"
echo "$(date -Iseconds) Report saved to $REPORT_FILE"

# Extract new tasks from report and send as proposals for approval
echo "$(date -Iseconds) Extracting tasks and sending proposals..."
bash "$AGENT_DIR/extract-tasks.sh" "$REPORT_FILE" "$PROJECT_DIR/BACKLOG.md" "$BOT_TOKEN" "$ADMIN_CHAT_ID" "$BOT_URL" || \
  echo "$(date -Iseconds) Task extraction failed (non-critical)"

# Sync backlog.html with updated BACKLOG.md
echo "$(date -Iseconds) Syncing backlog.html..."
bash "$AGENT_DIR/sync-backlog.sh" "$PROJECT_DIR/BACKLOG.md" "$PROJECT_DIR/index.html" || \
  echo "$(date -Iseconds) Backlog sync failed (non-critical)"

# Send Telegram notification (plain text, avoid HTML parsing issues)
PREVIEW=$(echo "$REPORT" | head -30)
NOTIFY_TEXT="$(cat <<EOF
Отчёт стратега Hunter — $DATE

${PREVIEW}

...полный отчёт в reports/strategist/$DATE.md
EOF
)"

# Truncate to Telegram limit
NOTIFY_TEXT="${NOTIFY_TEXT:0:4000}"

curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -d "chat_id=${ADMIN_CHAT_ID}" \
  -d "disable_web_page_preview=true" \
  --data-urlencode "text=${NOTIFY_TEXT}" \
  > /dev/null 2>&1 || echo "$(date -Iseconds) Telegram notification failed"

# Clean up one-time extra tasks after successful run
if [ -d "$EXTRA_DIR" ]; then
  rm -f "$EXTRA_DIR"/*.md
  echo "$(date -Iseconds) Cleaned up extra tasks"
fi

echo "$(date -Iseconds) Strategist complete"
