#!/usr/bin/env bash
set -euo pipefail

RELEASE_SHA="${1:?release SHA required}"
SHORT_SHA="${RELEASE_SHA:0:12}"
RELEASE_DIR="/opt/openai-plugin-tools/releases/${RELEASE_SHA}"
STATE_DIR="/opt/openai-plugin-tools"
STATE_FILE="${STATE_DIR}/current-container"
ENV_FILE="${STATE_DIR}/openai.env"
CADDYFILE="/opt/websites/caddy/Caddyfile"
BACKUP="${CADDYFILE}.plugin-tools.${RELEASE_SHA}.bak"
IMAGE="openai-plugin-tools:${RELEASE_SHA}"
CONTAINER="openai-plugin-tools-${SHORT_SHA}"
RENDERED_BLOCK="/tmp/openai-plugin-tools-${SHORT_SHA}.caddy"
PREVIOUS_CONTAINER=""
SWITCHED=0

mkdir -p "$STATE_DIR"
if [ -s "$STATE_FILE" ]; then
  PREVIOUS_CONTAINER="$(tr -cd 'A-Za-z0-9_.-' < "$STATE_FILE")"
fi

rollback() {
  if [ "$SWITCHED" -eq 1 ] && [ -f "$BACKUP" ]; then
    cp "$BACKUP" "$CADDYFILE"
    docker exec websites-caddy-1 caddy reload --config /etc/caddy/Caddyfile || true
  fi
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap rollback ERR

cd "$RELEASE_DIR"
docker build --pull -t "$IMAGE" pdf-table-to-excel

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
ENV_FILE_ARGS=()
if [ -s "$ENV_FILE" ]; then
  ENV_FILE_ARGS=(--env-file "$ENV_FILE")
fi
docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  --network websites_web \
  --memory 512m \
  --memory-swap 512m \
  --cpus 1.0 \
  --pids-limit 64 \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --log-driver local \
  --log-opt max-size=1m \
  --log-opt max-file=2 \
  "${ENV_FILE_ARGS[@]}" \
  -e PYTHONDONTWRITEBYTECODE=1 \
  -e PUBLIC_BASE_URL=https://www.astudio.agency/openai-plugins/pdf-table-to-excel \
  -e ALLOWED_HOSTS=www.astudio.agency,astudio.agency,127.0.0.1,localhost \
  "$IMAGE"

for attempt in 1 2 3 4 5 6; do
  if docker inspect "$CONTAINER" --format '{{.State.Health.Status}}' | grep -Fx healthy >/dev/null; then
    break
  fi
  if [ "$attempt" -eq 6 ]; then
    docker logs "$CONTAINER"
    exit 1
  fi
  sleep 5
done

python3 - "$CONTAINER" deploy/tools.astudio.agency.caddy "$RENDERED_BLOCK" <<'PY'
import sys
from pathlib import Path
container, source, target = sys.argv[1:]
text = Path(source).read_text().replace("__OPENAI_PLUGIN_UPSTREAM__", container)
if "__OPENAI_PLUGIN_UPSTREAM__" in text:
    raise SystemExit("unresolved upstream placeholder")
Path(target).write_text(text)
PY

cp "$CADDYFILE" "$BACKUP"
python3 deploy/update-caddy.py "$CADDYFILE" "$RENDERED_BLOCK"
if ! docker exec websites-caddy-1 caddy validate --config /etc/caddy/Caddyfile; then
  cp "$BACKUP" "$CADDYFILE"
  exit 1
fi
SWITCHED=1
docker exec websites-caddy-1 caddy reload --config /etc/caddy/Caddyfile

curl --fail --silent --show-error --retry 5 --retry-delay 2 \
  https://www.astudio.agency/tools/health \
  | python3 -c 'import json,sys; data=json.load(sys.stdin); assert data["status"] == "ok" and data["service"] == "pdf-table-to-excel"'

curl --fail --silent --show-error \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"deploy-check","version":"1"}}}' \
  https://www.astudio.agency/openai-plugins/pdf-table-to-excel/mcp \
  | python3 -c 'import json,sys; data=json.load(sys.stdin); assert data["result"]["serverInfo"]["name"] == "pdf-table-to-excel"'

printf '%s\n' "$CONTAINER" > "${STATE_FILE}.tmp"
mv "${STATE_FILE}.tmp" "$STATE_FILE"
if [ -n "$PREVIOUS_CONTAINER" ] && [ "$PREVIOUS_CONTAINER" != "$CONTAINER" ]; then
  docker rm -f "$PREVIOUS_CONTAINER" >/dev/null 2>&1 || true
fi
SWITCHED=0
trap - ERR

echo "deployed ${RELEASE_SHA} as ${CONTAINER}"
