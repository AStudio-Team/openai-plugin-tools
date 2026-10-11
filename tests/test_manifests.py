import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ManifestAndPackageTests(unittest.TestCase):
    def setUp(self):
        self.gcc = json.loads((ROOT / "gcc-arabic-writer" / "plugin.json").read_text())
        self.pdf = json.loads((ROOT / "pdf-table-to-excel" / "plugin.json").read_text())
        self.ad = json.loads((ROOT / "ad-creative-lab" / "plugin.json").read_text())
        self.growth = json.loads((ROOT / "growth-marketing-planner" / "plugin.json").read_text())
        self.crawler = json.loads((ROOT / "ai-crawler-readiness-auditor" / "plugin.json").read_text())
        self.data = json.loads((ROOT / "open-data-fetcher" / "plugin.json").read_text())
        self.diagram = json.loads((ROOT / "editable-diagram-builder" / "plugin.json").read_text())

    def test_astudio_is_publisher_for_all_products(self):
        self.assertEqual(self.gcc["name"], "astudio-gcc-arabic-writer")
        for manifest in (self.gcc, self.pdf, self.ad, self.growth, self.crawler, self.data, self.diagram):
            self.assertEqual(manifest["author"]["name"], "ASTUDIO")
            self.assertEqual(manifest["extensions"]["com.openai"]["interface"]["developerName"], "ASTUDIO")

    def test_discovery_metadata_has_distinct_natural_intents(self):
        gcc_text = json.dumps(self.gcc, ensure_ascii=False).lower()
        pdf_text = json.dumps(self.pdf, ensure_ascii=False).lower()
        for phrase in ("arabic copywriting", "modern standard arabic", "arabic taglines", "كتابة محتوى عربي", "توطين المحتوى للخليج"):
            self.assertIn(phrase, gcc_text)
        for phrase in ("pdf table to excel", "invoice pdf to excel", "statement pdf to excel", "catalogue to excel", "multi-page pdfs"):
            self.assertIn(phrase, pdf_text)
        self.assertNotIn("pdf to xlsx", gcc_text)
        self.assertNotIn("arabic copywriting", pdf_text)
        self.assertLessEqual(len(self.gcc["keywords"]), 15)
        self.assertLessEqual(len(self.pdf["keywords"]), 15)
        diagram_text = json.dumps(self.diagram, ensure_ascii=False).lower()
        for phrase in ("editable diagram", "flowchart", "sequence diagram", "concept map", ".excalidraw"):
            self.assertIn(phrase, diagram_text)
        self.assertNotIn("excalidraw diagram builder", self.diagram["extensions"]["com.openai"]["interface"]["displayName"].lower())

    def test_review_selection_cases_and_public_demo(self):
        gcc_review = self.gcc["extensions"]["com.openai"]["review"]
        self.assertEqual(len(gcc_review["test_cases"]["positive"]), 5)
        self.assertEqual(len(gcc_review["test_cases"]["negative"]), 3)
        self.assertEqual(gcc_review["demo_recording_url"], "https://www.astudio.agency/tools/review/gcc-arabic-writer-demo.mp4")
        demo_path = ROOT / "pdf-table-to-excel" / "public" / "review" / "gcc-arabic-writer-demo.mp4"
        self.assertTrue(demo_path.is_file())
        self.assertGreater(demo_path.stat().st_size, 100_000)
        demo = json.loads((ROOT / "gcc-arabic-writer" / "review" / "deterministic-demo.json").read_text())
        self.assertEqual(demo["public_demo_url"], gcc_review["demo_recording_url"])
        pdf_negatives = " ".join(case["prompt"] for case in self.pdf["extensions"]["com.openai"]["review"]["test_cases"]["negative"])
        self.assertIn("scanned PDF", pdf_negatives)
        self.assertIn("JPG", pdf_negatives)
        self.assertIn("Arabic caption", pdf_negatives)
        diagram_review = self.diagram["extensions"]["com.openai"]["review"]
        self.assertEqual(len(diagram_review["test_cases"]["positive"]), 5)
        self.assertEqual(len(diagram_review["test_cases"]["negative"]), 3)
        self.assertEqual(diagram_review["demo_recording_status"], "required-before-portal-submission")

    def test_diagram_package_is_pinned_and_closed_world(self):
        package = json.loads((ROOT / "editable-diagram-builder" / "package.json").read_text())
        self.assertEqual(package["engines"]["node"], ">=22")
        self.assertEqual(set(package["dependencies"]), {"@modelcontextprotocol/ext-apps", "@modelcontextprotocol/sdk", "ajv", "zod"})
        source = "\n".join(path.read_text() for path in (ROOT / "editable-diagram-builder" / "src").glob("*.ts"))
        for forbidden in ("fetch(", "axios", "openai", "anthropic", "excalidraw.com"):
            self.assertNotIn(forbidden, source.lower())
        self.assertIn("outbound_network:false", source)

    def test_gcc_package_is_pinned_and_closed_world(self):
        package = json.loads((ROOT / "gcc-arabic-writer" / "package.json").read_text())
        self.assertEqual(package["engines"]["node"], ">=22")
        self.assertEqual(package["dependencies"], {
            "@modelcontextprotocol/ext-apps": "2.0.3",
            "@modelcontextprotocol/sdk": "1.32.1",
            "zod": "4.6.5",
        })
        source = (ROOT / "gcc-arabic-writer" / "src" / "server.mjs").read_text()
        for forbidden in ("node:http\"", "node:https", "fetch(", "axios", "openai", "anthropic"):
            if forbidden == "node:http\"":
                continue
            self.assertNotIn(forbidden, source.lower())
        self.assertIn('import http from "node:http"', source)
        self.assertIn("outbound_network: false", source)

    def test_privacy_copy_matches_implemented_retention(self):
        privacy = (ROOT / "pdf-table-to-excel" / "public" / "privacy.html").read_text()
        self.assertIn("periodic expiration process", privacy)
        self.assertIn("no more than 15 minutes", privacy)
        self.assertIn("no fixed time-based deletion period is promised", privacy)
        self.assertNotIn("skills-only plugin", privacy)
        self.assertNotIn("no longer than 30 days", privacy)
        server = (ROOT / "pdf-table-to-excel" / "src" / "server.mjs").read_text()
        self.assertIn("setInterval(pruneDownloads", server)

    def test_arabic_mcp_public_prefix_is_exact(self):
        mcp = json.loads((ROOT / "gcc-arabic-writer" / "mcp.json").read_text())
        self.assertEqual(
            mcp["mcpServers"]["gcc-arabic-writer"]["url"],
            "https://www.astudio.agency/openai-plugins/gcc-arabic-writer/mcp",
        )

    def test_growth_planner_review_flow_and_attribution_are_complete(self):
        review = self.growth["extensions"]["com.openai"]["review"]
        self.assertEqual(len(review["test_cases"]["positive"]), 5)
        self.assertEqual(len(review["test_cases"]["negative"]), 3)
        self.assertEqual(review["demo_recording_status"], "required-before-portal-submission")
        text = json.dumps(self.growth, ensure_ascii=False).lower()
        for phrase in ("exactly three", "mandatory human confirmation", "markdown and json export", "does not connect"):
            self.assertIn(phrase, text)
        notice = (ROOT / "growth-marketing-planner" / "NOTICE").read_text()
        license_text = (ROOT / "growth-marketing-planner" / "LICENSES" / "corey-haines-marketingskills-MIT.txt").read_text()
        self.assertIn("Corey Haines", notice)
        self.assertIn("Copyright (c) 2025 Corey Haines", license_text)
        self.assertIn("Permission is hereby granted", license_text)

    def test_growth_mcp_public_prefix_is_exact(self):
        mcp = json.loads((ROOT / "growth-marketing-planner" / "mcp.json").read_text())
        self.assertEqual(mcp["mcpServers"]["growth-marketing-planner"]["url"], "https://www.astudio.agency/openai-plugins/growth-marketing-planner/mcp")
    def test_next_version_and_interaction_docs_are_consistent(self):
        for product in ("gcc-arabic-writer", "pdf-table-to-excel"):
            package = json.loads((ROOT / product / "package.json").read_text())
            manifest = json.loads((ROOT / product / "plugin.json").read_text())
            lock = json.loads((ROOT / product / "package-lock.json").read_text())
            self.assertEqual(package["version"], "1.1.0")
            self.assertEqual(manifest["version"], "1.1.0")
            self.assertEqual(lock["version"], "1.1.0")
            self.assertEqual(lock["packages"][""]["version"], "1.1.0")
            self.assertEqual(package["dependencies"]["@modelcontextprotocol/ext-apps"], "2.0.3")
        spec = (ROOT / "docs" / "interaction-flows-v1.1.0.md").read_text()
        for heading in ("Entry intent", "Intake", "Human checkpoint", "Execution", "Result", "Human choice", "Follow-up", "Fallback", "Cancellation", "Privacy"):
            self.assertIn(heading, spec)
        for category in ("Direct", "Indirect", "Incomplete", "Follow-up", "Revision", "Cancellation", "Negative", "Boundary"):
            self.assertIn(f"| {category} |", spec)
        self.assertIn("does not claim that version 1.1.0 is uploaded, submitted, approved or published", spec)

    def test_npm_packages_are_private_and_restrict_contents(self):
        expected_prefixes = {
            "gcc-arabic-writer": ("src/", "widgets/"),
            "pdf-table-to-excel": ("src/", "widgets/", "public/"),
        }
        for product, prefixes in expected_prefixes.items():
            package_dir = ROOT / product
            package = json.loads((package_dir / "package.json").read_text())
            self.assertIs(package["private"], True)
            result = subprocess.run(
                ["npm", "pack", "--dry-run", "--json", "--ignore-scripts"],
                cwd=package_dir,
                check=True,
                capture_output=True,
                text=True,
            )
            files = {item["path"] for item in json.loads(result.stdout)[0]["files"]}
            self.assertIn("package.json", files)
            self.assertTrue(any(path.startswith("widgets/") for path in files))
            self.assertTrue(any(path.startswith("src/") for path in files))
            self.assertFalse(any(path.startswith(("node_modules/", ".venv/", "tests/", "skills/")) for path in files))
            allowed = prefixes + ("package.json", "README.md", "requirements.lock")
            self.assertFalse([path for path in files if not path.startswith(allowed)], files)

    def test_public_pages_truthfully_describe_interactive_flows(self):
        public = ROOT / "pdf-table-to-excel" / "public"
        gcc_page = (public / "gcc-arabic-writer.html").read_text()
        pdf_page = (public / "pdf-table-to-excel.html").read_text()
        privacy = (public / "privacy.html").read_text()
        self.assertIn("Review a focused brief before writing", gcc_page)
        self.assertIn("worksheet previews and expiry", pdf_page)
        self.assertIn("host mediates opening the download link", privacy)
        self.assertIn("silently update model context", privacy)


    def test_ad_creative_lab_public_contract(self):
        review = self.ad["extensions"]["com.openai"]["review"]
        self.assertEqual(len(review["test_cases"]["positive"]), 5)
        self.assertEqual(len(review["test_cases"]["negative"]), 3)
        self.assertEqual(review["demo_recording_status"], "required-before-portal-submission")
        mcp = json.loads((ROOT / "ad-creative-lab" / "mcp.json").read_text())
        self.assertEqual(mcp["mcpServers"]["ad-creative-lab"]["url"], "https://www.astudio.agency/openai-plugins/ad-creative-lab/mcp")
        notice = (ROOT / "ad-creative-lab" / "THIRD_PARTY_NOTICES.md").read_text()
        self.assertIn("Copyright (c) 2025 Corey Haines", notice)
        self.assertIn("Permission is hereby granted", notice)
    def test_crawler_auditor_review_contract_is_complete(self):
        interface = self.crawler["extensions"]["com.openai"]["interface"]
        review = self.crawler["extensions"]["com.openai"]["review"]
        self.assertEqual(interface["displayName"], "AI Crawler Readiness Auditor")
        self.assertEqual(interface["shortDescription"], "Check public crawl signals")
        self.assertEqual(len(review["test_cases"]["positive"]), 5)
        self.assertEqual(len(review["test_cases"]["negative"]), 3)
        self.assertEqual(review["demo_recording_status"], "required-before-portal-submission")
        for case in review["test_cases"]["positive"]:
            self.assertIn("https://fixtures.astudio.agency/", case["prompt"])
            self.assertIn("validate_audit_target", case["tools_triggered"])
            self.assertIn("run_readiness_audit", case["tools_triggered"])
        manifest_text = json.dumps(self.crawler).lower()
        self.assertNotIn("readiness score", manifest_text)
        self.assertNotIn("<publisher-domain>", manifest_text)
    def test_open_data_package_has_human_gates_and_fail_closed_rights(self):
        self.assertEqual(self.data["name"], "astudio-open-data-fetcher")
        review = self.data["extensions"]["com.openai"]["review"]["test_cases"]
        self.assertEqual(len(review["positive"]), 5)
        self.assertEqual(len(review["negative"]), 3)
        source = (ROOT / "open-data-fetcher" / "src" / "server.mjs").read_text()
        self.assertIn("human_search_submitted: z.literal(true)", source)
        self.assertIn("human_selection_confirmed: z.literal(true)", source)
        self.assertIn("license_acknowledged: z.literal(true)", source)
        self.assertIn("export_confirmed: z.literal(true)", source)
        self.assertIn('rights.verdict !== "green"', source)
        mcp = json.loads((ROOT / "open-data-fetcher" / "mcp.json").read_text())
        self.assertEqual(mcp["mcpServers"]["open-data-fetcher"]["url"], "https://www.astudio.agency/openai-plugins/open-data-fetcher/mcp")


if __name__ == "__main__":
    unittest.main()
