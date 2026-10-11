import test from "node:test";
import assert from "node:assert/strict";
import { parseRobots, effectiveRobotsRule, runAudit, auditText, enforceResultLimit } from "../src/audit.mjs";
import { CHECK_IDS, DISCLAIMER } from "../src/constants.mjs";

function reply(url, status, contentType, body, extra = {}) { return { url, displayUrl: url, status, contentType, body: Buffer.from(body), redirects: extra.redirects || [], requestsMade: 1, downloadedBytes: Buffer.byteLength(body), retrievedAt: "2026-10-11T12:00:00.000Z", headers: { "x-robots-tag": extra.xRobotsTag || "" } }; }
function readyRequest(overrides = {}) { return async url => {
  const path = new URL(url).pathname;
  if (overrides[path] instanceof Error) throw overrides[path];
  if (overrides[path]) return overrides[path];
  if (path === "/robots.txt") return reply(url, 200, "text/plain", "User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n");
  if (path === "/sitemap.xml") return reply(url, 200, "application/xml", "<?xml version=\"1.0\"?><urlset><url><loc>https://example.com/page</loc></url></urlset>");
  if (path === "/llms.txt" || path === "/llms-full.txt") return reply(url, 200, "text/markdown", "# Example\n\nPublic documentation.\n\n## Docs\n- [Page](https://example.com/page)\n");
  return reply(url, 200, "text/html", "<!doctype html><html><head><title>Ready page</title><meta name=\"description\" content=\"A public test page\"><link rel=\"canonical\" href=\"https://example.com/page\"><script type=\"application/ld+json\">{\"@type\":\"WebPage\"}</script></head><body><main>This server-delivered public page contains enough useful text for deterministic crawler inspection. It explains the documentation, the product, the intended audience, and the public information available on this route.</main></body></html>");
}; }

test("robots parser uses specific groups, wildcard paths, longest match, and allow ties", () => {
  const parsed = parseRobots("User-agent: *\nDisallow: /private/*\nAllow: /private/public$\n\nUser-agent: GPTBot\nDisallow: /docs\nAllow: /docs/open\n");
  assert.equal(effectiveRobotsRule(parsed, "GPTBot", "/docs/no").type, "disallow");
  assert.equal(effectiveRobotsRule(parsed, "GPTBot", "/docs/open").type, "allow");
  assert.equal(effectiveRobotsRule(parsed, "ClaudeBot", "/private/a").type, "disallow");
  assert.equal(effectiveRobotsRule(parsed, "ClaudeBot", "/private/public").type, "allow");
});

test("complete passing audit is deterministic and makes no score claim", async () => {
  const result = await runAudit({ url: "https://example.com/page", scope: "page_and_site_controls", checks: CHECK_IDS }, { request: readyRequest() });
  assert.equal(result.status, "no_issues_detected_within_scope");
  assert.equal(result.checks.length, 9); assert.equal(result.requestUsage.requestsMade, 5); assert.equal(result.remediations.length, 0);
  assert.ok(result.summary.statement.includes("does not measure or guarantee"));
  assert.ok(!JSON.stringify(result).toLowerCase().includes("readiness score"));
  assert.ok(auditText(result).includes(DISCLAIMER));
});

test("robots disallow creates blocker and remediation", async () => {
  const robots = reply("https://example.com/robots.txt", 200, "text/plain", "User-agent: *\nDisallow: /page\n");
  const result = await runAudit({ url: "https://example.com/page", scope: "page_and_site_controls", checks: ["robots_access"] }, { request: readyRequest({ "/robots.txt": robots }) });
  assert.equal(result.status, "blocking_issues_found");
  assert.equal(result.checks[0].outcome, "block");
  assert.equal(result.remediations[0].id, "REM-ROBOTS-ACCESS-001");
  assert.ok(result.checks[0].evidence[0].observed.includes("GPTBot"));
});

test("llms false positives, malformed JSON-LD, noindex, low text, and challenge are warnings or blockers", async () => {
  const page = reply("https://example.com/page", 200, "text/html", "<html><head><meta name=\"robots\" content=\"noindex\"><script type=\"application/ld+json\">{bad}</script></head><body>captcha</body></html>");
  const llms = reply("https://example.com/", 200, "text/html", "<html><body>Home page</body></html>", { redirects: [{ from: "https://example.com/llms.txt", to: "https://example.com/", status: 302 }] });
  const result = await runAudit({ url: "https://example.com/page", scope: "page_and_site_controls", checks: ["page_directives", "page_metadata", "structured_data", "llms_txt", "challenge_signals"] }, { request: readyRequest({ "/page": page, "/llms.txt": llms }) });
  assert.equal(result.status, "blocking_issues_found");
  assert.equal(result.checks.find(item => item.id === "page_directives").outcome, "block");
  assert.equal(result.checks.find(item => item.id === "structured_data").outcome, "warn");
  assert.equal(result.checks.find(item => item.id === "llms_txt").outcome, "warn");
  assert.equal(result.checks.find(item => item.id === "challenge_signals").outcome, "block");
});

test("sitemap rejects DTD and marks request errors partial", async () => {
  const dtd = reply("https://example.com/sitemap.xml", 200, "application/xml", "<!DOCTYPE x [<!ENTITY y SYSTEM 'file:///etc/passwd'>]><urlset>&y;</urlset>");
  const result = await runAudit({ url: "https://example.com/page", scope: "site_controls_only", checks: ["sitemap", "target_fetch"] }, { request: readyRequest({ "/sitemap.xml": dtd }) });
  assert.equal(result.checks.find(item => item.id === "sitemap").outcome, "warn");
  assert.equal(result.checks.find(item => item.id === "target_fetch").outcome, "not_tested");
  assert.equal(result.status, "incomplete");
  const malformed = reply("https://example.com/sitemap.xml", 200, "application/xml", "<urlset><url><loc>https://example.com</urlset>");
  const malformedResult = await runAudit({ url: "https://example.com/page", scope: "site_controls_only", checks: ["sitemap"] }, { request: readyRequest({ "/sitemap.xml": malformed }) });
  assert.equal(malformedResult.checks[0].outcome, "warn");
});

test("result payload drops passing evidence before warning evidence", () => {
  const huge = { schemaVersion: "1.0", auditEngineVersion: "1", target: { url: "https://example.com", displayUrl: "https://example.com", origin: "https://example.com", scope: "page_and_site_controls" }, startedAt: "x", completedAt: "x", status: "warnings_only", summary: { blockers: 0, warnings: 1, passed: 1, notTested: 0, statement: "x" }, checks: [
    { id: "target_fetch", title: "pass", category: "transport", outcome: "pass", severity: "info", explanation: "x", evidence: [{ sourceUrl: "x", retrievedAt: "x", httpStatus: 200, contentType: "x", observed: "x".repeat(90000), expected: "x", excerpt: "x" }], limitations: [] },
    { id: "llms_txt", title: "warn", category: "discovery", outcome: "warn", severity: "low", explanation: "x", evidence: [{ sourceUrl: "x", retrievedAt: "x", httpStatus: 200, contentType: "x", observed: "y".repeat(90000), expected: "x", excerpt: "x" }], limitations: [] },
  ], remediations: [], requestUsage: { requestsMade: 1, downloadedBytes: 1, durationMs: 1 }, partial: false, errors: [], disclaimers: [] };
  const trimmed = enforceResultLimit(huge); assert.equal(trimmed.partial, true); assert.equal(trimmed.checks[0].evidence.length, 0); assert.equal(trimmed.checks[1].evidence.length, 1);
});
