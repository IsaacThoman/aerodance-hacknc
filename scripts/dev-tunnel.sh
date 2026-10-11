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

# -a: cloudflared's log can contain bytes that make grep call it binary.
tunnel_url() { grep -ao 'https://[a-z0-9-]*\.trycloudflare\.com' "$STATE/cloudflared.log" 2>/dev/null | head -1 || true; }
connected() { grep -aq 'Registered tunnel connection' "$STATE/cloudflared.log" 2>/dev/null; }
# A dead tunnel answers 530 (lost its edge connection) or not at all (000); anything else,
# even a 502 while the app rebuilds, means the tunnel itself works.
tunnel_ok() {
  local code
  code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$(tunnel_url)/api/health" || true)
  [ "$code" != 530 ] && [ "$code" != 000 ]
}

if [ -f "$STATE/cloudflared.pid" ] && kill -0 "$(cat "$STATE/cloudflared.pid")" 2>/dev/null && [ -n "$(tunnel_url)" ] && tunnel_ok; then
  echo "reusing tunnel $(tunnel_url)"
else
  [ -f "$STATE/cloudflared.pid" ] && kill "$(cat "$STATE/cloudflared.pid")" 2>/dev/null || true
  # HTTP/2 over TCP: QUIC (UDP) is blocked or flaky on some networks.
  nohup cloudflared tunnel --no-autoupdate --protocol http2 --url "http://localhost:$PORT" >"$STATE/cloudflared.log" 2>&1 &
  echo $! >"$STATE/cloudflared.pid"
  for _ in $(seq 1 60); do
    [ -n "$(tunnel_url)" ] && break
    sleep 0.5
  done
  [ -n "$(tunnel_url)" ] || { echo "cloudflared printed no URL, see $STATE/cloudflared.log" >&2; exit 1; }
  echo "new tunnel $(tunnel_url)"
  # The URL comes from Cloudflare's API (port 443); serving needs the edge on port 7844.
  for _ in $(seq 1 40); do
    connected && break
    sleep 0.5
  done
fi
URL=$(tunnel_url)
echo "$URL" >"$STATE/url"

# A PUBLIC_URL in the environment wins over the one in .env when Compose fills in compose.yaml.
PUBLIC_URL="$URL" "${COMPOSE[@]}" up -d --build
if connected; then
  echo "🫧 aerodance is live at $URL"
else
  echo "⚠️  $URL isn't reachable yet: this network blocks port 7844, which Cloudflare tunnels need." >&2
  echo "   cloudflared keeps retrying, so switch networks (a phone hotspot works) and the URL starts working." >&2
fi
