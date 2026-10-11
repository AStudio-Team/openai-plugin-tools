import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UPDATER = ROOT / "deploy" / "update-caddy.py"
BLOCK = ROOT / "deploy" / "tools.astudio.agency.caddy"


class DeployConfigTests(unittest.TestCase):
    def test_inserts_and_replaces_managed_block_inside_main_site(self):
        original = """{
    email test@example.com
}

astudio.agency, www.astudio.agency {
    import security_headers
    reverse_proxy nginx-ae-interim:80 {
        flush_interval -1
    }
}
"""
        with tempfile.TemporaryDirectory() as temporary:
            caddyfile = Path(temporary) / "Caddyfile"
            caddyfile.write_text(original)
            subprocess.run(["python3", str(UPDATER), str(caddyfile), str(BLOCK)], check=True)
            first = caddyfile.read_text()
            self.assertEqual(first.count("# BEGIN OPENAI_PLUGIN_TOOLS"), 1)
            self.assertLess(first.index("# BEGIN OPENAI_PLUGIN_TOOLS"), first.index("reverse_proxy nginx-ae-interim"))
            subprocess.run(["python3", str(UPDATER), str(caddyfile), str(BLOCK)], check=True)
            second = caddyfile.read_text()
            self.assertEqual(second.count("# BEGIN OPENAI_PLUGIN_TOOLS"), 1)
            self.assertEqual(first, second)
    def test_deployment_keeps_previous_container_until_external_checks_pass(self):
        script = (ROOT / "deploy" / "deploy-production.sh").read_text()
        self.assertIn("trap rollback ERR", script)
        self.assertIn("--memory 512m", script)
        self.assertIn("--pids-limit 64", script)
        self.assertIn("--log-opt max-file=2", script)
        self.assertIn("--read-only", script)
        self.assertLess(script.index("https://www.astudio.agency/tools/health"), script.index('docker rm -f "$PREVIOUS_CONTAINER"'))
        block = BLOCK.read_text()
        self.assertIn("__OPENAI_PLUGIN_UPSTREAM__", block)
        self.assertIn("max_size 1MB", block)


if __name__ == "__main__":
    unittest.main()
