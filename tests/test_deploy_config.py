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

    def test_deployment_is_transactional_for_both_services(self):
        script = (ROOT / "deploy" / "deploy-production.sh").read_text()
        self.assertIn("trap cleanup EXIT", script)
        self.assertIn("flock -n 9", script)
        self.assertIn("rollback failed; candidate containers were kept running", script)
        self.assertIn("CONFIG_MUTATED=1", script)
        self.assertIn("COMMITTED=1", script)
        self.assertIn('docker build --pull -t "$PDF_IMAGE" pdf-table-to-excel', script)
        self.assertIn('docker build --pull -t "$ARABIC_IMAGE" gcc-arabic-writer', script)
        self.assertIn("--memory 512m", script)
        self.assertIn("--pids-limit 64", script)
        self.assertIn("--log-opt max-file=2", script)
        self.assertIn("--read-only", script)
        self.assertIn('LEGACY_STATE_FILE="${STATE_DIR}/current-container"', script)
        self.assertIn('elif [ -s "$LEGACY_STATE_FILE" ]', script)
        self.assertIn('rm -f "$LEGACY_STATE_FILE"', script)
        self.assertIn('docker rm -f "$PDF_CONTAINER" "$ARABIC_CONTAINER" "$BUY_LINK_CONTAINER"', script)
        self.assertIn('docker build --pull -t "$BUY_LINK_IMAGE" verified-buy-link', script)
        self.assertIn('SOURCE_RIGHTS_FILE=/run/config/source-rights.json', script)
        last_external_check = script.index("check_mcp https://www.astudio.agency/openai-plugins/verified-buy-link/mcp")
        self.assertLess(last_external_check, script.index('docker rm -f "$previous"'))
        self.assertLess(script.index("SWITCHED=1"), last_external_check)
        self.assertIn("tool.get('outputSchema')", script)
        self.assertIn("convert_pdf_tables_to_excel", script)
        self.assertIn("zipfile.is_zipfile", script)
        committed = script.rindex("COMMITTED=1")
        self.assertLess(committed, script.index('rm -f "$LEGACY_STATE_FILE"'))
        self.assertLess(committed, script.index('docker rm -f "$previous"'))

    def test_caddy_routes_three_isolated_upstreams_and_public_checks(self):
        block = BLOCK.read_text()
        self.assertIn("__PDF_PLUGIN_UPSTREAM__:8788", block)
        self.assertIn("__ARABIC_PLUGIN_UPSTREAM__:8789", block)
        self.assertIn("__VERIFIED_BUY_LINK_UPSTREAM__:8790", block)
        self.assertIn("/openai-plugins/pdf-table-to-excel/mcp", block)
        self.assertIn("/openai-plugins/gcc-arabic-writer/mcp", block)
        self.assertIn("/openai-plugins/verified-buy-link/mcp", block)
        self.assertIn("max_size 1MB", block)
        self.assertIn("max_size 128KB", block)
        self.assertIn("max_size 256KB", block)
        self.assertIn("handle_path /openai-plugins/gcc-arabic-writer/*", block)
        self.assertIn("handle_path /openai-plugins/verified-buy-link/*", block)
        self.assertIn("handle_path /tools/verified-buy-link*", block)
        self.assertLess(block.index("handle_path /tools/verified-buy-link*"), block.index("handle_path /tools/*"))

    def test_deploy_shell_is_syntactically_valid(self):
        subprocess.run(["bash", "-n", str(ROOT / "deploy" / "deploy-production.sh")], check=True)


if __name__ == "__main__":
    unittest.main()
