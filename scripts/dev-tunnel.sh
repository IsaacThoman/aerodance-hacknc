#!/usr/bin/env bash
# Local dev stack behind a Cloudflare quick tunnel: rebuilds the Docker services with
# PUBLIC_URL set to the tunnel, so texted links and NFT metadata work from real phones.
# .git/hooks/post-commit runs this after every commit; run it by hand any time.
# A running tunnel is reused, since its URL only changes when cloudflared restarts
# (and trophies minted against an old URL lose their metadata).
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" # git hooks from editors get a bare PATH
cd "$(dirname "$0")/.."

STATE=.dev-tunnel # gitignored: cloudflared's pid and log, the current URL
COMPOSE=(docker compose -f compose.yaml -f compose.local.yaml)
mkdir -p "$STATE"

# The host port compose.local.yaml publishes the app on (PORT in .env, default 3000).
PORT=$("${COMPOSE[@]}" config --format json | python3 -c \
  'import json, sys; print(next(p["published"] for p in json.load(sys.stdin)["services"]["app"]["ports"] if p["target"] == 3000))')

tunnel_url() { grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$STATE/cloudflared.log" 2>/dev/null | head -1 || true; }

if [ -f "$STATE/cloudflared.pid" ] && kill -0 "$(cat "$STATE/cloudflared.pid")" 2>/dev/null && [ -n "$(tunnel_url)" ]; then
  echo "reusing tunnel $(tunnel_url)"
else
  nohup cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" >"$STATE/cloudflared.log" 2>&1 &
  echo $! >"$STATE/cloudflared.pid"
  for _ in $(seq 1 60); do
    [ -n "$(tunnel_url)" ] && break
    sleep 0.5
  done
  [ -n "$(tunnel_url)" ] || { echo "cloudflared printed no URL, see $STATE/cloudflared.log" >&2; exit 1; }
  echo "new tunnel $(tunnel_url)"
fi
URL=$(tunnel_url)
echo "$URL" >"$STATE/url"

# A PUBLIC_URL in the environment wins over the one in .env when Compose fills in compose.yaml.
PUBLIC_URL="$URL" "${COMPOSE[@]}" up -d --build
echo "🫧 aerodance is live at $URL"
