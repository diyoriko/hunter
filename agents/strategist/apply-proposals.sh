#!/bin/bash
# Fetch approved proposals from bot API and add them to BACKLOG.md
# Called at the beginning of each strategist run

set -euo pipefail

BACKLOG_FILE="$1"
BOT_TOKEN="$2"
BOT_URL="$3"

if [ ! -f "$BACKLOG_FILE" ]; then
  echo "Backlog not found: $BACKLOG_FILE"
  exit 1
fi

if [ -z "$BOT_TOKEN" ] || [ -z "$BOT_URL" ]; then
  echo "No bot credentials, skipping proposal fetch"
  exit 0
fi

# Fetch approved proposals
RESPONSE=$(curl -s -X GET "${BOT_URL}/proposals" \
  -H "x-admin-token: ${BOT_TOKEN}" 2>/dev/null || echo '{"proposals":[]}')

PROPOSAL_COUNT=$(echo "$RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(len(data.get('proposals', [])))
" 2>/dev/null || echo "0")

if [ "$PROPOSAL_COUNT" = "0" ]; then
  echo "No approved proposals"
  exit 0
fi

echo "Found $PROPOSAL_COUNT approved proposals"

# Process each proposal
echo "$RESPONSE" | python3 -c "
import json, sys, re

data = json.load(sys.stdin)
proposals = data.get('proposals', [])

with open('$BACKLOG_FILE', 'r') as f:
    backlog = f.read()

added = 0
for p in proposals:
    task = p['taskText'].strip()

    # Extract task name
    match = re.search(r'\*\*(.*?)\*\*', task)
    if not match:
        print(f'Skip (no name): {task[:50]}')
        continue

    task_name = match.group(1)

    # Check duplicate
    if task_name in backlog:
        print(f'Skip (exists): {task_name}')
        continue

    # Extract priority
    priority_match = re.search(r'\(P([0-3])\)', task)
    priority = f'P{priority_match.group(1)}' if priority_match else 'P1'

    # Remove priority hint from task
    clean_task = re.sub(r'\s*\(P[0-3]\)', '', task)

    # Find target group
    target = f'### {priority}:'

    if target in backlog:
        # Find last task line in this group
        lines = backlog.split('\n')
        last_task_idx = -1
        in_group = False
        for i, line in enumerate(lines):
            if line.startswith(target):
                in_group = True
            elif in_group and line.startswith('### '):
                in_group = False
            elif in_group and line.startswith('---'):
                in_group = False
            elif in_group and line.startswith('- ['):
                last_task_idx = i

        if last_task_idx >= 0:
            lines.insert(last_task_idx + 1, clean_task)
            backlog = '\n'.join(lines)
        else:
            # No tasks in group yet, insert after group header
            idx = backlog.index(target) + len(target)
            backlog = backlog[:idx] + '\n\n' + clean_task + backlog[idx:]
    elif '## Метаданные' in backlog:
        backlog = backlog.replace('## Метаданные', clean_task + '\n\n## Метаданные')
    else:
        backlog += '\n' + clean_task

    print(f'Added: {task_name}')
    added += 1

with open('$BACKLOG_FILE', 'w') as f:
    f.write(backlog)

print(f'Added {added} approved tasks to backlog')
"
