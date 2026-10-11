#!/usr/bin/env bash
set -euo pipefail

RELEASE_SHA="${1:?release SHA required}"
SHORT_SHA="${RELEASE_SHA:0:12}"
DEPLOY_ID="${SHORT_SHA}-$$"
RELEASE_DIR="/opt/openai-plugin-tools/releases/${RELEASE_SHA}"
STATE_DIR="/opt/openai-plugin-tools"
PDF_STATE_FILE="${STATE_DIR}/current-pdf-container"
ARABIC_STATE_FILE="${STATE_DIR}/current-arabic-container"
GROWTH_STATE_FILE="${STATE_DIR}/current-growth-container"
LEGACY_STATE_FILE="${STATE_DIR}/current-container"
ENV_FILE="${STATE_DIR}/openai.env"
CADDYFILE="/opt/websites/caddy/Caddyfile"
BACKUP="${CADDYFILE}.plugin-tools.${DEPLOY_ID}.bak"
PDF_IMAGE="openai-plugin-pdf:${RELEASE_SHA}"
ARABIC_IMAGE="openai-plugin-arabic:${RELEASE_SHA}"
GROWTH_IMAGE="openai-plugin-growth:${RELEASE_SHA}"
PDF_CONTAINER="openai-plugin-pdf-${DEPLOY_ID}"
ARABIC_CONTAINER="openai-plugin-arabic-${DEPLOY_ID}"
GROWTH_CONTAINER="openai-plugin-growth-${DEPLOY_ID}"
RENDERED_BLOCK="/tmp/openai-plugin-tools-${DEPLOY_ID}.caddy"
PREVIOUS_PDF_CONTAINER=""
PREVIOUS_ARABIC_CONTAINER=""
PREVIOUS_GROWTH_CONTAINER=""
CONFIG_MUTATED=0
SWITCHED=0
COMMITTED=0

mkdir -p "$STATE_DIR"
exec 9>"${STATE_DIR}/deploy.lock"
if ! flock -n 9; then
  echo "another plugin-tools deployment is already running" >&2
  exit 75
fi
if [ -s "$PDF_STATE_FILE" ]; then
  PREVIOUS_PDF_CONTAINER="$(tr -cd 'A-Za-z0-9_.-' < "$PDF_STATE_FILE")"
elif [ -s "$LEGACY_STATE_FILE" ]; then
  PREVIOUS_PDF_CONTAINER="$(tr -cd 'A-Za-z0-9_.-' < "$LEGACY_STATE_FILE")"
fi
if [ -s "$ARABIC_STATE_FILE" ]; then
  PREVIOUS_ARABIC_CONTAINER="$(tr -cd 'A-Za-z0-9_.-' < "$ARABIC_STATE_FILE")"
fi
if [ -s "$GROWTH_STATE_FILE" ]; then
  PREVIOUS_GROWTH_CONTAINER="$(tr -cd 'A-Za-z0-9_.-' < "$GROWTH_STATE_FILE")"
fi

write_state() {
  local path="$1"
  local value="$2"
  if [ -n "$value" ]; then
    printf '%s\n' "$value" > "${path}.tmp"
    mv "${path}.tmp" "$path"
  else
    rm -f "$path" "${path}.tmp"
  fi
}

rollback() {
  trap - EXIT INT TERM HUP
  local rollback_ok=1
  if [ "$CONFIG_MUTATED" -eq 1 ] && [ -f "$BACKUP" ]; then
    if ! cp "$BACKUP" "${CADDYFILE}.rollback-${DEPLOY_ID}" || ! mv "${CADDYFILE}.rollback-${DEPLOY_ID}" "$CADDYFILE"; then
      rollback_ok=0
    elif ! docker exec websites-caddy-1 caddy validate --config /etc/caddy/Caddyfile; then
      rollback_ok=0
    elif [ "$SWITCHED" -eq 1 ] && ! docker exec websites-caddy-1 caddy reload --config /etc/caddy/Caddyfile; then
      rollback_ok=0
    fi
  fi
  if [ "$rollback_ok" -eq 1 ]; then
    write_state "$PDF_STATE_FILE" "$PREVIOUS_PDF_CONTAINER"
    write_state "$ARABIC_STATE_FILE" "$PREVIOUS_ARABIC_CONTAINER"
    write_state "$GROWTH_STATE_FILE" "$PREVIOUS_GROWTH_CONTAINER"
    docker rm -f "$PDF_CONTAINER" "$ARABIC_CONTAINER" "$GROWTH_CONTAINER" >/dev/null 2>&1 || true
  else
    write_state "$PDF_STATE_FILE" "$PDF_CONTAINER"
    write_state "$ARABIC_STATE_FILE" "$ARABIC_CONTAINER"
    write_state "$GROWTH_STATE_FILE" "$GROWTH_CONTAINER"
    echo "rollback failed; candidate containers were kept running for recovery" >&2
  fi
  rm -f "${PDF_STATE_FILE}.tmp" "${ARABIC_STATE_FILE}.tmp" "${GROWTH_STATE_FILE}.tmp" "${CADDYFILE}.rollback-${DEPLOY_ID}"
  return $((1 - rollback_ok))
}

cleanup() {
  local status=$?
  if [ "$COMMITTED" -ne 1 ]; then
    rollback || status=1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

cd "$RELEASE_DIR"
docker build --pull -t "$PDF_IMAGE" pdf-table-to-excel
docker build --pull -t "$ARABIC_IMAGE" gcc-arabic-writer
docker build --pull -t "$GROWTH_IMAGE" growth-marketing-planner

ENV_FILE_ARGS=()
if [ -s "$ENV_FILE" ]; then
  ENV_FILE_ARGS=(--env-file "$ENV_FILE")
fi
EXPECTED_OPENAI_CHALLENGE="$(python3 - "$ENV_FILE" <<'PY'
import sys
from pathlib import Path
path = Path(sys.argv[1])
value = ""
if path.is_file():
    for line in path.read_text().splitlines():
        if line.startswith("OPENAI_APPS_CHALLENGE="):
            value = line.split("=", 1)[1]
            break
if not value or value == "configure-before-production":
    raise SystemExit("OPENAI_APPS_CHALLENGE must be configured before deployment")
print(value)
PY
)"

run_container() {
  local name="$1"
  local image="$2"
  local port="$3"
  local log_driver="$4"
  shift 4
  local log_args=(--log-driver local --log-opt max-size=1m --log-opt max-file=2)
  if [ "$log_driver" = "none" ]; then
    log_args=(--log-driver none)
  fi
  docker run -d \
    --name "$name" \
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
    "${log_args[@]}" \
    "${ENV_FILE_ARGS[@]}" \
    -e ALLOWED_HOSTS=www.astudio.agency,astudio.agency,127.0.0.1,localhost \
    -e PORT="$port" \
    "$@" \
    "$image"
}

run_container "$PDF_CONTAINER" "$PDF_IMAGE" 8788 local \
  -e PYTHONDONTWRITEBYTECODE=1 \
  -e PUBLIC_BASE_URL=https://www.astudio.agency/openai-plugins/pdf-table-to-excel
run_container "$ARABIC_CONTAINER" "$ARABIC_IMAGE" 8789 local
run_container "$GROWTH_CONTAINER" "$GROWTH_IMAGE" 8790 none

wait_healthy() {
  local container="$1"
  for attempt in 1 2 3 4 5 6; do
    if docker inspect "$container" --format '{{.State.Health.Status}}' | grep -Fx healthy >/dev/null; then
      return 0
    fi
    if [ "$attempt" -eq 6 ]; then
      docker logs "$container"
      return 1
    fi
    sleep 5
  done
}
wait_healthy "$PDF_CONTAINER"
wait_healthy "$ARABIC_CONTAINER"
wait_healthy "$GROWTH_CONTAINER"

python3 - "$PDF_CONTAINER" "$ARABIC_CONTAINER" "$GROWTH_CONTAINER" deploy/tools.astudio.agency.caddy "$RENDERED_BLOCK" <<'PY'
import sys
from pathlib import Path
pdf, arabic, growth, source, target = sys.argv[1:]
text = Path(source).read_text()
text = text.replace("__PDF_PLUGIN_UPSTREAM__", pdf).replace("__ARABIC_PLUGIN_UPSTREAM__", arabic).replace("__GROWTH_PLUGIN_UPSTREAM__", growth)
if "__PDF_PLUGIN_UPSTREAM__" in text or "__ARABIC_PLUGIN_UPSTREAM__" in text or "__GROWTH_PLUGIN_UPSTREAM__" in text:
    raise SystemExit("unresolved upstream placeholder")
Path(target).write_text(text)
PY

cp "$CADDYFILE" "$BACKUP"
python3 deploy/update-caddy.py "$CADDYFILE" "$RENDERED_BLOCK"
CONFIG_MUTATED=1
if ! docker exec websites-caddy-1 caddy validate --config /etc/caddy/Caddyfile; then
  exit 1
fi
SWITCHED=1
docker exec websites-caddy-1 caddy reload --config /etc/caddy/Caddyfile

check_health() {
  local url="$1"
  local service="$2"
  curl --fail --silent --show-error --retry 5 --retry-delay 2 "$url" \
    | python3 -c "import json,sys; data=json.load(sys.stdin); assert data['status'] == 'ok' and data['service'] == '$service'"
}
check_mcp() {
  local url="$1"
  local service="$2"
  local expected_tools="$3"
  curl --fail --silent --show-error \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"deploy-check","version":"1"}}}' \
    "$url" \
    | python3 -c "import json,sys; data=json.load(sys.stdin); assert data['result']['serverInfo']['name'] == '$service'"
  curl --fail --silent --show-error \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    --data '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
    "$url" \
    | python3 -c "import json,sys; data=json.load(sys.stdin); tools=data['result']['tools']; actual={tool['name'] for tool in tools}; expected=set('$expected_tools'.split(',')); assert actual == expected, (actual, expected); assert all(isinstance(tool.get('inputSchema'), dict) and tool['inputSchema'].get('type') == 'object' for tool in tools); assert all(isinstance(tool.get('outputSchema'), dict) and tool['outputSchema'].get('type') == 'object' for tool in tools)"
}

check_health https://www.astudio.agency/tools/health pdf-table-to-excel
check_health https://www.astudio.agency/openai-plugins/pdf-table-to-excel/ready pdf-table-to-excel
check_mcp https://www.astudio.agency/openai-plugins/pdf-table-to-excel/mcp pdf-table-to-excel convert_pdf_tables_to_excel
check_health https://www.astudio.agency/openai-plugins/gcc-arabic-writer/health gcc-arabic-writer
check_health https://www.astudio.agency/openai-plugins/gcc-arabic-writer/ready gcc-arabic-writer
check_mcp https://www.astudio.agency/openai-plugins/gcc-arabic-writer/mcp gcc-arabic-writer prepare_gcc_arabic_brief,check_arabic_factual_fidelity,lint_gcc_arabic_copy
check_health https://www.astudio.agency/openai-plugins/growth-marketing-planner/health growth-marketing-planner
check_health https://www.astudio.agency/openai-plugins/growth-marketing-planner/ready growth-marketing-planner
check_mcp https://www.astudio.agency/openai-plugins/growth-marketing-planner/mcp growth-marketing-planner open_growth_brief,review_growth_brief,compare_growth_strategies,finalize_growth_plan,export_growth_plan
ACTUAL_OPENAI_CHALLENGE="$(curl --fail --silent --show-error https://www.astudio.agency/.well-known/openai-apps-challenge)"
if [ "$ACTUAL_OPENAI_CHALLENGE" != "$EXPECTED_OPENAI_CHALLENGE" ]; then
  echo "OpenAI Apps challenge response mismatch" >&2
  exit 1
fi
curl --fail --silent --show-error \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"open_growth_brief","arguments":{}}}' \
  https://www.astudio.agency/openai-plugins/growth-marketing-planner/mcp \
  | python3 -c 'import json,sys; data=json.load(sys.stdin); result=data["result"]; assert not result.get("isError"); structured=result["structuredContent"]; assert structured["formVersion"] == "1.0.0" and structured["requiredFields"]'
curl --fail --silent --show-error \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"prepare_gcc_arabic_brief","arguments":{"task":"tagline","market":"pan-arab","mandatory_facts":[],"protected_literals":[],"constraints":[]}}}' \
  https://www.astudio.agency/openai-plugins/gcc-arabic-writer/mcp \
  | python3 -c 'import json,sys; data=json.load(sys.stdin); result=data["result"]; assert not result.get("isError"); assert result["structuredContent"]["language_policy"] == "Modern Standard Arabic"'

PDF_CHECK_JSON="/tmp/pdf-plugin-check-${DEPLOY_ID}.json"
PDF_CHECK_XLSX="/tmp/pdf-plugin-check-${DEPLOY_ID}.xlsx"
curl --fail --silent --show-error \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"convert_pdf_tables_to_excel","arguments":{"file":{"download_url":"https://www.astudio.agency/tools/review/sample-invoice.pdf","file_id":"deploy-review-sample","file_name":"sample-invoice.pdf","mime_type":"application/pdf"},"output_filename":"deploy-check.xlsx"}}}' \
  https://www.astudio.agency/openai-plugins/pdf-table-to-excel/mcp > "$PDF_CHECK_JSON"
PDF_CHECK_URL="$(python3 -c 'import json,sys; data=json.load(open(sys.argv[1])); result=data["result"]; assert not result.get("isError"); structured=result["structuredContent"]; assert structured["tables"] >= 1 and structured["pages"] >= 1; print(structured["download_url"])' "$PDF_CHECK_JSON")"
curl --fail --silent --show-error "$PDF_CHECK_URL" -o "$PDF_CHECK_XLSX"
python3 -c 'import sys,zipfile; assert zipfile.is_zipfile(sys.argv[1]); archive=zipfile.ZipFile(sys.argv[1]); names=set(archive.namelist()); assert "[Content_Types].xml" in names and "xl/workbook.xml" in names' "$PDF_CHECK_XLSX"
rm -f "$PDF_CHECK_JSON" "$PDF_CHECK_XLSX"

printf '%s\n' "$PDF_CONTAINER" > "${PDF_STATE_FILE}.tmp"
printf '%s\n' "$ARABIC_CONTAINER" > "${ARABIC_STATE_FILE}.tmp"
printf '%s\n' "$GROWTH_CONTAINER" > "${GROWTH_STATE_FILE}.tmp"
mv "${PDF_STATE_FILE}.tmp" "$PDF_STATE_FILE"
mv "${ARABIC_STATE_FILE}.tmp" "$ARABIC_STATE_FILE"
mv "${GROWTH_STATE_FILE}.tmp" "$GROWTH_STATE_FILE"
COMMITTED=1
rm -f "$LEGACY_STATE_FILE"
for previous in "$PREVIOUS_PDF_CONTAINER" "$PREVIOUS_ARABIC_CONTAINER" "$PREVIOUS_GROWTH_CONTAINER"; do
  if [ -n "$previous" ] && [ "$previous" != "$PDF_CONTAINER" ] && [ "$previous" != "$ARABIC_CONTAINER" ] && [ "$previous" != "$GROWTH_CONTAINER" ]; then
    docker rm -f "$previous" >/dev/null 2>&1 || true
  fi
done
rm -f "$BACKUP" "$RENDERED_BLOCK"

echo "deployed ${RELEASE_SHA} as ${PDF_CONTAINER}, ${ARABIC_CONTAINER} and ${GROWTH_CONTAINER}"
