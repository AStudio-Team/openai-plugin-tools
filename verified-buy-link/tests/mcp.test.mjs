import assert from "node:assert/strict";
import test from "node:test";
import { createHttpServer } from "../src/server.mjs";

async function withServer(run) {
  const server = createHttpServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try { await run(`http://127.0.0.1:${port}`); } finally { await new Promise(resolve => server.close(resolve)); }
}

async function rpc(base, body) {
  const response = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", host: "127.0.0.1" }, body: JSON.stringify(body) });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}

test("lists exact read-only tools and versioned UI resources", async () => withServer(async base => {
  const init = await rpc(base, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
  assert.equal(init.result.serverInfo.name, "verified-buy-link");
  const listed = await rpc(base, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = listed.result.tools;
  assert.deepEqual(tools.map(tool => tool.name).sort(), ["inspect_buy_option", "open_verified_buy_link", "refresh_buy_options", "render_buy_comparison", "verify_buy_options"]);
  for (const tool of tools) assert.deepEqual({ readOnlyHint: tool.annotations.readOnlyHint, destructiveHint: tool.annotations.destructiveHint, openWorldHint: tool.annotations.openWorldHint }, { readOnlyHint: true, destructiveHint: false, openWorldHint: true });
  assert.equal(tools.find(tool => tool.name === "open_verified_buy_link")._meta.ui.resourceUri, "ui://verified-buy-link/intake-v1.html");
  assert.equal(tools.find(tool => tool.name === "render_buy_comparison")._meta["openai/outputTemplate"], "ui://verified-buy-link/comparison-v1.html");
  assert.equal(tools.find(tool => tool.name === "verify_buy_options")._meta?.["openai/outputTemplate"], undefined);
  const resources = await rpc(base, { jsonrpc: "2.0", id: 3, method: "resources/list" });
  assert.deepEqual(resources.result.resources.map(resource => resource.uri).sort(), ["ui://verified-buy-link/comparison-v1.html", "ui://verified-buy-link/intake-v1.html"]);
  const read = await rpc(base, { jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: "ui://verified-buy-link/intake-v1.html" } });
  assert.equal(read.result.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.equal(read.result.contents[0]._meta.ui.csp.frameDomains.length, 0);
  assert.doesNotMatch(read.result.contents[0].text, /__EXT_APPS_BUNDLE__/);
  assert.doesNotMatch(read.result.contents[0].text, /<script[^>]+src=/i);
}));

test("open intake performs no research and has useful text fallback", async () => withServer(async base => {
  const output = await rpc(base, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "open_verified_buy_link", arguments: { query: "Acme Nova" } } });
  assert.equal(output.result.structuredContent.mode, "intake");
  assert.match(output.result.content[0].text, /No retailer page has been fetched/);
}));

test("verification requires current explicit confirmation and rejects restricted fields", async () => withServer(async base => {
  const baseInput = { product: { brand: "Acme", name: "Nova" }, product_urls: ["https://shop.example/product/nova"], market: { country_code: "AE", currency: "AED" }, constraints: { acceptable_conditions: ["new"], substitutions_allowed: false, authorization_requirement: "preferred", marketplace_tolerance: "retailers_only", strict_returns_acceptable: false, excluded_domains: [] } };
  const missing = await rpc(base, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "verify_buy_options", arguments: baseInput } });
  assert.equal(missing.result.isError, true);
  const restricted = await rpc(base, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "verify_buy_options", arguments: { ...baseInput, confirmation: { confirmed: true, confirmed_at: new Date().toISOString() }, card_number: "4111111111111111", address: "private" } } });
  assert.equal(restricted.result.isError, true);
}));

test("unknown source returns unable to verify without a Go or open action", async () => withServer(async base => {
  const input = { product: { brand: "Acme", name: "Nova" }, product_urls: ["https://shop.example/product/nova?utm_source=test"], market: { country_code: "AE", currency: "AED" }, constraints: { acceptable_conditions: ["new"], substitutions_allowed: false, authorization_requirement: "preferred", marketplace_tolerance: "retailers_only", strict_returns_acceptable: false, excluded_domains: [] }, confirmation: { confirmed: true, confirmed_at: new Date().toISOString() } };
  const output = await rpc(base, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "verify_buy_options", arguments: input } });
  assert.equal(output.result.isError, undefined);
  const candidate = output.result.structuredContent.candidates[0];
  assert.equal(candidate.verdict, "unable_to_verify");
  assert.equal(candidate.open_allowed, false);
  assert.equal(candidate.listing.normalized_product_url, "https://shop.example/product/nova");
  assert.doesNotMatch(output.result.content[0].text, /\| go \|/i);
}));

test("serves health, product, privacy, terms, support and source-rights pages", async () => withServer(async base => {
  for (const route of ["/health", "/", "/privacy", "/terms", "/support", "/source-rights"]) {
    const response = await fetch(base + route, { headers: { host: "127.0.0.1" } });
    assert.equal(response.status, 200, route);
    assert.ok((await response.text()).length > 50, route);
  }
}));