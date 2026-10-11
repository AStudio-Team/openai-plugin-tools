import base64
import io
import os
import subprocess
import sys
import unittest
from pathlib import Path

from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle

ROOT = Path(__file__).resolve().parents[1]


def make_pdf_base64():
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf)
    table = Table([["Name", "Value"], ["Alpha", "10"]])
    table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 1, colors.black)]))
    doc.build([table])
    return base64.b64encode(buf.getvalue()).decode()


def direct_conversion(extra_env):
    script = """
import { convertPdf } from './src/server.mjs';
const pdf = Buffer.from(process.env.TEST_PDF_BASE64, 'base64');
try {
  await convertPdf(pdf);
  console.log('unexpected-success');
  process.exitCode = 2;
} catch (error) {
  console.log(error.message);
}
"""
    completed = subprocess.run(
        ["node", "--input-type=module", "--eval", script],
        cwd=ROOT,
        env={
            **os.environ,
            "PYTHON": sys.executable,
            "TEST_PDF_BASE64": make_pdf_base64(),
            **extra_env,
        },
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    if completed.returncode != 0:
        raise AssertionError(completed.stderr or completed.stdout)
    return completed.stdout.strip().lower()


class McpResourceLimitTests(unittest.TestCase):
    def test_concurrency_limit_returns_busy(self):
        message = direct_conversion({"MAX_CONCURRENT_CONVERSIONS": "-1"})
        self.assertIn("busy", message)

    def test_subprocess_timeout_is_enforced(self):
        message = direct_conversion({"CONVERSION_TIMEOUT_MS": "1"})
        self.assertIn("limit", message)


if __name__ == "__main__":
    unittest.main()
