#!/usr/bin/env bash
set -euo pipefail

RELEASE_SHA="${1:?release SHA required}"
SHORT_SHA="${RELEASE_SHA:0:12}"
DEPLOY_ID="${SHORT_SHA}-$$"
RELEASE_DIR="/opt/openai-plugin-tools/releases/${RELEASE_SHA}"
STATE_DIR="/opt/openai-plugin-tools"
PDF_STATE_FILE="${STATE_DIR}/current-pdf-container"
ARABIC_STATE_FILE="${STATE_DIR}/current-arabic-container"
AD_STATE_FILE="${STATE_DIR}/current-ad-creative-lab-container"
GROWTH_STATE_FILE="${STATE_DIR}/current-growth-container"
CRAWLER_STATE_FILE="${STATE_DIR}/current-crawler-container"
DATA_STATE_FILE="${STATE_DIR}/current-data-container"
DIAGRAM_STATE_FILE="${STATE_DIR}/current-diagram-container"
BUY_LINK_STATE_FILE="${STATE_DIR}/current-verified-buy-link-container"
GROUNDED_STATE_FILE="${STATE_DIR}/current-grounded-container"
LAUNCH_PLAN_STATE_FILE="${STATE_DIR}/current-launch-plan-container"
LANDING_COPY_STATE_FILE="${STATE_DIR}/current-landing-copy-container"
SCHEMA_MARKUP_STATE_FILE="${STATE_DIR}/current-schema-markup-container"
LEGACY_STATE_FILE="${STATE_DIR}/current-container"
ENV_FILE="${STATE_DIR}/openai.env"
CADDYFILE="/opt/websites/caddy/Caddyfile"
BACKUP="${CADDYFILE}.plugin-tools.${DEPLOY_ID}.bak"
PDF_IMAGE="openai-plugin-pdf:${RELEASE_SHA}"
ARABIC_IMAGE="openai-plugin-arabic:${RELEASE_SHA}"
AD_IMAGE="openai-plugin-ad-creative-lab:${RELEASE_SHA}"
PDF_CONTAINER="openai-plugin-pdf-${DEPLOY_ID}"
ARABIC_CONTAINER="openai-plugin-arabic-${DEPLOY_ID}"
AD_CONTAINER="openai-plugin-ad-creative-lab-${DEPLOY_ID}"
CRAWLER_IMAGE="openai-plugin-crawler-auditor:${RELEASE_SHA}"
CRAWLER_CONTAINER="openai-plugin-crawler-auditor-${DEPLOY_ID}"
DATA_IMAGE="openai-plugin-data:${RELEASE_SHA}"
DATA_CONTAINER="openai-plugin-data-${DEPLOY_ID}"
DIAGRAM_IMAGE="openai-plugin-diagram:${RELEASE_SHA}"
DIAGRAM_CONTAINER="openai-plugin-diagram-${DEPLOY_ID}"
BUY_LINK_IMAGE="openai-plugin-verified-buy-link:${RELEASE_SHA}"
BUY_LINK_CONTAINER="openai-plugin-verified-buy-link-${DEPLOY_ID}"
GROUNDED_IMAGE="openai-plugin-grounded:${RELEASE_SHA}"
GROUNDED_CONTAINER="openai-plugin-grounded-${DEPLOY_ID}"
LAUNCH_PLAN_IMAGE="openai-plugin-launch-plan:${RELEASE_SHA}"
LAUNCH_PLAN_CONTAINER="openai-plugin-launch-plan-${DEPLOY_ID}"
LANDING_COPY_IMAGE="openai-plugin-landing-copy:${RELEASE_SHA}"
LANDING_COPY_CONTAINER="openai-plugin-landing-copy-${DEPLOY_ID}"
SCHEMA_MARKUP_IMAGE="openai-plugin-schema-markup:${RELEASE_SHA}"
SCHEMA_MARKUP_CONTAINER="openai-plugin-schema-markup-${DEPLOY_ID}"
RENDERED_BLOCK="/tmp/openai-plugin-tools-${DEPLOY_ID}.caddy"
RENDERED_FIXTURES="/tmp/ai-crawler-fixtures-${DEPLOY_ID}.caddy"
PREVIOUS_PDF_CONTAINER=""
PREVIOUS_ARABIC_CONTAINER=""
PREVIOUS_AD_CONTAINER=""
GROWTH_IMAGE="openai-plugin-growth:${RELEASE_SHA}"
GROWTH_CONTAINER="openai-plugin-growth-${DEPLOY_ID}"
PREVIOUS_GROWTH_CONTAINER=""
PREVIOUS_CRAWLER_CONTAINER=""
PREVIOUS_DATA_CONTAINER=""
PREVIOUS_DIAGRAM_CONTAINER=""
PREVIOUS_BUY_LINK_CONTAINER=""
PREVIOUS_GROUNDED_CONTAINER=""
PREVIOUS_LAUNCH_PLAN_CONTAINER=""
PREVIOUS_LANDING_COPY_CONTAINER=""
PREVIOUS_SCHEMA_MARKUP_CONTAINER=""
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
if [ -s "$AD_STATE_FILE" ]; then
  PREVIOUS_AD_CONTAINER="$(tr -cd 'A-Za-z0-9_.-' < "$AD_STATE_FILE")"
fi
if [ -s "$GROWTH_STATE_FILE" ]; then
  PREVIOUS_GROWTH_CONTAINER="$(tr -cd 'A-Za-z0-9_.-' < "$GROWTH_STATE_FILE")"
fi
if [ -s "$CRAWLER_STATE_FILE" ]; then
  PREVIOUS_CRAWLER_CONTAINER="$(tr -cd 'A-Za-z0-9_.-' < "$CRAWLER_STATE_FILE")"
fi
if [ -s "$DATA_STATE_FILE" ]; then
  PREVIOUS_DATA_CONTAINER="$(tr -cd 'A-Za-z0-9_.-' < "$DATA_STATE_FILE")"
fi
if [ -s "$DIAGRAM_STATE_FILE" ]; then
  PREVIOUS_DIAGRAM_CONTAINER="$(tr -cd 'A-Za-z0-9_.-' < "$DIAGRAM_STATE_FILE")"
fi
if [ -s "$BUY_LINK_STATE_FILE" ]; then
  PREVIOUS_BUY_LINK_CONTAINER="$(tr -cd 'A-Za-z0-9_.-' < "$BUY_LINK_STATE_FILE")"
fi
if [ -s "$GROUNDED_STATE_FILE" ]; then
  PREVIOUS_GROUNDED_CONTAINER="$(tr -cd 'A-Za-z0-9_.-' < "$GROUNDED_STATE_FILE")"
fi
if [ -s "$LAUNCH_PLAN_STATE_FILE" ]; then
  PREVIOUS_LAUNCH_PLAN_CONTAINER="$(tr -cd 'A-Za-z0-9_.-' < "$LAUNCH_PLAN_STATE_FILE")"
fi
if [ -s "$LANDING_COPY_STATE_FILE" ]; then
  PREVIOUS_LANDING_COPY_CONTAINER="$(tr -cd 'A-Za-z0-9_.-' < "$LANDING_COPY_STATE_FILE")"
fi
if [ -s "$SCHEMA_MARKUP_STATE_FILE" ]; then
  PREVIOUS_SCHEMA_MARKUP_CONTAINER="$(tr -cd 'A-Za-z0-9_.-' < "$SCHEMA_MARKUP_STATE_FILE")"
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
    # Write into the existing file: the Caddy container bind-mounts this path and follows the inode, so a rename would leave it reading the old content.
    if ! cp "$BACKUP" "$CADDYFILE"; then
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
    write_state "$AD_STATE_FILE" "$PREVIOUS_AD_CONTAINER"
    write_state "$GROWTH_STATE_FILE" "$PREVIOUS_GROWTH_CONTAINER"
    write_state "$CRAWLER_STATE_FILE" "$PREVIOUS_CRAWLER_CONTAINER"
    write_state "$DATA_STATE_FILE" "$PREVIOUS_DATA_CONTAINER"
    write_state "$DIAGRAM_STATE_FILE" "$PREVIOUS_DIAGRAM_CONTAINER"
    write_state "$BUY_LINK_STATE_FILE" "$PREVIOUS_BUY_LINK_CONTAINER"
    write_state "$GROUNDED_STATE_FILE" "$PREVIOUS_GROUNDED_CONTAINER"
    write_state "$LAUNCH_PLAN_STATE_FILE" "$PREVIOUS_LAUNCH_PLAN_CONTAINER"; write_state "$LANDING_COPY_STATE_FILE" "$PREVIOUS_LANDING_COPY_CONTAINER"; write_state "$SCHEMA_MARKUP_STATE_FILE" "$PREVIOUS_SCHEMA_MARKUP_CONTAINER"
    docker rm -f "$PDF_CONTAINER" "$ARABIC_CONTAINER" "$AD_CONTAINER" "$GROWTH_CONTAINER" "$CRAWLER_CONTAINER" "$DATA_CONTAINER" "$DIAGRAM_CONTAINER" "$BUY_LINK_CONTAINER" "$GROUNDED_CONTAINER" "$LAUNCH_PLAN_CONTAINER" "$LANDING_COPY_CONTAINER" "$SCHEMA_MARKUP_CONTAINER" >/dev/null 2>&1 || true
  else
    write_state "$PDF_STATE_FILE" "$PDF_CONTAINER"
    write_state "$ARABIC_STATE_FILE" "$ARABIC_CONTAINER"
    write_state "$AD_STATE_FILE" "$AD_CONTAINER"
    write_state "$GROWTH_STATE_FILE" "$GROWTH_CONTAINER"
    write_state "$CRAWLER_STATE_FILE" "$CRAWLER_CONTAINER"
    write_state "$DATA_STATE_FILE" "$DATA_CONTAINER"
    write_state "$DIAGRAM_STATE_FILE" "$DIAGRAM_CONTAINER"
    write_state "$BUY_LINK_STATE_FILE" "$BUY_LINK_CONTAINER"
    write_state "$GROUNDED_STATE_FILE" "$GROUNDED_CONTAINER"
    write_state "$LAUNCH_PLAN_STATE_FILE" "$LAUNCH_PLAN_CONTAINER"
    write_state "$LANDING_COPY_STATE_FILE" "$LANDING_COPY_CONTAINER"
    write_state "$SCHEMA_MARKUP_STATE_FILE" "$SCHEMA_MARKUP_CONTAINER"
    echo "rollback failed; candidate containers were kept running for recovery" >&2
  fi
  rm -f "${PDF_STATE_FILE}.tmp" "${ARABIC_STATE_FILE}.tmp" "${AD_STATE_FILE}.tmp" "${GROWTH_STATE_FILE}.tmp" "${CRAWLER_STATE_FILE}.tmp" "${DATA_STATE_FILE}.tmp" "${DIAGRAM_STATE_FILE}.tmp" "${BUY_LINK_STATE_FILE}.tmp" "${GROUNDED_STATE_FILE}.tmp" "${LAUNCH_PLAN_STATE_FILE}.tmp" "${LANDING_COPY_STATE_FILE}.tmp" "${SCHEMA_MARKUP_STATE_FILE}.tmp" "${CADDYFILE}.rollback-${DEPLOY_ID}"
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
docker build --pull -t "$AD_IMAGE" ad-creative-lab
docker build --pull -t "$GROWTH_IMAGE" growth-marketing-planner
docker build --pull -t "$CRAWLER_IMAGE" ai-crawler-readiness-auditor
docker build --pull -t "$DATA_IMAGE" open-data-fetcher
docker build --pull -t "$DIAGRAM_IMAGE" editable-diagram-builder
docker build --pull -t "$BUY_LINK_IMAGE" verified-buy-link
docker build --pull -t "$GROUNDED_IMAGE" grounded-citations
docker build --pull -t "$LAUNCH_PLAN_IMAGE" launch-plan-builder
docker build --pull -t "$LANDING_COPY_IMAGE" landing-page-copy-check
docker build --pull -t "$SCHEMA_MARKUP_IMAGE" schema-markup-generator

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
if ! grep -Eq '^CHECKPOINT_SECRET=.{32,}$' "$ENV_FILE" 2>/dev/null; then
  echo "CHECKPOINT_SECRET with at least 32 bytes is required in ${ENV_FILE}" >&2
  exit 78
fi
if ! grep -Eq '^APPROVAL_HMAC_KEY=.{32,}$' "$ENV_FILE" 2>/dev/null; then
  echo "APPROVAL_HMAC_KEY with at least 32 bytes is required in ${ENV_FILE} (Ad Creative Lab approval receipts)" >&2
  exit 78
fi
BUY_LINK_ARGS=()
if [ -s "${STATE_DIR}/verified-buy-link-source-rights.json" ]; then
  BUY_LINK_ARGS=(-v "${STATE_DIR}/verified-buy-link-source-rights.json:/run/config/source-rights.json:ro" -e SOURCE_RIGHTS_FILE=/run/config/source-rights.json)
fi

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
run_container "$AD_CONTAINER" "$AD_IMAGE" 8790 local
run_container "$GROWTH_CONTAINER" "$GROWTH_IMAGE" 8790 none
run_container "$CRAWLER_CONTAINER" "$CRAWLER_IMAGE" 8790 local \
  -e MAX_CONCURRENT_AUDITS=4 \
  -e ALLOWED_HOSTS=www.astudio.agency,astudio.agency,127.0.0.1,localhost,fixtures.astudio.agency,ready.fixtures.astudio.agency,robots-blocked.fixtures.astudio.agency,llms-html.fixtures.astudio.agency,invalid-jsonld.fixtures.astudio.agency,sitemap-timeout.fixtures.astudio.agency
run_container "$DATA_CONTAINER" "$DATA_IMAGE" 8791 local \
  -e PUBLIC_BASE_URL=https://www.astudio.agency/openai-plugins/open-data-fetcher \
  -e APP_ORIGIN=https://www.astudio.agency
run_container "$DIAGRAM_CONTAINER" "$DIAGRAM_IMAGE" 8790 local \
  -e TRUST_PROXY_HEADER=true
run_container "$BUY_LINK_CONTAINER" "$BUY_LINK_IMAGE" 8790 local "${BUY_LINK_ARGS[@]}"
run_container "$GROUNDED_CONTAINER" "$GROUNDED_IMAGE" 8790 local \
  -e PERSISTENCE_BACKEND=memory
run_container "$LAUNCH_PLAN_CONTAINER" "$LAUNCH_PLAN_IMAGE" 8790 local
run_container "$LANDING_COPY_CONTAINER" "$LANDING_COPY_IMAGE" 8790 local
run_container "$SCHEMA_MARKUP_CONTAINER" "$SCHEMA_MARKUP_IMAGE" 8790 local

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
wait_healthy "$AD_CONTAINER"
wait_healthy "$GROWTH_CONTAINER"
wait_healthy "$CRAWLER_CONTAINER"
wait_healthy "$DATA_CONTAINER"
wait_healthy "$DIAGRAM_CONTAINER"
wait_healthy "$BUY_LINK_CONTAINER"
wait_healthy "$GROUNDED_CONTAINER"
wait_healthy "$LAUNCH_PLAN_CONTAINER"
wait_healthy "$LANDING_COPY_CONTAINER"
wait_healthy "$SCHEMA_MARKUP_CONTAINER"

python3 - "$PDF_CONTAINER" "$ARABIC_CONTAINER" "$AD_CONTAINER" "$GROWTH_CONTAINER" "$CRAWLER_CONTAINER" "$DATA_CONTAINER" "$DIAGRAM_CONTAINER" "$BUY_LINK_CONTAINER" "$GROUNDED_CONTAINER" "$LAUNCH_PLAN_CONTAINER" "$LANDING_COPY_CONTAINER" "$SCHEMA_MARKUP_CONTAINER" deploy/tools.astudio.agency.caddy "$RENDERED_BLOCK" <<'PY'
import sys
from pathlib import Path
pdf, arabic, ad, growth, crawler, data, diagram, buy_link, grounded, launch_plan, landing_copy, schema_markup, source, target = sys.argv[1:]
text = Path(source).read_text()
text = text.replace("__PDF_PLUGIN_UPSTREAM__", pdf).replace("__ARABIC_PLUGIN_UPSTREAM__", arabic).replace("__AD_CREATIVE_LAB_UPSTREAM__", ad).replace("__GROWTH_PLUGIN_UPSTREAM__", growth).replace("__CRAWLER_PLUGIN_UPSTREAM__", crawler).replace("__DATA_PLUGIN_UPSTREAM__", data).replace("__DIAGRAM_PLUGIN_UPSTREAM__", diagram).replace("__VERIFIED_BUY_LINK_UPSTREAM__", buy_link).replace("__GROUNDED_PLUGIN_UPSTREAM__", grounded).replace("__LAUNCH_PLAN_UPSTREAM__", launch_plan).replace("__LANDING_COPY_UPSTREAM__", landing_copy).replace("__SCHEMA_MARKUP_UPSTREAM__", schema_markup)
if "__" in text:
    raise SystemExit("unresolved upstream placeholder")
Path(target).write_text(text)
PY
python3 - "$CRAWLER_CONTAINER" deploy/fixtures.astudio.agency.caddy "$RENDERED_FIXTURES" <<'PY'
import sys
from pathlib import Path
crawler, source, target = sys.argv[1:]
text = Path(source).read_text().replace("__CRAWLER_PLUGIN_UPSTREAM__", crawler)
if "__CRAWLER_PLUGIN_UPSTREAM__" in text:
    raise SystemExit("unresolved fixture upstream placeholder")
Path(target).write_text(text)
PY

cp "$CADDYFILE" "$BACKUP"
python3 deploy/update-caddy.py "$CADDYFILE" "$RENDERED_BLOCK"
python3 deploy/update-fixture-caddy.py "$CADDYFILE" "$RENDERED_FIXTURES"
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

check_resources() {
  local url="$1"
  local expected_resources="$2"
  python3 - "$url" "$expected_resources" <<'PY'
import json
import sys
import urllib.request

url, expected_csv = sys.argv[1:]
headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", "User-Agent": "astudio-plugin-tools-deploy-check/1.0"}

def post(payload):
    request = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)

listed = post({"jsonrpc": "2.0", "id": 10, "method": "resources/list"})["result"]["resources"]
expected = set(expected_csv.split(","))
actual = {resource["uri"] for resource in listed}
assert actual == expected, (actual, expected)
closed_csp = {"connectDomains": [], "resourceDomains": [], "frameDomains": [], "baseUriDomains": []}
for index, resource in enumerate(listed, start=11):
    assert resource["mimeType"] == "text/html;profile=mcp-app"
    assert resource["_meta"]["ui"]["csp"] == closed_csp
    content = post({"jsonrpc": "2.0", "id": index, "method": "resources/read", "params": {"uri": resource["uri"]}})["result"]["contents"][0]
    assert content["uri"] == resource["uri"]
    assert content["mimeType"] == "text/html;profile=mcp-app"
    assert content["_meta"]["ui"]["csp"] == closed_csp
    assert content["text"].strip()
    assert "globalThis.ExtApps=" in content["text"]
    assert "/*__EXT_APPS_BUNDLE__*/" not in content["text"]
PY
}

check_health https://www.astudio.agency/tools/health pdf-table-to-excel
check_health https://www.astudio.agency/openai-plugins/pdf-table-to-excel/ready pdf-table-to-excel
check_mcp https://www.astudio.agency/openai-plugins/pdf-table-to-excel/mcp pdf-table-to-excel convert_pdf_tables_to_excel
check_resources https://www.astudio.agency/openai-plugins/pdf-table-to-excel/mcp ui://pdf-table-to-excel/result-preview.html
check_health https://www.astudio.agency/openai-plugins/gcc-arabic-writer/health gcc-arabic-writer
check_health https://www.astudio.agency/openai-plugins/gcc-arabic-writer/ready gcc-arabic-writer
check_mcp https://www.astudio.agency/openai-plugins/gcc-arabic-writer/mcp gcc-arabic-writer prepare_gcc_arabic_brief,check_arabic_factual_fidelity,lint_gcc_arabic_copy
check_resources https://www.astudio.agency/openai-plugins/gcc-arabic-writer/mcp ui://gcc-arabic-writer/brief-builder.html,ui://gcc-arabic-writer/copy-review.html
check_health https://www.astudio.agency/openai-plugins/ad-creative-lab/health ad-creative-lab
check_mcp https://www.astudio.agency/openai-plugins/ad-creative-lab/mcp ad-creative-lab prepare_campaign_brief,review_campaign_brief,approve_campaign_brief,present_concept_options,submit_concept_decision,validate_platform_copy,export_creative_package
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
check_health https://www.astudio.agency/openai-plugins/ai-crawler-readiness-auditor/health ai-crawler-readiness-auditor
check_health https://www.astudio.agency/openai-plugins/ai-crawler-readiness-auditor/ready ai-crawler-readiness-auditor
check_mcp https://www.astudio.agency/openai-plugins/ai-crawler-readiness-auditor/mcp ai-crawler-readiness-auditor validate_audit_target,run_readiness_audit
python3 deploy/check-crawler-public.py https://www.astudio.agency/openai-plugins/ai-crawler-readiness-auditor/mcp
check_health https://www.astudio.agency/openai-plugins/open-data-fetcher/health open-data-fetcher
check_health https://www.astudio.agency/openai-plugins/open-data-fetcher/ready open-data-fetcher
check_mcp https://www.astudio.agency/openai-plugins/open-data-fetcher/mcp open-data-fetcher search_open_data,discover_datasets,inspect_open_dataset,preview_open_dataset,prepare_open_data_export
check_health https://www.astudio.agency/openai-plugins/editable-diagram-builder/health editable-diagram-builder
check_health https://www.astudio.agency/openai-plugins/editable-diagram-builder/ready editable-diagram-builder
check_mcp https://www.astudio.agency/openai-plugins/editable-diagram-builder/mcp editable-diagram-builder open_diagram_brief,confirm_diagram_brief,render_diagram_preview,apply_diagram_edits,export_excalidraw
check_health https://www.astudio.agency/openai-plugins/verified-buy-link/health verified-buy-link
check_health https://www.astudio.agency/openai-plugins/verified-buy-link/ready verified-buy-link
check_mcp https://www.astudio.agency/openai-plugins/verified-buy-link/mcp verified-buy-link open_verified_buy_link,verify_buy_options,render_buy_comparison,inspect_buy_option,refresh_buy_options
check_health https://www.astudio.agency/openai-plugins/grounded-citations/health grounded-citations
check_health https://www.astudio.agency/openai-plugins/grounded-citations/ready grounded-citations
check_mcp https://www.astudio.agency/openai-plugins/grounded-citations/mcp grounded-citations prepare_scope,confirm_scope,verify_quote,preview_evidence,verify_draft,render_citations,end_session
check_health https://www.astudio.agency/openai-plugins/launch-plan-builder/health launch-plan-builder
check_health https://www.astudio.agency/openai-plugins/launch-plan-builder/ready launch-plan-builder
check_mcp https://www.astudio.agency/openai-plugins/launch-plan-builder/mcp launch-plan-builder open_launch_brief,review_launch_brief,approve_launch_brief,draft_launch_plan,request_plan_revision,export_launch_plan
check_health https://www.astudio.agency/openai-plugins/schema-markup-generator/health schema-markup-generator
check_health https://www.astudio.agency/openai-plugins/schema-markup-generator/ready schema-markup-generator
check_mcp https://www.astudio.agency/openai-plugins/schema-markup-generator/mcp schema-markup-generator open_schema_brief,review_schema_brief,approve_schema_brief,generate_schema_markup,check_schema_markup,export_schema_markup
check_health https://www.astudio.agency/openai-plugins/landing-page-copy-check/health landing-page-copy-check
check_health https://www.astudio.agency/openai-plugins/landing-page-copy-check/ready landing-page-copy-check
check_mcp https://www.astudio.agency/openai-plugins/landing-page-copy-check/mcp landing-page-copy-check open_page_brief,review_page_brief,approve_page_brief,draft_page_copy,check_page_conversion,select_page_copy_variant,export_page_copy
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
printf '%s\n' "$AD_CONTAINER" > "${AD_STATE_FILE}.tmp"
printf '%s\n' "$GROWTH_CONTAINER" > "${GROWTH_STATE_FILE}.tmp"
printf '%s\n' "$CRAWLER_CONTAINER" > "${CRAWLER_STATE_FILE}.tmp"
printf '%s\n' "$DATA_CONTAINER" > "${DATA_STATE_FILE}.tmp"
printf '%s\n' "$DIAGRAM_CONTAINER" > "${DIAGRAM_STATE_FILE}.tmp"
printf '%s\n' "$BUY_LINK_CONTAINER" > "${BUY_LINK_STATE_FILE}.tmp"
printf '%s\n' "$GROUNDED_CONTAINER" > "${GROUNDED_STATE_FILE}.tmp"
printf '%s\n' "$LAUNCH_PLAN_CONTAINER" > "${LAUNCH_PLAN_STATE_FILE}.tmp"
printf '%s\n' "$LANDING_COPY_CONTAINER" > "${LANDING_COPY_STATE_FILE}.tmp"
printf '%s\n' "$SCHEMA_MARKUP_CONTAINER" > "${SCHEMA_MARKUP_STATE_FILE}.tmp"
mv "${PDF_STATE_FILE}.tmp" "$PDF_STATE_FILE"
mv "${ARABIC_STATE_FILE}.tmp" "$ARABIC_STATE_FILE"
mv "${AD_STATE_FILE}.tmp" "$AD_STATE_FILE"
mv "${GROWTH_STATE_FILE}.tmp" "$GROWTH_STATE_FILE"
mv "${CRAWLER_STATE_FILE}.tmp" "$CRAWLER_STATE_FILE"
mv "${DATA_STATE_FILE}.tmp" "$DATA_STATE_FILE"
mv "${DIAGRAM_STATE_FILE}.tmp" "$DIAGRAM_STATE_FILE"
mv "${BUY_LINK_STATE_FILE}.tmp" "$BUY_LINK_STATE_FILE"
mv "${GROUNDED_STATE_FILE}.tmp" "$GROUNDED_STATE_FILE"
mv "${LAUNCH_PLAN_STATE_FILE}.tmp" "$LAUNCH_PLAN_STATE_FILE"
mv "${LANDING_COPY_STATE_FILE}.tmp" "$LANDING_COPY_STATE_FILE"
mv "${SCHEMA_MARKUP_STATE_FILE}.tmp" "$SCHEMA_MARKUP_STATE_FILE"
COMMITTED=1
rm -f "$LEGACY_STATE_FILE"
for previous in "$PREVIOUS_PDF_CONTAINER" "$PREVIOUS_ARABIC_CONTAINER" "$PREVIOUS_AD_CONTAINER" "$PREVIOUS_GROWTH_CONTAINER" "$PREVIOUS_CRAWLER_CONTAINER" "$PREVIOUS_DATA_CONTAINER" "$PREVIOUS_DIAGRAM_CONTAINER" "$PREVIOUS_BUY_LINK_CONTAINER" "$PREVIOUS_GROUNDED_CONTAINER" "$PREVIOUS_LAUNCH_PLAN_CONTAINER" "$PREVIOUS_LANDING_COPY_CONTAINER" "$PREVIOUS_SCHEMA_MARKUP_CONTAINER"; do
  if [ -n "$previous" ] && [ "$previous" != "$PDF_CONTAINER" ] && [ "$previous" != "$ARABIC_CONTAINER" ] && [ "$previous" != "$AD_CONTAINER" ] && [ "$previous" != "$GROWTH_CONTAINER" ] && [ "$previous" != "$CRAWLER_CONTAINER" ] && [ "$previous" != "$DATA_CONTAINER" ] && [ "$previous" != "$DIAGRAM_CONTAINER" ] && [ "$previous" != "$BUY_LINK_CONTAINER" ] && [ "$previous" != "$GROUNDED_CONTAINER" ] && [ "$previous" != "$LAUNCH_PLAN_CONTAINER" ] && [ "$previous" != "$LANDING_COPY_CONTAINER" ] && [ "$previous" != "$SCHEMA_MARKUP_CONTAINER" ]; then
    docker rm -f "$previous" >/dev/null 2>&1 || true
  fi
done
rm -f "$BACKUP" "$RENDERED_BLOCK" "$RENDERED_FIXTURES"

echo "deployed ${RELEASE_SHA} as ${PDF_CONTAINER}, ${ARABIC_CONTAINER}, ${AD_CONTAINER}, ${GROWTH_CONTAINER}, ${CRAWLER_CONTAINER}, ${DATA_CONTAINER}, ${DIAGRAM_CONTAINER}, ${BUY_LINK_CONTAINER}, ${GROUNDED_CONTAINER}, ${LAUNCH_PLAN_CONTAINER}, ${LANDING_COPY_CONTAINER} and ${SCHEMA_MARKUP_CONTAINER}"
