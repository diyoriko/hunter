#!/bin/bash
# Extract new tasks from strategist report and send as proposals for admin approval
# Tasks are sent to Telegram with Approve/Reject buttons
# Approved tasks are fetched via /proposals HTTP endpoint on next run

set -euo pipefail

REPORT_FILE="$1"
BACKLOG_FILE="$2"
BOT_TOKEN="${3:-}"
ADMIN_CHAT_ID="${4:-}"
BOT_URL="${5:-}"

if [ ! -f "$REPORT_FILE" ]; then
  echo "Report not found: $REPORT_FILE"
  exit 1
fi

if [ ! -f "$BACKLOG_FILE" ]; then
  echo "Backlog not found: $BACKLOG_FILE"
  exit 1
fi

# Extract tasks from "Новые задачи в бэклог" section
TASKS=$(awk '
  /^## Новые задачи в бэклог/ { found=1; next }
  /^## / { if(found) exit }
  /^- \[/ { if(found) print }
' "$REPORT_FILE")

if [ -z "$TASKS" ]; then
  echo "No new tasks found in report"
  exit 0
fi

TASK_COUNT=$(echo "$TASKS" | wc -l | tr -d ' ')
echo "Found $TASK_COUNT new tasks"

# Check for duplicates against existing backlog
SENT=0
while IFS= read -r task; do
  # Extract task name (bold text)
  TASK_NAME=$(echo "$task" | sed -n 's/.*\*\*\(.*\)\*\*.*/\1/p')
  if [ -z "$TASK_NAME" ]; then
    continue
  fi

  # Check if task already exists in backlog
  if grep -qF "$TASK_NAME" "$BACKLOG_FILE"; then
    echo "Skip (exists): $TASK_NAME"
    continue
  fi

  # If no bot credentials, fall back to direct BACKLOG.md edit (legacy mode)
  if [ -z "$BOT_TOKEN" ] || [ -z "$ADMIN_CHAT_ID" ] || [ -z "$BOT_URL" ]; then
    echo "No bot credentials — adding directly to backlog: $TASK_NAME"
    add_task_to_backlog "$task" "$BACKLOG_FILE"
    continue
  fi

  # Save proposal to bot DB via HTTP and get ID
  PROPOSAL_ID=$(curl -s -X POST "${BOT_URL}/proposal" \
    -H "Content-Type: application/json" \
    -H "x-admin-token: ${BOT_TOKEN}" \
    -d "{\"task_text\": $(echo "$task" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))')}" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('id', ''))" 2>/dev/null || echo "")

  if [ -z "$PROPOSAL_ID" ]; then
    echo "Failed to save proposal to bot DB, skipping: $TASK_NAME"
    continue
  fi

  # Send as Telegram message with Approve/Reject inline buttons
  ESCAPED_TASK=$(echo "$task" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))')

  PAYLOAD=$(cat <<ENDJSON
{
  "chat_id": "${ADMIN_CHAT_ID}",
  "text": "📋 Предложение стратега:\n\n${task}",
  "reply_markup": {
    "inline_keyboard": [[
      {"text": "✅ Одобрить", "callback_data": "prop_approve:${PROPOSAL_ID}"},
      {"text": "❌ Отклонить", "callback_data": "prop_reject:${PROPOSAL_ID}"}
    ]]
  }
}
ENDJSON
)

  # Use python to build proper JSON to avoid escaping issues
  python3 -c "
import json, urllib.request

task_text = $(echo "$task" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))')
payload = {
    'chat_id': '${ADMIN_CHAT_ID}',
    'text': f'📋 Предложение стратега:\n\n{task_text}',
    'reply_markup': {
        'inline_keyboard': [[
            {'text': '✅ Одобрить', 'callback_data': 'prop_approve:${PROPOSAL_ID}'},
            {'text': '❌ Отклонить', 'callback_data': 'prop_reject:${PROPOSAL_ID}'}
        ]]
    }
}
data = json.dumps(payload).encode()
req = urllib.request.Request(
    'https://api.telegram.org/bot${BOT_TOKEN}/sendMessage',
    data=data,
    headers={'Content-Type': 'application/json'}
)
try:
    urllib.request.urlopen(req)
except Exception as e:
    print(f'Telegram send failed: {e}')
" 2>&1 || echo "Telegram notification failed for: $TASK_NAME"

  echo "Sent proposal: $TASK_NAME (id: $PROPOSAL_ID)"
  SENT=$((SENT + 1))
done <<< "$TASKS"

echo "Sent $SENT proposals for approval"
