#!/usr/bin/env python3
"""Build production images and verify bundled MCP App resources in running containers."""

from __future__ import annotations

import json
import os
import subprocess
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
MIME = "text/html;profile=mcp-app"
CLOSED_CSP = {"connectDomains": [], "resourceDomains": [], "frameDomains": [], "baseUriDomains": []}
SERVICES = {
    "pdf-table-to-excel": {
        "port": 8788,
        "resources": {"ui://pdf-table-to-excel/result-preview.html"},
    },
    "gcc-arabic-writer": {
        "port": 8789,
        "resources": {
            "ui://gcc-arabic-writer/brief-builder.html",
            "ui://gcc-arabic-writer/copy-review.html",
        },
    },
}


def run(*args: str, **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(args, cwd=ROOT, check=True, text=True, capture_output=True, **kwargs)


def post(url: str, payload: dict) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


@unittest.skipUnless(os.environ.get("RUN_DOCKER_TESTS") == "1", "set RUN_DOCKER_TESTS=1 for production container integration tests")
class ProductionContainerResourceTests(unittest.TestCase):
    def test_images_start_and_serve_bundled_resources(self):
        suffix = uuid4().hex[:10]
        containers: list[str] = []
        try:
            for service, spec in SERVICES.items():
                image = f"chatgpt-plugin-products-{service}-test:{suffix}"
                container = f"chatgpt-plugin-products-{service}-test-{suffix}"
                run("docker", "build", "--pull", "-t", image, service)
                run("docker", "run", "-d", "--name", container, "-p", f"127.0.0.1::{spec['port']}", image)
                containers.append(container)
                host_port = run(
                    "docker",
                    "inspect",
                    "--format",
                    f'{{{{(index (index .NetworkSettings.Ports "{spec["port"]}/tcp") 0).HostPort}}}}',
                    container,
                ).stdout.strip()
                base = f"http://127.0.0.1:{host_port}"
                deadline = time.monotonic() + 45
                while True:
                    try:
                        with urllib.request.urlopen(f"{base}/ready", timeout=2) as response:
                            if response.status == 200:
                                break
                    except (urllib.error.URLError, ConnectionError):
                        pass
                    if time.monotonic() >= deadline:
                        logs = run("docker", "logs", container).stdout
                        self.fail(f"{service} did not become ready:\n{logs}")
                    time.sleep(1)
                mcp = f"{base}/mcp"
                listed = post(mcp, {"jsonrpc": "2.0", "id": 1, "method": "resources/list"})["result"]["resources"]
                self.assertEqual({resource["uri"] for resource in listed}, spec["resources"])
                for index, resource in enumerate(listed, start=2):
                    self.assertEqual(resource["mimeType"], MIME)
                    self.assertEqual(resource["_meta"]["ui"]["csp"], CLOSED_CSP)
                    content = post(mcp, {"jsonrpc": "2.0", "id": index, "method": "resources/read", "params": {"uri": resource["uri"]}})["result"]["contents"][0]
                    self.assertEqual(content["mimeType"], MIME)
                    self.assertEqual(content["_meta"]["ui"]["csp"], CLOSED_CSP)
                    self.assertTrue(content["text"].strip())
                    self.assertIn("globalThis.ExtApps=", content["text"])
                    self.assertNotIn("/*__EXT_APPS_BUNDLE__*/", content["text"])
        finally:
            for container in containers:
                subprocess.run(["docker", "rm", "-f", container], cwd=ROOT, check=False, capture_output=True, text=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
