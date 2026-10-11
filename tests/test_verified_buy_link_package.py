import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "verified-buy-link"


class VerifiedBuyLinkPackageTests(unittest.TestCase):
    def test_manifest_is_public_ready_but_keeps_external_submission_gate_truthful(self):
        manifest = json.loads((APP / "plugin.json").read_text())
        interface = manifest["extensions"]["com.openai"]["interface"]
        review = manifest["extensions"]["com.openai"]["review"]
        self.assertEqual(interface["displayName"], "Verified Buy Link")
        self.assertLessEqual(len(interface["displayName"]), 30)
        self.assertLessEqual(len(interface["shortDescription"]), 30)
        self.assertEqual(len(review["test_cases"]["positive"]), 5)
        self.assertEqual(len(review["test_cases"]["negative"]), 3)
        self.assertEqual(review["demo_recording_status"], "required-before-portal-submission")
        self.assertFalse(review["commerce"])

    def test_source_register_has_no_blanket_authorized_domain(self):
        register = json.loads((APP / "source-rights-register.json").read_text())
        self.assertEqual(register["sources"], [])
        for field in ("access_basis", "terms_url", "permitted_fields", "caching_and_retention", "attribution_requirement", "geographic_restrictions", "rate_limit", "owner"):
            self.assertIn(field, register["required_fields"])

    def test_no_prohibited_commerce_tool_or_browser_action_exists(self):
        server = (APP / "src" / "server.mjs").read_text().lower()
        registered = set(re.findall(r'(?:registerapptool\(server,|server\.registertool\()\s*"([a-z0-9_]+)"', server))
        for tool in ("purchase_product", "add_to_cart", "start_checkout", "submit_form", "login_retailer", "reserve_product"):
            self.assertNotIn(tool, registered)
        widget = (APP / "widgets" / "comparison.html").read_text()
        self.assertIn("app.openLink", widget)
        self.assertNotIn("window.open", widget)
        self.assertNotIn("target=\"_blank\"", widget)

    def test_widgets_bundle_scripts_and_csp_is_closed(self):
        for path in (APP / "widgets").glob("*.html"):
            text = path.read_text()
            self.assertNotRegex(text, r"<script[^>]+src=")
            self.assertIn("/*__EXT_APPS_BUNDLE__*/", text)
        server = (APP / "src" / "server.mjs").read_text()
        self.assertIn("frameDomains: []", server)
        self.assertIn("connectDomains: []", server)
        self.assertIn("resourceDomains: []", server)

    def test_sbom_and_direct_dependency_notice_exist(self):
        sbom = json.loads((APP / "sbom.cdx.json").read_text())
        self.assertEqual(sbom["bomFormat"], "CycloneDX")
        notice = (APP / "THIRD-PARTY-NOTICES.md").read_text()
        for package in ("@modelcontextprotocol/ext-apps", "@modelcontextprotocol/sdk", "ipaddr.js", "undici", "zod"):
            self.assertIn(package, notice)


if __name__ == "__main__":
    unittest.main()