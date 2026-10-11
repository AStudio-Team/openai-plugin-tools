#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$ROOT/.venv"
if [[ ! -x "$VENV/bin/python" ]]; then
  if command -v python3.11 >/dev/null 2>&1; then
    python3.11 -m venv "$VENV"
  elif python3 -c 'import sys; raise SystemExit(sys.version_info < (3, 10))' 2>/dev/null; then
    python3 -m venv "$VENV"
  elif command -v uv >/dev/null 2>&1; then
    uv venv --python 3.11 "$VENV"
  else
    printf '%s\n' "Python 3.10 or newer is required. Install Python 3.11, then run this launcher again." >&2
    exit 1
  fi
fi
"$VENV/bin/python" -m pip install --require-hashes -r "$ROOT/requirements.lock"
export PYTHON="$VENV/bin/python"
exec node "$ROOT/src/server.mjs"
