#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if [[ ! -f .env ]]; then
  echo 'Missing .env. Run: cp .env.example .env, then configure it and try again.' >&2
  exit 1
fi

engine=${CONTAINER_ENGINE:-}
if [[ -z "$engine" ]]; then
  if command -v podman >/dev/null 2>&1; then
    engine=podman
  elif command -v docker >/dev/null 2>&1; then
    engine=docker
  else
    echo 'Install Podman or Docker with Compose before deploying.' >&2
    exit 1
  fi
fi

if ! "$engine" compose version >/dev/null 2>&1; then
  echo "Compose is unavailable for $engine. Install its Compose provider and try again." >&2
  exit 1
fi

compose=("$engine" compose -f compose.yaml -f compose.local.yaml)
echo "Rebuilding and deploying the main app locally with $engine…"
"${compose[@]}" up --build -d

echo 'Waiting for the app and database to become ready…'
for ((attempt = 1; attempt <= 60; attempt++)); do
  if "${compose[@]}" exec -T app node --input-type=module -e '
    try {
      const response = await fetch("http://127.0.0.1:3000/api/health", {
        signal: AbortSignal.timeout(2000),
      });
      process.exit(response.ok && (await response.json()).ok === true ? 0 : 1);
    } catch {
      process.exit(1);
    }
  ' >/dev/null 2>&1; then
    echo 'Deployment healthy. Open the local address shown below (default: http://localhost:3000).'
    "${compose[@]}" ps
    exit 0
  fi
  sleep 2
done

echo 'Deployment did not become healthy. Recent app and database logs:' >&2
"${compose[@]}" logs --tail=40 app db >&2 || true
exit 1
