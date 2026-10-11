import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHttpServer } from "../src/server.mjs";
import { classifyRights, issueFlowToken, verifyFlowToken, parseRows, summarizeRows } from "../src/data.mjs";
import { isBlockedAddress, validatePublicUrl, assertSafeArchive } from "../src/security.mjs";
import { SOURCE_REGISTRY, decodeRef } from "../src/adapters.mjs";

const lookup = async () => [{ address: "8.8.8.8", family: 4 }];
const fixturePackage = license => ({
  id: "roads", name: "roads", title: "Road counts", notes: "Official traffic counts", metadata_modified: "2026-10-01T00:00:00Z",
  organization: { title: "Department of Transport" }, license_title: license,
  resources: [{ id: "csv-one", name: "Counts CSV", format: "CSV", size: 48, url: "https://catalog.data.gov/roads.csv" }],
});
function mockFetch(license = "Open Government Licence") {
  const searchHtml = `<li class="organization-datasets__item"><h3><a href="/dataset/roads">Road counts</a></h3><ul><li class="usa-collection__meta-item"><strong>Organization:</strong><a>Department of Transport</a></li><li class="usa-collection__meta-item"><strong>Dataset Last Updated:</strong> October 1, 2026</li></ul><p class="usa-collection__description">Official traffic counts</p><a data-format="csv">CSV</a></li>`;
  const detail = { "@type": "Dataset", name: "Road counts", description: "Official traffic counts", dateModified: "2026-10-01", publisher: { name: "Department of Transport" }, license, distribution: [{ "@type": "DataDownload", name: "Counts CSV", contentUrl: "https://catalog.data.gov/roads.csv", encodingFormat: "text/csv", contentSize: 48 }] };
  const detailHtml = `<script type="application/ld+json">${JSON.stringify(detail)}</script>`;
  return async url => {
    const value = String(url);
    if (value.includes("catalog.data.gov/?q=")) return new Response(searchHtml, { headers: { "content-type": "text/html" } });
    if (value.includes("catalog.data.gov/dataset/roads")) return new Response(detailHtml, { headers: { "content-type": "text/html" } });
    if (value.endsWith("roads.csv")) return new Response("year,count,region\n2024,12,North\n2025,18,South\n2025,18,South\n", { headers: { "content-type": "text/csv" } });
    throw new Error(`unexpected URL ${value}`);
  };
}
async function listen(server) { await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); return server.address().port; }
async function rpc(port, method, params, id = 1) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }) });
  assert.equal(response.status, 200); return response.json();
}

test("official registry is closed and refs are opaque", () => {
  assert.deepEqual(Object.keys(SOURCE_REGISTRY), ["us_data_gov", "uk_data_gov", "world_bank"]);
  assert.equal(decodeRef("us_data_gov:roads").id, "roads");
  assert.throws(() => decodeRef("other:https://attacker.test"), /INVALID_REFERENCE/);
});

test("rights fail closed", () => {
  assert.equal(classifyRights("CC BY 4.0").verdict, "green");
  assert.equal(classifyRights("Custom terms").verdict, "amber");
  assert.equal(classifyRights("All rights reserved").verdict, "red");
  assert.notEqual(classifyRights("").verdict, "green");
});

test("flow tokens are signed, scoped and expire", () => {
  const token = issueFlowToken("checkpoint", { dataset_ref: "us_data_gov:roads", rights: "green" });
  assert.equal(verifyFlowToken(token, "checkpoint", { dataset_ref: "us_data_gov:roads" }).rights, "green");
  assert.throws(() => verifyFlowToken(`${token}x`, "checkpoint"), /FLOW_TOKEN_INVALID/);
  assert.throws(() => verifyFlowToken(token, "preview"), /FLOW_TOKEN_EXPIRED/);
});

test("SSRF policy blocks local and unapproved targets", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fd00::1", "2001:db8::1"]) assert.equal(isBlockedAddress(address), true, address);
  await assert.rejects(validatePublicUrl("https://127.0.0.1/x", new Set(["https://127.0.0.1"]), lookup), /PRIVATE_ADDRESS/);
  await assert.rejects(validatePublicUrl("https://evil.test/x", new Set(["https://catalog.data.gov"]), lookup), /ORIGIN_NOT_ALLOWLISTED/);
  await assert.rejects(validatePublicUrl("https://user:pass@catalog.data.gov/x", SOURCE_REGISTRY.us_data_gov.catalogOrigins, lookup), /URL_POLICY_BLOCKED/);
  await assert.rejects(validatePublicUrl("http://catalog.data.gov/x", SOURCE_REGISTRY.us_data_gov.catalogOrigins, lookup), /URL_POLICY_BLOCKED/);
  const accepted = await validatePublicUrl("https://catalog.data.gov/api", SOURCE_REGISTRY.us_data_gov.catalogOrigins, lookup);
  assert.equal(accepted.url.hostname, "catalog.data.gov");
});

test("archive defenses reject traversal, encryption and bombs", () => {
  const zip = (name, flags = 0, compressed = 1, expanded = 1) => {
    const file = Buffer.from(name); const buffer = Buffer.alloc(30 + file.length + compressed);
    buffer.writeUInt32LE(0x04034b50, 0); buffer.writeUInt16LE(flags, 6); buffer.writeUInt16LE(0, 8); buffer.writeUInt32LE(compressed, 18); buffer.writeUInt32LE(expanded, 22); buffer.writeUInt16LE(file.length, 26); file.copy(buffer, 30); return buffer;
  };
  assert.throws(() => assertSafeArchive(zip("../secret")), /ARCHIVE_PATH_BLOCKED/);
  assert.throws(() => assertSafeArchive(zip("data.csv", 1)), /ARCHIVE_ENCRYPTED/);
  assert.throws(() => assertSafeArchive(zip("data.csv", 0, 1, 101)), /ARCHIVE_BOMB_BLOCKED/);
  assert.equal(assertSafeArchive(Buffer.from("plain")).archive, false);
});

test("bounded parsing handles quoted CSV and reports quality", () => {
  const rows = parseRows(Buffer.from('name,value\n"A, B",1\nC,\nC,\n'), "CSV", 10);
  assert.equal(rows[0].name, "A, B");
  const summary = summarizeRows(rows);
  assert.equal(summary.quality.sample_size, 3);
  assert.equal(summary.quality.duplicate_rows_sample, 1);
  assert.equal(summary.columns.find(column => column.name === "value").nullable, true);
});

test("MCP lists app tools and closed resources", async context => {
  const server = createHttpServer({ fetchImpl: mockFetch(), lookup }); const port = await listen(server); context.after(() => new Promise(resolve => server.close(resolve)));
  const listed = await rpc(port, "tools/list");
  assert.deepEqual(listed.result.tools.map(tool => tool.name), ["search_open_data", "discover_datasets", "inspect_open_dataset", "preview_open_dataset", "prepare_open_data_export"]);
  for (const tool of listed.result.tools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.annotations.openWorldHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
  }
  const resources = await rpc(port, "resources/list", undefined, 2);
  assert.deepEqual(resources.result.resources.map(resource => resource.uri), ["ui://open-data/search-picker-v1.html", "ui://open-data/dataset-preview-v1.html"]);
  for (const uri of resources.result.resources.map(resource => resource.uri)) {
    const read = await rpc(port, "resources/read", { uri }, 3);
    assert.equal(read.result.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.match(read.result.contents[0].text, /globalThis\.ExtApps/);
    assert.doesNotMatch(read.result.contents[0].text, /https:\/\/esm\.sh|<script[^>]+src=/);
  }
});

test("complete green flow requires human gates and creates host download", async context => {
  const server = createHttpServer({ fetchImpl: mockFetch(), lookup }); const port = await listen(server); context.after(() => new Promise(resolve => server.close(resolve)));
  const noHumanSearch = await rpc(port, "tools/call", { name: "discover_datasets", arguments: { source: "us_data_gov", query: "road", page: 1 } }, 1);
  assert.equal(noHumanSearch.result.isError, true);
  const found = await rpc(port, "tools/call", { name: "discover_datasets", arguments: { source: "us_data_gov", query: "road", page: 1, human_search_submitted: true } }, 2);
  const datasetRef = found.result.structuredContent.results[0].dataset_ref;
  const noSelection = await rpc(port, "tools/call", { name: "inspect_open_dataset", arguments: { dataset_ref: datasetRef } }, 3);
  assert.equal(noSelection.result.isError, true);
  const inspected = await rpc(port, "tools/call", { name: "inspect_open_dataset", arguments: { dataset_ref: datasetRef, human_selection_confirmed: true } }, 4);
  assert.equal(inspected.result.structuredContent.rights.verdict, "green");
  const info = inspected.result.structuredContent;
  const preview = await rpc(port, "tools/call", { name: "preview_open_dataset", arguments: { dataset_ref: datasetRef, resource_ref: info.resources[0].resource_ref, sample_rows: 50, license_acknowledged: true, checkpoint_token: info.checkpoint_token } }, 5);
  assert.equal(preview.result.structuredContent.rows.length, 3);
  const exported = await rpc(port, "tools/call", { name: "prepare_open_data_export", arguments: { dataset_ref: datasetRef, resource_ref: info.resources[0].resource_ref, format: "csv", selected_columns: ["year", "count"], filters: [{ column: "year", operator: "eq", value: "2025" }], row_limit: 100, license_acknowledged: true, export_confirmed: true, preview_token: preview.result.structuredContent.preview_token } }, 6);
  assert.equal(exported.result.structuredContent.status, "ready");
  assert.equal(exported.result.structuredContent.summary.rows_written, 2);
  assert.match(exported.result.structuredContent.summary.sha256, /^[a-f0-9]{64}$/);
  assert.ok(exported.result._meta.download.content_base64);
  assert.doesNotMatch(JSON.stringify(exported.result.structuredContent), /content_base64|downloads\//);
});

test("amber rights default to publisher and block preview", async context => {
  const server = createHttpServer({ fetchImpl: mockFetch("Custom noncommercial terms"), lookup }); const port = await listen(server); context.after(() => new Promise(resolve => server.close(resolve)));
  const inspected = await rpc(port, "tools/call", { name: "inspect_open_dataset", arguments: { dataset_ref: "us_data_gov:roads", human_selection_confirmed: true } }, 1);
  const data = inspected.result.structuredContent;
  assert.equal(data.rights.verdict, "amber");
  const preview = await rpc(port, "tools/call", { name: "preview_open_dataset", arguments: { dataset_ref: data.dataset.dataset_ref, resource_ref: data.resources[0].resource_ref, sample_rows: 50, license_acknowledged: true, checkpoint_token: data.checkpoint_token } }, 2);
  assert.equal(preview.result.isError, true);
});

test("health, host allowlist and request limit fail safely", async context => {
  const server = createHttpServer(); const port = await listen(server); context.after(() => new Promise(resolve => server.close(resolve)));
  const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  assert.equal(health.arbitrary_urls, false); assert.equal(health.credentials, false);
  const hostStatus = await new Promise((resolve, reject) => { const req = http.request({ hostname: "127.0.0.1", port, path: "/health", headers: { host: "evil.test" } }, response => { response.resume(); response.on("end", () => resolve(response.statusCode)); }); req.on("error", reject); req.end(); });
  assert.equal(hostStatus, 421);
  const oversized = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: "/mcp", method: "POST", headers: { "content-type": "application/json", "content-length": String(256 * 1024 + 1) } }, response => { response.resume(); response.on("end", () => resolve(response.statusCode)); });
    req.on("error", reject); req.end();
  });
  assert.equal(oversized, 413);
});
