import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ManifestAndPackageTests(unittest.TestCase):
    def setUp(self):
        self.gcc = json.loads((ROOT / "gcc-arabic-writer" / "plugin.json").read_text())
        self.pdf = json.loads((ROOT / "pdf-table-to-excel" / "plugin.json").read_text())

    def test_astudio_is_publisher_for_both_products(self):
        for manifest in (self.gcc, self.pdf):
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

    def test_gcc_package_is_pinned_and_closed_world(self):
        package = json.loads((ROOT / "gcc-arabic-writer" / "package.json").read_text())
        self.assertEqual(package["engines"]["node"], ">=22")
        self.assertEqual(package["dependencies"], {"@modelcontextprotocol/sdk": "1.32.1", "zod": "4.6.5"})
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


if __name__ == "__main__":
    unittest.main()
