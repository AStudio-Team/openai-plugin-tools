import http from "node:http";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { buildConversionToolResult, consumeRateLimit, createHttpServer, downloadPdf, validatePublicBaseUrl } from "../src/server.mjs";
import { loadWidget } from "../src/widget-support.mjs";

async function postMcp(port, payload) {
  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(payload),
  });
}

test("rejects private and non-HTTPS download URLs", async () => {
  await assert.rejects(() => downloadPdf("http://example.com/file.pdf"), /HTTPS/);
  await assert.rejects(() => downloadPdf("https://127.0.0.1/file.pdf"), /not publicly reachable/);
  await assert.rejects(() => downloadPdf("https://[::1]/file.pdf"), /not publicly reachable/);
  await assert.rejects(() => downloadPdf("https://[::ffff:127.0.0.1]/file.pdf"), /not publicly reachable/);
  await assert.rejects(() => downloadPdf("https://192.0.2.1/file.pdf"), /not publicly reachable/);
  await assert.rejects(() => downloadPdf("https://224.0.0.1/file.pdf"), /not publicly reachable/);
});

test("validates the production public base URL protocol, origin and service path at startup", () => {
  assert.equal(validatePublicBaseUrl("https://www.astudio.agency/openai-plugins/pdf-table-to-excel/", true), "https://www.astudio.agency/openai-plugins/pdf-table-to-excel");
  for (const value of [
    "http://www.astudio.agency/openai-plugins/pdf-table-to-excel",
    "https://attacker.example/openai-plugins/pdf-table-to-excel",
    "https://www.astudio.agency/wrong-service",
  ]) assert.throws(() => validatePublicBaseUrl(value, true), /Production PUBLIC_BASE_URL/);
  const failed = spawnSync(process.execPath, ["src/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, NODE_ENV: "production", PUBLIC_BASE_URL: "http://attacker.example/openai-plugins/pdf-table-to-excel" },
    encoding: "utf8",
  });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /Production PUBLIC_BASE_URL/);
});

test("limits repeated MCP requests per trusted proxy client header", () => {
  const request = { headers: { "x-plugin-client-ip": "198.51.100.42", "cf-connecting-ip": "203.0.113.99" }, socket: { remoteAddress: "127.0.0.1" } };
  for (let index = 0; index < 10; index += 1) assert.equal(consumeRateLimit(request), true);
  assert.equal(consumeRateLimit(request), false);
});

test("stateless MCP rejects persistent GET and DELETE connections", async context => {
  const server = createHttpServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  for (const method of ["GET", "DELETE"]) {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST, OPTIONS");
  }
});

test("serves health, readiness and public landing pages", async (context) => {
  const server = createHttpServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).service, "pdf-table-to-excel");
  const ready = await fetch(`http://127.0.0.1:${port}/ready`);
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).service, "pdf-table-to-excel");
  const landing = await fetch(`http://127.0.0.1:${port}/pdf-table-to-excel`);
  assert.equal(landing.status, 200);
  assert.match(await landing.text(), /PDF Table/);
});

test("lists and reads the result app resource with closed CSP and official MIME type", async context => {
  const server = createHttpServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const listed = await (await postMcp(port, { jsonrpc: "2.0", id: 31, method: "resources/list" })).json();
  assert.equal(listed.result.resources.length, 1);
  const resource = listed.result.resources[0];
  assert.equal(resource.uri, "ui://pdf-table-to-excel/result-preview.html");
  assert.equal(resource.mimeType, "text/html;profile=mcp-app");
  assert.deepEqual(resource._meta.ui.csp, { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] });
  const read = await (await postMcp(port, { jsonrpc: "2.0", id: 32, method: "resources/read", params: { uri: resource.uri } })).json();
  const content = read.result.contents[0];
  assert.equal(content.mimeType, "text/html;profile=mcp-app");
  assert.ok(content.text.includes("globalThis.ExtApps="));
  assert.equal(content.text.includes("/*__EXT_APPS_BUNDLE__*/"), false);
  assert.equal(/<script[^>]+src=/iu.test(content.text), false);
  assert.deepEqual(content._meta.ui.csp, resource._meta.ui.csp);
});

test("result widget uses host-safe download and visible follow-up actions", () => {
  const html = readFileSync(new URL("../widgets/result-preview.html", import.meta.url), "utf8");
  const serverSource = readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");
  assert.match(serverSource, /Worksheets:/);
  assert.match(serverSource, /verified temporary link expires in 15 minutes/);
  assert.match(serverSource, /ask to rename the workbook, inspect a worksheet preview or convert another uploaded PDF/);
  assert.match(html, /function trustedDownloadUrl/);
  assert.match(html, /url\.protocol==="https:"/);
  assert.match(html, /url\.origin==="https:\/\/www\.astudio\.agency"/);
  assert.match(html, /app\.openLink\(\{url\}\)/);
  const guardStart = html.indexOf("function trustedDownloadUrl");
  const guardEnd = html.indexOf("\napp.ontoolresult", guardStart);
  const trustedDownloadUrl = new Function(`${html.slice(guardStart, guardEnd)}; return trustedDownloadUrl;`)();
  assert.equal(trustedDownloadUrl("http://www.astudio.agency/openai-plugins/pdf-table-to-excel/downloads/a/x.xlsx"), null);
  assert.equal(trustedDownloadUrl("https://attacker.example/openai-plugins/pdf-table-to-excel/downloads/a/x.xlsx"), null);
  assert.equal(trustedDownloadUrl("https://www.astudio.agency/openai-plugins/pdf-table-to-excel/downloads/a/x.xlsx"), "https://www.astudio.agency/openai-plugins/pdf-table-to-excel/downloads/a/x.xlsx");
  assert.match(html, /app\.sendMessage/);
  assert.match(html, /Ask to rename/);
  assert.match(html, /Inspect a worksheet/);
  assert.match(html, /Convert another PDF/);
  assert.match(html, /autoResize:\s*true/);
  assert.match(html, /onhostcontextchanged/);
  assert.match(html, /theme\s*===\s*"dark"/);
  assert.match(html, /@media\(max-width:/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /focus-visible/);
  assert.equal(/window\.open|target="_blank"|contenteditable/iu.test(html), false);
  assert.equal(/<script[^>]+src=/iu.test(html), false);
  assert.match(html, /document\.createElement\("caption"\)/);
  assert.match(html, /document\.createElement\(rowIndex===0\?"th":"td"\)/);
  assert.match(html, /setAttribute\("scope","col"\)/);
  assert.match(html, /setAttribute\("aria-describedby",summary\.id\)/);
  assert.match(html, /Worksheet \$\{preview\.worksheet\} was extracted from page/);
});

test("conversion result has a complete human-readable and structured fallback", () => {
  const result = buildConversionToolResult({
    pages: 2,
    tables: 1,
    previews: [{ page: 2, table: 1, worksheet: "Page 2 Table 1", rows: 3, columns: 2, preview: [["Item", "Price"], ["Rose", "25"]] }],
  }, "prices.xlsx", "http://127.0.0.1:8788/downloads/test/prices.xlsx");
  assert.deepEqual(result.structuredContent.previews[0].preview[1], ["Rose", "25"]);
  assert.equal(result.structuredContent.expires_in_seconds, 900);
  assert.match(result.content[0].text, /prices\.xlsx/);
  assert.match(result.content[0].text, /Page 2 Table 1/);
  assert.match(result.content[0].text, /Sample rows \(up to 3 rows and 6 columns per worksheet\)/);
  assert.match(result.content[0].text, /Item \| Price \/ Rose \| 25/);
  assert.match(result.content[0].text, /rename the workbook, inspect a worksheet preview or convert another uploaded PDF/);
});

test("rejects a final download URL outside the configured service origin", () => {
  assert.throws(() => buildConversionToolResult({ pages: 1, tables: 1, previews: [] }, "x.xlsx", "https://attacker.example/downloads/x/x.xlsx"), /outside the configured public service origin/);
});

test("inlined result widget module script is syntactically valid", () => {
  const html = loadWidget("../widgets/result-preview.html");
  const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/gu)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new Function(`return (async()=>{${scripts[0][1]}\n})`));
});

test("serves exact OpenAI domain challenge token when configured", async (context) => {
  process.env.OPENAI_APPS_CHALLENGE = "test_challenge_12345";
  const server = createHttpServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  context.after(() => {
    delete process.env.OPENAI_APPS_CHALLENGE;
    return new Promise(resolve => server.close(resolve));
  });
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/.well-known/openai-apps-challenge`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "test_challenge_12345");
});

test("rejects unapproved Host headers", async (context) => {
  const server = createHttpServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: "/health", headers: { host: "attacker.example" } }, response => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 421);
});

test("periodically removes expired workbook bytes without another request", () => {
  const script = `
    import { storeDownload, temporaryDownloadCount } from './src/server.mjs';
    storeDownload(Buffer.from('workbook'), 'test.xlsx');
    await new Promise(resolve => setTimeout(resolve, 100));
    if (temporaryDownloadCount() !== 0) process.exit(2);
  `;
  execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, DOWNLOAD_TTL_MS: "20" },
  });
});
