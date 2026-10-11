import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { checkFidelity, consumeRateLimit, createHttpServer, lintCopy, prepareBrief } from "../src/server.mjs";

const EXPECTED_DESCRIPTIONS = {
  prepare_gcc_arabic_brief: "Use this when preparing Arabic copywriting, rewriting or GCC localization. It normalizes only the supplied brief, defaults to MSA, protects literals and returns a deterministic fingerprint. It does not generate copy or research facts.",
  check_arabic_factual_fidelity: "Use this when checking whether rewritten or localized Arabic copy preserved source numbers, dates, percentages, currency or quantity literals, URLs and protected literals. It flags missing facts and extra numeric claims but does not verify truth.",
  lint_gcc_arabic_copy: "Use this when reviewing Arabic marketing or business copy for transparent style and safety rules. It checks punctuation, stock calques, unsupported superlatives, religious sales risk, dialect-marker heuristics, partial diacritics, length and Arabic-script ratio. It never certifies native, legal or cultural quality.",
};

async function listen(server) {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function post(port, payload, headers = {}) {
  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

test("normalizes briefs, defaults to MSA and fingerprints deterministically", () => {
  const input = { task: "caption", market: "uae", mandatory_facts: [" AED 250 ", "AED 250"], protected_literals: ["Maison X"], constraints: [] };
  const first = prepareBrief(input);
  const second = prepareBrief(input);
  assert.equal(first.language_policy, "Modern Standard Arabic");
  assert.equal(first.native_review_required, false);
  assert.deepEqual(first.mandatory_facts, ["AED 250"]);
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(first.fingerprint, second.fingerprint);
});

test("requires native review for dialect-sensitive briefs", () => {
  const brief = prepareBrief({ task: "localize", market: "saudi-arabia", register: "dialect-sensitive", dialect_requested: true });
  assert.equal(brief.native_review_required, true);
  assert.match(brief.language_policy, /dialect-sensitive/);
});

test("fidelity handles Western and Arabic-Indic numeric equivalents", () => {
  const checked = checkFidelity({
    source_text: "السعر AED 250 والخصم 15% بتاريخ 2026-10-11. الحجم 50 مل. https://example.com/x",
    candidate_text: "السعر AED ٢٥٠ والخصم ١٥٪ بتاريخ ٢٠٢٦-١٠-١١. الحجم ٥٠ مل. https://example.com/x",
    protected_literals: [],
  });
  assert.equal(checked.preservation_passed, true);
  assert.deepEqual(checked.missing_facts, []);
  assert.deepEqual(checked.extra_numeric_claims, []);
  assert.match(checked.scope_note, /does not verify/);
});

test("fidelity reports missing literals and added numeric claims", () => {
  const checked = checkFidelity({ source_text: "السعر 100 درهم يوم 2026-10-11", candidate_text: "السعر 120 درهم", protected_literals: ["SKU-X"] });
  assert.equal(checked.preservation_passed, false);
  assert.ok(checked.missing_facts.some(item => item.category === "date" || item.category === "dates"));
  assert.ok(checked.missing_facts.some(item => item.category === "protected_literal"));
  assert.deepEqual(checked.extra_numeric_claims, ["120"]);
});

test("fidelity rejects loss of caller-supplied mandatory fact literals", () => {
  const checked = checkFidelity({
    source_text: "العرض صالح حتى 2026-10-11 فقط لمنتج Maison X",
    candidate_text: "2026-10-11",
    mandatory_facts: ["Maison X", "العرض صالح"],
    protected_literals: [],
  });
  assert.equal(checked.preservation_passed, false);
  assert.deepEqual(checked.missing_facts.filter(item => item.category === "mandatory_fact_literal").map(item => item.literal), ["Maison X", "العرض صالح"]);
});

test("fidelity treats protected literal spacing as exact", () => {
  const checked = checkFidelity({ source_text: "اسم المنتج", candidate_text: "Maison X", protected_literals: ["Maison  X"] });
  assert.equal(checked.preservation_passed, false);
  assert.ok(checked.missing_facts.some(item => item.category === "protected_literal"));
});

test("lint reports every focused transparent rule", () => {
  const checked = lintCopy({
    text: `حيث تلتقي الفخامة بالأفضل ${String.fromCodePoint(0x2014)} اشتر بركة مضمونة وش شو وايد. نَص عربي English 123`,
    market: "uae",
    dialect_approved: false,
    approved_claims: [],
    min_words: 30,
    max_words: 40,
    minimum_arabic_ratio: 0.95,
  });
  const rules = new Set(checked.issues.map(issue => issue.rule));
  for (const rule of ["em-dash", "stock-calque", "unsupported-superlative", "religious-sales-risk", "unapproved-dialect-marker", "mixed-dialect-markers", "partial-diacritics", "minimum-length", "arabic-script-ratio"]) assert.ok(rules.has(rule), rule);
  assert.equal(checked.passed, false);
  assert.match(checked.scope_note, /not native-speaker certification/);
});

test("lint allows a clean MSA line and approved claim", () => {
  const checked = lintCopy({ text: "عطر يحمل ذاكرة المكان بحرفية دقيقة", market: "pan-arab", dialect_approved: false, approved_claims: [], minimum_arabic_ratio: 0.8 });
  assert.equal(checked.passed, true);
  assert.deepEqual(checked.issues, []);
});

test("health, readiness, host allowlist and bounded request bodies", async context => {
  const server = createHttpServer();
  const port = await listen(server);
  context.after(() => new Promise(resolve => server.close(resolve)));
  for (const route of ["health", "ready"]) {
    const response = await fetch(`http://127.0.0.1:${port}/${route}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.persistence, false);
    assert.equal(body.outbound_network, false);
  }
  const hostStatus = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: "/health", headers: { host: "attacker.example" } }, response => { response.resume(); response.on("end", () => resolve(response.statusCode)); });
    req.on("error", reject);
    req.end();
  });
  assert.equal(hostStatus, 421);
  const oversized = await post(port, "x".repeat(128 * 1024 + 1), { "content-length": String(128 * 1024 + 1) });
  assert.equal(oversized.status, 413);
});

test("MCP lists strict tools with exact descriptions and read-only annotations", async context => {
  const server = createHttpServer();
  const port = await listen(server);
  context.after(() => new Promise(resolve => server.close(resolve)));
  const response = await post(port, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.result.tools.length, 3);
  for (const tool of payload.result.tools) {
    assert.equal(tool.description, EXPECTED_DESCRIPTIONS[tool.name]);
    assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.outputSchema.additionalProperties, false);
  }
});

test("stateless MCP rejects persistent GET and DELETE connections", async context => {
  const server = createHttpServer();
  const port = await listen(server);
  context.after(() => new Promise(resolve => server.close(resolve)));
  for (const method of ["GET", "DELETE"]) {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST, OPTIONS");
  }
});

test("MCP validates strict input and returns deterministic structured output", async context => {
  const server = createHttpServer();
  const port = await listen(server);
  context.after(() => new Promise(resolve => server.close(resolve)));
  const call = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "prepare_gcc_arabic_brief", arguments: { task: "tagline", protected_literals: ["Brand X"] } } };
  const logLines = [];
  const originalLog = console.log;
  console.log = line => logLines.push(String(line));
  try {
    const first = await (await post(port, call)).json();
    const second = await (await post(port, call)).json();
    assert.equal(first.result.structuredContent.fingerprint, second.result.structuredContent.fingerprint);
    const invalid = await (await post(port, { ...call, id: 3, params: { ...call.params, arguments: { task: "tagline", unknown: true } } })).json();
    assert.equal(invalid.result.isError, true);
  } finally {
    console.log = originalLog;
  }
  const records = logLines.map(line => JSON.parse(line));
  assert.ok(records.some(record => record.tool === "prepare_gcc_arabic_brief" && record.status === "http_completed"));
  assert.equal(records.some(record => record.status === "handled"), false);
});

test("rate limiting rejects repeated requests and ignores spoofed forwarding headers", () => {
  const request = { headers: { "x-plugin-client-ip": `198.51.100.${Math.floor(Math.random() * 100)}`, "cf-connecting-ip": "203.0.113.99" }, socket: { remoteAddress: "127.0.0.1" } };
  for (let index = 0; index < 60; index += 1) assert.equal(consumeRateLimit(request), true);
  assert.equal(consumeRateLimit(request), false);
});
