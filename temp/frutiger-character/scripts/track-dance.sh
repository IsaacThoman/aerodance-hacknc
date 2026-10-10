#!/usr/bin/env bash
set -euo pipefail
# Resolve scripts relative to this file, while preserving the caller's input path.
prototype_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
exec uv run --locked --project "$prototype_dir/scripts/pose" python "$prototype_dir/scripts/pose/track.py" \
  --output "$prototype_dir/client/public/motion/dance.json" \
  --diagnostics "$prototype_dir/tracking-output" "$@"
