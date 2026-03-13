#!/bin/bash
# Hunter bot runner for launchd
# Ensures correct PATH for node and claude CLI

export PATH="/Users/diyoriko/.nvm/versions/node/v22.22.0/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

cd /Users/diyoriko/Documents/Projects/Hunter

# Load .env
set -a
source .env
set +a

exec node dist/index.js
