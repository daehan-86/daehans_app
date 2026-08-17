#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
PORT="${1:-8080}"
echo "PR+: http://localhost:${PORT}"
python3 -m http.server "$PORT"
