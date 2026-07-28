#!/usr/bin/env bash
# Serve the Fayr Support (admin) panel — a self-contained static page that talks
# to the NestJS backend. No build step, no dependencies.
#
# Usage:
#   bash scripts/serve-admin-panel.sh [PORT]
#
# Then open http://localhost:<PORT>/ and sign in with a staff account.
# The panel auto-targets the backend at http://<this-host>:3000. To point it
# elsewhere, append ?api=<base-url> to the URL, e.g.
#   http://localhost:8090/?api=http://192.168.1.5:3000
set -euo pipefail

PORT="${1:-8090}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/admin-panel"

if [ ! -f "$DIR/index.html" ]; then
  echo "error: $DIR/index.html not found" >&2
  exit 1
fi

echo "Fayr Support panel → http://localhost:${PORT}/"
echo "(serving $DIR — Ctrl-C to stop)"
exec python3 -m http.server "$PORT" --directory "$DIR"
