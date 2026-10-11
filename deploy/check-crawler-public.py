#!/usr/bin/env python3
"""Verify the public crawler-auditor MCP flow after candidate routing."""
from __future__ import annotations
import json
import sys
import urllib.request

endpoint = sys.argv[1]

def rpc(identifier: int, method: str, params: dict | None = None) -> dict:
    payload = {"jsonrpc": "2.0", "id": identifier, "method": method}
    if params is not None:
        payload["params"] = params
    request = urllib.request.Request(endpoint, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)

initialized = rpc(1, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "deploy-check", "version": "1"}})
assert initialized["result"]["serverInfo"]["name"] == "ai-crawler-readiness-auditor"
tools = rpc(2, "tools/list")["result"]["tools"]
assert {tool["name"] for tool in tools} == {"validate_audit_target", "run_readiness_audit"}
resources = rpc(3, "resources/list")["result"]["resources"]
assert len(resources) == 2
for index, resource in enumerate(resources, start=10):
    content = rpc(index, "resources/read", {"uri": resource["uri"]})["result"]["contents"][0]
    assert content["mimeType"] == "text/html;profile=mcp-app"
    assert "globalThis.ExtApps" in content["text"]
arguments = {"url": "https://fixtures.astudio.agency/ready/page", "scope": "page_and_site_controls", "checks": ["target_fetch", "robots_access", "page_metadata", "structured_data", "sitemap", "llms_txt", "challenge_signals"]}
validated = rpc(20, "tools/call", {"name": "validate_audit_target", "arguments": arguments})["result"]["structuredContent"]
assert validated["valid"] is True
assert validated["target"]["redirects"]
run_arguments = {**arguments, "url": validated["target"]["normalizedUrl"], "checkpointToken": validated["checkpoint"]["token"]}
audited = rpc(21, "tools/call", {"name": "run_readiness_audit", "arguments": run_arguments})["result"]["structuredContent"]
assert audited["status"] == "no_issues_detected_within_scope"
assert audited["requestUsage"]["requestsMade"] <= 8
print("public crawler auditor MCP flow passed")
