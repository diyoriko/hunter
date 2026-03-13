#!/bin/bash
# Extract new tasks from strategist report and append to BACKLOG.md
# Parses "## Новые задачи в бэклог" section from the report
# Tasks must follow format: - [ ] **Name** — description

set -euo pipefail

REPORT_FILE="$1"
BACKLOG_FILE="$2"

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

# Check for duplicates and append only new ones
ADDED=0
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

  # Find the right section to append to based on priority marker in the task
  # Default: append to the last P1 group in the active sprint
  # Format: tasks should include priority hint like (P0), (P1) etc.
  PRIORITY=$(echo "$task" | grep -oE '\(P[0-3]\)' | tr -d '()' || echo "")

  if [ -z "$PRIORITY" ]; then
    # Default to P1 if no priority specified
    PRIORITY="P1"
  fi

  # Remove priority hint from task text
  CLEAN_TASK=$(echo "$task" | sed "s/ *($PRIORITY)//")

  # Append task before the metadata section
  # Find "## Метаданные" line and insert before it
  if grep -q "^## Метаданные" "$BACKLOG_FILE"; then
    # Find the right priority group, or append before metadata
    TARGET_GROUP="### ${PRIORITY}:"
    if grep -q "^${TARGET_GROUP}" "$BACKLOG_FILE"; then
      # Find the last task line in this group and append after it
      # Use awk to insert after last "- [ ]" line in the target group
      awk -v task="$CLEAN_TASK" -v target="$TARGET_GROUP" '
        BEGIN { in_group=0; last_task=0 }
        $0 ~ "^"target { in_group=1 }
        in_group && /^### / && $0 !~ "^"target { in_group=0 }
        in_group && /^---/ { in_group=0 }
        in_group && /^- \[/ { last_task=NR }
        { lines[NR]=$0 }
        END {
          for(i=1; i<=NR; i++) {
            print lines[i]
            if(i==last_task) print task
          }
        }
      ' "$BACKLOG_FILE" > "${BACKLOG_FILE}.tmp" && mv "${BACKLOG_FILE}.tmp" "$BACKLOG_FILE"
    else
      # No matching group — append before metadata
      sed -i '' "/^## Метаданные/i\\
$CLEAN_TASK
" "$BACKLOG_FILE"
    fi
  else
    # No metadata section — append at end
    echo "$CLEAN_TASK" >> "$BACKLOG_FILE"
  fi

  echo "Added: $TASK_NAME"
  ADDED=$((ADDED + 1))
done <<< "$TASKS"

echo "Added $ADDED new tasks to backlog"
