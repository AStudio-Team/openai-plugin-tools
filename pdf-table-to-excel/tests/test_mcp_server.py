import json
import os
import subprocess
import time
import unittest
from pathlib import Path
from urllib import request
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
PORT = 8791
URL = f"http://127.0.0.1:{PORT}/mcp"


def post(payload):
    body = json.dumps(payload).encode()
    req = request.Request(URL, data=body, headers={"content-type": "application/json", "accept": "application/json, text/event-stream"}, method="POST")
    try:
        with request.urlopen(req, timeout=5) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except HTTPError as exc:
        raw = exc.read()
        return exc.code, json.loads(raw) if raw else None


class McpProtocolTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        env = {**os.environ, "PORT": str(PORT), "RATE_LIMIT_PER_CLIENT": "100"}
        cls.process = subprocess.Popen(
            ["node", str(ROOT / "src" / "server.mjs")],
            cwd=ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        deadline = time.time() + 5
        while time.time() < deadline:
            try:
                status, _ = post({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
                if status == 200:
                    return
            except Exception:
                time.sleep(0.05)
        raise RuntimeError("MCP test server did not start")

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=5)
        cls.process.stdout.close()
        cls.process.stderr.close()

    def test_initialize_and_tools_list(self):
        status, response = post({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "qa", "version": "1"}}})
        self.assertEqual(status, 200)
        self.assertEqual(response["result"]["serverInfo"]["name"], "pdf-table-to-excel")
        _, response = post({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        tool = response["result"]["tools"][0]
        self.assertEqual(tool["name"], "convert_pdf_tables_to_excel")
        self.assertEqual(tool["inputSchema"]["required"], ["file"])
        file_schema = tool["inputSchema"]["properties"]["file"]
        self.assertEqual(set(file_schema["properties"]), {"download_url", "file_id", "mime_type", "file_name"})
        self.assertEqual(set(file_schema["required"]), {"download_url", "file_id"})
        self.assertEqual(tool["_meta"]["openai/fileParams"], ["file"])

    def test_rejects_missing_jsonrpc(self):
        status, response = post({"id": 3, "method": "tools/list"})
        self.assertEqual(status, 400)
        self.assertEqual(response["error"]["code"], -32700)

    def test_rejects_invalid_id_types(self):
        for bad_id in (True, 1.5, [1], {"value": 1}):
            status, response = post({"jsonrpc": "2.0", "id": bad_id, "method": "tools/list"})
            self.assertEqual(status, 400)
            self.assertIsNone(response["id"])
            self.assertEqual(response["error"]["code"], -32700)

    def test_malformed_idless_request_returns_invalid_request(self):
        status, response = post({"jsonrpc": "1.0", "method": "tools/list"})
        self.assertEqual(status, 400)
        self.assertIsNone(response["id"])
        self.assertEqual(response["error"]["code"], -32700)

    def test_notification_has_no_response(self):
        status, response = post({"jsonrpc": "2.0", "method": "notifications/initialized"})
        self.assertEqual(status, 202)
        self.assertIsNone(response)

    def test_batch_request(self):
        status, response = post([
            {"jsonrpc": "2.0", "id": 4, "method": "tools/list"},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 5, "method": "missing"},
        ])
        self.assertEqual(status, 200)
        self.assertEqual(len(response), 2)
        self.assertEqual(response[1]["error"]["code"], -32601)

    def test_empty_batch_has_no_response(self):
        status, response = post([])
        self.assertEqual(status, 202)
        self.assertIsNone(response)


if __name__ == "__main__":
    unittest.main()
