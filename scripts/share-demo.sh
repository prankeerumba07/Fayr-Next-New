#!/usr/bin/env bash
#
# Expose the local Fayr prototype + backend over ONE public HTTPS URL using a
# Cloudflare quick tunnel — for demoing the login flow on a phone over LTE, with
# no matching WiFi/hotspot needed and no account/signup.
#
# Start these FIRST (separate terminals, from the repo root):
#   backend/  :  docker compose up -d  &&  npm run start:dev     # API on :3000
#   repo root :  npm run web:preview                             # prototype on :8000
#
# Then run:   bash scripts/share-demo.sh
# It prints the single public link to open on your phone. Ctrl+C stops the tunnel.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROXY_PORT="${PROXY_PORT:-8080}"

command -v cloudflared >/dev/null 2>&1 || {
  echo "cloudflared is not installed. Install it with:  brew install cloudflared"
  exit 1
}

# 1) Single-origin reverse proxy in front of the API (:3000) and prototype (:8000).
PROXY_PORT="$PROXY_PORT" node "$ROOT/scripts/demo-proxy.mjs" &
PROXY_PID=$!

# 2) Cloudflare quick tunnel over the proxy (no account needed, no interstitial).
TUN_LOG="$(mktemp)"
cloudflared tunnel --url "http://localhost:${PROXY_PORT}" >"$TUN_LOG" 2>&1 &
TUN_PID=$!

cleanup() { kill "$PROXY_PID" "$TUN_PID" 2>/dev/null || true; rm -f "$TUN_LOG"; }
trap cleanup EXIT INT TERM

# 3) Wait for the public URL to show up in the tunnel log.
URL=""
for _ in $(seq 1 40); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUN_LOG" | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 1
done

if [ -z "$URL" ]; then
  echo "Timed out waiting for the tunnel URL. cloudflared output:"
  cat "$TUN_LOG"
  exit 1
fi

echo
echo "  ============================================================"
echo "   Open this on your phone (LTE is fine):"
echo "     $URL"
echo "  ============================================================"
echo
echo "  Login: Continue with phone number -> enter number -> SEND OTP,"
echo "  then read the 6-digit code from your backend terminal and enter it."
echo
echo "  Leave this running. Press Ctrl+C to stop the tunnel."
wait "$TUN_PID"
