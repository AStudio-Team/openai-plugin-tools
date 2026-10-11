import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateTarget, createHttpServer } from "../src/server.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function mockReply(url) { const pathName = new URL(url).pathname; const bodies = { "/robots.txt": "User-agent: *\nAllow: /", "/sitemap.xml": "<urlset><url><loc>https://example.com/page</loc></url></urlset>", "/llms.txt": "# Example", "/llms-full.txt": "# Example full" }; const body = bodies[pathName] || "<html><head><title>Page title</title><meta name=\"description\" content=\"Description\"><link rel=\"canonical\" href=\"https://example.com/page\"></head><body>This is public server delivered text with enough explanatory content for the test page and its intended technical audit purpose. Additional wording makes the response exceed the low text threshold.</body></html>"; return { url, displayUrl: url, status: 200, contentType: pathName.endsWith(".xml") ? "application/xml" : pathName.endsWith(".txt") ? "text/plain" : "text/html", headers: { "x-robots-tag": "" }, body: Buffer.from(body), redirects: [], requestsMade: 1, downloadedBytes: Buffer.byteLength(body), retrievedAt: "2026-10-11T12:00:00.000Z" }; }
const request = async url => mockReply(url);

async function rpc(base, id, method, params = undefined) { const response = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", host: "127.0.0.1" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }) }); assert.equal(response.status, 200); return response.json(); }
function fixtureRequest(port, host, pathname) { return new Promise((resolve, reject) => { const request = http.request({ hostname: "127.0.0.1", port, path: pathname, headers: { host } }, response => { const chunks = []; response.on("data", chunk => chunks.push(chunk)); response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") })); }); request.on("error", reject); request.end(); }); }

test("validation returns a signed checkpoint and redacts query values", async () => {
  const value = await validateTarget({ url: "https://example.com/page?secret=value", scope: "page_and_site_controls", checks: ["target_fetch"] }, request);
  assert.equal(value.valid, true); assert.ok(value.checkpoint.token.length > 32); assert.ok(!value.target.displayUrl.includes("value")); assert.equal(value.checkpoint.requestBudget.maximumRequests, 8);
});

test("MCP lists exact tools and UI resources, then enforces checkpoint", async t => {
  const server = createHttpServer({ request }); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const init = await rpc(base, 1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } }); assert.equal(init.result.serverInfo.name, "ai-crawler-readiness-auditor");
  const listed = await rpc(base, 2, "tools/list"); assert.deepEqual(listed.result.tools.map(tool => tool.name), ["validate_audit_target", "run_readiness_audit"]); for (const tool of listed.result.tools) { assert.equal(tool.annotations.readOnlyHint, true); assert.equal(tool.annotations.destructiveHint, false); assert.equal(tool.annotations.openWorldHint, true); assert.equal(tool.inputSchema.additionalProperties, false); assert.equal(tool.outputSchema.additionalProperties, false); assert.ok(tool._meta.ui.resourceUri); }
  const resources = await rpc(base, 3, "resources/list"); assert.equal(resources.result.resources.length, 2); assert.ok(resources.result.resources.every(item => item.mimeType === "text/html;profile=mcp-app"));
  for (const item of resources.result.resources) { const read = await rpc(base, 4, "resources/read", { uri: item.uri }); const resource = read.result.contents[0]; assert.equal(resource.mimeType, "text/html;profile=mcp-app"); assert.ok(resource.text.includes("globalThis.ExtApps")); assert.ok(!resource.text.includes("https://esm.sh")); assert.deepEqual(resource._meta.ui.csp.connectDomains, []); }
  const invalidRun = await rpc(base, 5, "tools/call", { name: "run_readiness_audit", arguments: { url: "https://example.com/page", scope: "page_and_site_controls", checks: ["target_fetch"], checkpointToken: "x".repeat(32) } }); assert.equal(invalidRun.result.isError, true);
  const extraField = await rpc(base, 51, "tools/call", { name: "validate_audit_target", arguments: { url: "https://example.com/page", scope: "page_and_site_controls", checks: ["target_fetch"], unexpected: true } }); assert.equal(extraField.result.isError, true);
  const missingField = await rpc(base, 52, "tools/call", { name: "validate_audit_target", arguments: { url: "https://example.com/page", scope: "page_and_site_controls" } }); assert.equal(missingField.result.isError, true);
  const validation = await rpc(base, 6, "tools/call", { name: "validate_audit_target", arguments: { url: "https://example.com/page", scope: "page_and_site_controls", checks: ["target_fetch"] } }); assert.equal(validation.result.structuredContent.valid, true);
  const run = await rpc(base, 7, "tools/call", { name: "run_readiness_audit", arguments: { url: "https://example.com/page", scope: "page_and_site_controls", checks: ["target_fetch"], checkpointToken: validation.result.structuredContent.checkpoint.token } }); assert.equal(run.result.structuredContent.status, "no_issues_detected_within_scope"); assert.ok(run.result.content[0].text.includes("does not measure or guarantee"));
});

test("widgets expose human-visible actions without direct network or storage APIs", () => {
  const checkpoint = readFileSync(path.join(ROOT, "widgets/checkpoint.html"), "utf8"); const results = readFileSync(path.join(ROOT, "widgets/results.html"), "utf8");
  for (const html of [checkpoint, results]) { assert.ok(html.includes("autoResize:true")); assert.ok(html.includes("safeAreaInsets")); assert.ok(html.includes(":focus-visible")); assert.ok(html.includes("prefers-reduced-motion")); assert.ok(!html.includes("fetch(")); assert.ok(!html.includes("localStorage")); assert.ok(!html.includes("sessionStorage")); assert.ok(!html.includes("window.open")); assert.ok(!/<script[^>]+src=/i.test(html)); }
  assert.ok(checkpoint.includes("Run audit")); assert.ok(checkpoint.includes("Edit URL")); assert.ok(checkpoint.includes("Cancel")); assert.ok(checkpoint.includes("app.sendMessage"));
  assert.ok(results.includes("Ask for guidance on selected items")); assert.ok(results.includes("Recheck selected items")); assert.ok(results.includes("Recheck all")); assert.ok(results.includes("app.downloadFile")); assert.ok(results.includes("app.openLink"));
});

test("synthetic review fixtures redirect to isolated origins and expose deterministic signals", async t => {
  const server = createHttpServer({ request }); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => server.close());
  const port = server.address().port;
  const redirect = await fixtureRequest(port, "fixtures.astudio.agency", "/robots-blocked/article");
  assert.equal(redirect.status, 302); assert.equal(redirect.headers.location, "https://robots-blocked.fixtures.astudio.agency/article");
  const robots = await fixtureRequest(port, "robots-blocked.fixtures.astudio.agency", "/robots.txt");
  assert.equal(robots.status, 200); assert.ok(robots.body.includes("Disallow: /article"));
  const llms = await fixtureRequest(port, "llms-html.fixtures.astudio.agency", "/llms.txt");
  assert.match(llms.headers["content-type"], /text\/html/);
  const jsonLd = await fixtureRequest(port, "invalid-jsonld.fixtures.astudio.agency", "/product");
  assert.ok(jsonLd.body.includes("{invalid"));
  const sitemap = await fixtureRequest(port, "sitemap-timeout.fixtures.astudio.agency", "/sitemap.xml");
  assert.equal(sitemap.status, 504);
});

test("public privacy disclosure and source contain no URL logging", () => {
  const privacy = readFileSync(path.join(ROOT, "public/privacy.html"), "utf8"); for (const phrase of ["data controller", "public HTTPS page", "no accounts", "30 days", "one-minute", "cross-border", "deletion requests", "own terms"]) assert.ok(privacy.includes(phrase), phrase);
  const server = readFileSync(path.join(ROOT, "src/server.mjs"), "utf8"); assert.ok(!/console\.log\([^\n]*(?:url|body|query)/i.test(server));
});
