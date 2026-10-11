import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { openPageBrief, reviewPageBrief, draftPageCopy, checkPageConversion, selectPageCopyVariant, exportPageCopy, createHttpServer } from "../src/server.mjs";

const brief = { pageType: "homepage", product: "A scheduling tool", audience: "Small teams", offer: "Free trial", goal: "Get demos", tone: "Clear", mustKeepFacts: ["Free trial"] };
const copy = { headline: "Schedule work without the chaos", subhead: "A clear workspace for small teams.", valuePoints: ["Plan work", "See progress", "Share updates"], proof: ["Used by 20 teams"], primaryCta: "Get started", faq: [{ question: "Is it free?", answer: "Start with a free trial." }] };

test("brief, draft, selection and approval provenance", () => {
  assert.equal(openPageBrief().fields.length, 8);
  assert.equal(reviewPageBrief(brief).canApprove, true);
  assert.throws(() => draftPageCopy({ briefApproved: false, brief, copy }));
  assert.deepEqual(draftPageCopy({ briefApproved: true, brief, copy }).factCheck.missing, []);
  assert.throws(() => selectPageCopyVariant({ variants: [copy, { ...copy, headline: "A second clear option" }], selected: 2 }));
  const result = selectPageCopyVariant({ variants: [copy, { ...copy, headline: "A second clear option" }], selected: 2, selectionApproved: true, brief });
  assert.deepEqual(result.approval, { selectionApproved: true, selectedIndex: 2 });
});

test("banned claims and strict schemas are rejected", () => {
  for (const claim of ["Increase conversions by 200 percent", "Grow 10x today"]) assert.throws(() => draftPageCopy({ briefApproved: true, brief, copy: { ...copy, subhead: claim } }), /unsupported claims/);
  const allowedBrief = { ...brief, mustKeepFacts: ["10x"] };
  assert.equal(draftPageCopy({ briefApproved: true, brief: allowedBrief, copy: { ...copy, subhead: "Grow 10x today" } }).copy.subhead, "Grow 10x today");
  assert.throws(() => reviewPageBrief({ ...brief, extra: true }));
  assert.throws(() => draftPageCopy({ briefApproved: true, brief, copy: { ...copy, extra: true } }));
});

test("conversion checks distinguish missing values and findings", () => {
  const missing = checkPageConversion({});
  assert.equal(missing.score, null);
  assert.ok(missing.checks.every(item => item.status === "not checked"));
  assert.throws(() => checkPageConversion({ formFieldCount: -1 }));
  assert.throws(() => checkPageConversion({ formFieldCount: 1.5 }));
  const checked = checkPageConversion({ copy: "See plans", headline: "See the right plan", formFieldCount: 2, popupDelaySeconds: 0 });
  assert.equal(checked.checks[0].pass, true);
  assert.equal(checked.checks.at(-1).status, "finding");
  assert.equal(checkPageConversion({ copy: "Get started", headline: "Start here", formFieldCount: 2, popupDelaySeconds: 10 }).checks[0].pass, true);
});

test("exports escape HTML and include proof and FAQ", () => {
  const unsafe = { ...copy, headline: "Build <better> pages", proof: ["Trusted & tested"], faq: [{ question: "Why <now>?", answer: 'Because "today" matters.' }] };
  const html = exportPageCopy({ copy: unsafe, format: "html", selectionApproved: true }).content;
  assert.doesNotMatch(html, /<better>|<now>/);
  assert.match(html, /Trusted &amp; tested/);
  assert.match(html, /FAQ/);
  const markdown = exportPageCopy({ copy, format: "markdown", selectionApproved: true }).content;
  assert.match(markdown, /## Proof/);
  assert.match(markdown, /## FAQ/);
});

async function post(base, payload) { const response = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(payload) }); assert.equal(response.status, 200); return response.json(); }

test("HTTP health, MCP discovery, resources and consecutive requests", async t => {
  const server = createHttpServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const endpoint of ["health", "ready"]) { const response = await fetch(`${base}/${endpoint}`); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: "ok", service: "landing-page-copy-check", version: "1.0.0", persistence: false, outbound_network: false }); }
  const initialized = await post(base, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
  assert.equal(initialized.result.serverInfo.name, "landing-page-copy-check");
  for (const id of [2, 3]) { const listed = await post(base, { jsonrpc: "2.0", id, method: "tools/list" }); assert.equal(listed.result.tools.length, 6); }
  const resources = await post(base, { jsonrpc: "2.0", id: 4, method: "resources/list" });
  assert.equal(resources.result.resources.length, 5);
  for (const [index, resource] of resources.result.resources.entries()) { const read = await post(base, { jsonrpc: "2.0", id: 10 + index, method: "resources/read", params: { uri: resource.uri } }); assert.equal(read.result.contents[0].mimeType, "text/html;profile=mcp-app"); assert.ok(read.result.contents[0].text.trim()); }
});
