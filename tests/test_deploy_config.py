import subprocess
import tempfile
import unittest
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UPDATER = ROOT / "deploy" / "update-caddy.py"
BLOCK = ROOT / "deploy" / "tools.astudio.agency.caddy"


class DeployConfigTests(unittest.TestCase):
    def test_caddyfile_has_no_inline_blocks(self):
        inline_blocks = [
            line
            for line in BLOCK.read_text().splitlines()
            if re.match(r"^\s*\w+\s+\{.*\}\s*$", line)
        ]
        self.assertEqual(inline_blocks, [], "Caddy blocks must place braces on separate lines")

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

    def test_deployment_is_transactional_for_all_services(self):
        script = (ROOT / "deploy" / "deploy-production.sh").read_text()
        self.assertIn("trap cleanup EXIT", script)
        self.assertIn("flock -n 9", script)
        self.assertIn("rollback failed; candidate containers were kept running", script)
        self.assertIn("CONFIG_MUTATED=1", script)
        self.assertIn("COMMITTED=1", script)
        self.assertIn('docker build --pull -t "$PDF_IMAGE" pdf-table-to-excel', script)
        self.assertIn('docker build --pull -t "$ARABIC_IMAGE" gcc-arabic-writer', script)
        self.assertIn('docker build --pull -t "$AD_IMAGE" ad-creative-lab', script)
        self.assertIn('docker build --pull -t "$GROWTH_IMAGE" growth-marketing-planner', script)
        self.assertIn('docker build --pull -t "$CRAWLER_IMAGE" ai-crawler-readiness-auditor', script)
        self.assertIn('docker build --pull -t "$DATA_IMAGE" open-data-fetcher', script)
        self.assertIn('docker build --pull -t "$DIAGRAM_IMAGE" editable-diagram-builder', script)
        self.assertIn('docker build --pull -t "$GROUNDED_IMAGE" grounded-citations', script)
        self.assertIn('docker build --pull -t "$LAUNCH_PLAN_IMAGE" launch-plan-builder', script)
        self.assertIn("LAUNCH_PLAN_STATE_FILE", script)
        self.assertIn('docker build --pull -t "$SCHEMA_MARKUP_IMAGE" schema-markup-generator', script)
        self.assertIn('run_container "$SCHEMA_MARKUP_CONTAINER" "$SCHEMA_MARKUP_IMAGE" 8790 local', script)
        self.assertIn('wait_healthy "$SCHEMA_MARKUP_CONTAINER"', script)
        self.assertIn('"__SCHEMA_MARKUP_UPSTREAM__", schema_markup', script)
        self.assertIn('check_health https://www.astudio.agency/openai-plugins/schema-markup-generator/health schema-markup-generator', script)
        self.assertIn("--memory 512m", script)
        self.assertIn("--pids-limit 64", script)
        self.assertIn("--log-opt max-file=2", script)
        self.assertIn("--read-only", script)
        self.assertIn('LEGACY_STATE_FILE="${STATE_DIR}/current-container"', script)
        self.assertIn('elif [ -s "$LEGACY_STATE_FILE" ]', script)
        self.assertIn('rm -f "$LEGACY_STATE_FILE"', script)
        self.assertIn('docker rm -f "$PDF_CONTAINER" "$ARABIC_CONTAINER" "$AD_CONTAINER" "$GROWTH_CONTAINER" "$CRAWLER_CONTAINER" "$DATA_CONTAINER" "$DIAGRAM_CONTAINER" "$BUY_LINK_CONTAINER" "$GROUNDED_CONTAINER"', script)
        self.assertIn("CRAWLER_STATE_FILE", script)
        self.assertIn("update-fixture-caddy.py", script)
        self.assertIn('docker build --pull -t "$BUY_LINK_IMAGE" verified-buy-link', script)
        self.assertIn('SOURCE_RIGHTS_FILE=/run/config/source-rights.json', script)
        last_external_check = script.index("check_mcp https://www.astudio.agency/openai-plugins/grounded-citations/mcp")
        self.assertLess(last_external_check, script.index('docker rm -f "$previous"'))
        self.assertLess(script.index("SWITCHED=1"), last_external_check)
        self.assertIn("tool.get('outputSchema')", script)
        self.assertIn('"method": "resources/list"', script)
        self.assertIn('"method": "resources/read"', script)
        self.assertIn('content["mimeType"] == "text/html;profile=mcp-app"', script)
        self.assertIn('content["_meta"]["ui"]["csp"] == closed_csp', script)
        self.assertIn('content["text"].strip()', script)
        self.assertIn('"globalThis.ExtApps=" in content["text"]', script)
        self.assertIn("ui://pdf-table-to-excel/result-preview.html", script)
        self.assertIn("ui://gcc-arabic-writer/brief-builder.html,ui://gcc-arabic-writer/copy-review.html", script)
        self.assertIn("convert_pdf_tables_to_excel", script)
        self.assertIn("zipfile.is_zipfile", script)
        committed = script.rindex("COMMITTED=1")
        self.assertLess(committed, script.index('rm -f "$LEGACY_STATE_FILE"'))
        self.assertLess(committed, script.index('docker rm -f "$previous"'))

    def test_health_checked_package_servers_identify_their_service(self):
        script = (ROOT / "deploy" / "deploy-production.sh").read_text()
        services = set()
        for line in script.splitlines():
            parts = line.split()
            if len(parts) == 3 and parts[0] == "check_health" and (ROOT / parts[2]).is_dir():
                services.add(parts[2])
        self.assertTrue(services)
        for service in services:
            package_dirs = [path.parent for path in (ROOT / service).rglob("package.json") if "node_modules" not in path.parts]
            self.assertTrue(package_dirs, f"{service} needs a package folder")
            for package_dir in package_dirs:
                servers = list((package_dir / "src").glob("server.*"))
                self.assertEqual(len(servers), 1, f"{package_dir} needs one src/server file")
                source = servers[0].read_text()
                self.assertTrue(
                    f'service:"{service}"' in source or f'service: "{service}"' in source,
                    f"{service} health response must identify its service",
                )

    def test_caddy_routes_three_isolated_upstreams_and_public_checks(self):
        block = BLOCK.read_text()
        self.assertIn("__PDF_PLUGIN_UPSTREAM__:8788", block)
        self.assertIn("__ARABIC_PLUGIN_UPSTREAM__:8789", block)
        self.assertIn("__AD_CREATIVE_LAB_UPSTREAM__:8790", block)
        self.assertIn("__CRAWLER_PLUGIN_UPSTREAM__:8790", block)
        self.assertIn("/openai-plugins/pdf-table-to-excel/mcp", block)
        self.assertIn("/openai-plugins/gcc-arabic-writer/mcp", block)
        self.assertIn("/openai-plugins/ad-creative-lab/mcp", block)
        self.assertIn("max_size 512KB", block)
        self.assertIn("__GROWTH_PLUGIN_UPSTREAM__:8790", block)
        self.assertIn("/openai-plugins/growth-marketing-planner/mcp", block)
        self.assertIn("__DATA_PLUGIN_UPSTREAM__:8791", block)
        self.assertIn("/openai-plugins/open-data-fetcher/mcp", block)
        self.assertIn("__DIAGRAM_PLUGIN_UPSTREAM__:8790", block)
        self.assertIn("/openai-plugins/editable-diagram-builder/mcp", block)
        self.assertIn("__VERIFIED_BUY_LINK_UPSTREAM__:8790", block)
        self.assertIn("/openai-plugins/verified-buy-link/mcp", block)
        self.assertIn("__GROUNDED_PLUGIN_UPSTREAM__:8790", block)
        self.assertIn("__LAUNCH_PLAN_UPSTREAM__:8790", block)
        self.assertIn("/openai-plugins/launch-plan-builder/mcp", block)
        self.assertIn("handle_path /tools/launch-plan-builder*", block)
        self.assertIn("__SCHEMA_MARKUP_UPSTREAM__:8790", block)
        self.assertIn("/openai-plugins/schema-markup-generator/mcp", block)
        self.assertIn("/openai-plugins/grounded-citations/mcp", block)
        self.assertIn("max_size 1MB", block)
        self.assertIn("max_size 128KB", block)
        self.assertIn("max_size 256KB", block)
        self.assertIn("handle_path /openai-plugins/gcc-arabic-writer/*", block)
        self.assertIn("/openai-plugins/ai-crawler-readiness-auditor/mcp", block)
        fixtures = (ROOT / "deploy" / "fixtures.astudio.agency.caddy").read_text()
        self.assertIn("fixtures.astudio.agency", fixtures)
        self.assertIn("sitemap-timeout.fixtures.astudio.agency", fixtures)
        self.assertIn("handle_path /openai-plugins/verified-buy-link/*", block)
        self.assertIn("handle_path /tools/verified-buy-link*", block)
        self.assertLess(block.index("handle_path /tools/verified-buy-link*"), block.index("handle_path /tools/*"))

    def test_deploy_shell_is_syntactically_valid(self):
        subprocess.run(["bash", "-n", str(ROOT / "deploy" / "deploy-production.sh")], check=True)


if __name__ == "__main__":
    unittest.main()
