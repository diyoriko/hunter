#!/bin/bash
# Sync BACKLOG.md content into backlog.html's embedded BACKLOG_MD constant
# This keeps the web dashboard up to date when strategist adds tasks

set -euo pipefail

BACKLOG_MD="$1"
BACKLOG_HTML="$2"

if [ ! -f "$BACKLOG_MD" ]; then
  echo "BACKLOG.md not found: $BACKLOG_MD"
  exit 1
fi

if [ ! -f "$BACKLOG_HTML" ]; then
  echo "backlog.html not found: $BACKLOG_HTML"
  exit 1
fi

# Read BACKLOG.md, escape backticks and backslashes for JS template literal
MD_CONTENT=$(cat "$BACKLOG_MD" | sed 's/\\/\\\\/g' | sed 's/`/\\`/g' | sed 's/\$/\\$/g')

# Replace everything between BACKLOG_MD = ` and the closing `;
# Use python for reliable multiline replacement
python3 -c "
import re, sys

with open('$BACKLOG_HTML', 'r') as f:
    html = f.read()

with open('$BACKLOG_MD', 'r') as f:
    md = f.read()

# Escape for JS template literal
md = md.replace('\\\\', '\\\\\\\\').replace('\`', '\\\\\`').replace('\$', '\\\\\$')

# Replace the BACKLOG_MD constant content
pattern = r'(const BACKLOG_MD = \`).*?(\`;)'
replacement = r'\1' + md.replace('\\\\', '\\\\\\\\') + r'\2'
new_html = re.sub(pattern, replacement, html, flags=re.DOTALL)

if new_html == html:
    print('No changes needed')
    sys.exit(0)

with open('$BACKLOG_HTML', 'w') as f:
    f.write(new_html)

print('backlog.html updated')
"

echo "Sync complete"
