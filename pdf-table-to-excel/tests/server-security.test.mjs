import http from "node:http";
import { execFileSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { consumeRateLimit, createHttpServer, downloadPdf } from "../src/server.mjs";

test("rejects private and non-HTTPS download URLs", async () => {
  await assert.rejects(() => downloadPdf("http://example.com/file.pdf"), /HTTPS/);
  await assert.rejects(() => downloadPdf("https://127.0.0.1/file.pdf"), /not publicly reachable/);
  await assert.rejects(() => downloadPdf("https://[::1]/file.pdf"), /not publicly reachable/);
  await assert.rejects(() => downloadPdf("https://[::ffff:127.0.0.1]/file.pdf"), /not publicly reachable/);
  await assert.rejects(() => downloadPdf("https://192.0.2.1/file.pdf"), /not publicly reachable/);
  await assert.rejects(() => downloadPdf("https://224.0.0.1/file.pdf"), /not publicly reachable/);
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
