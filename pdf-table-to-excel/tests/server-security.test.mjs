import http from "node:http";
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

test("limits repeated MCP requests per client", () => {
  const request = { headers: { "cf-connecting-ip": "198.51.100.42" }, socket: { remoteAddress: "127.0.0.1" } };
  for (let index = 0; index < 10; index += 1) assert.equal(consumeRateLimit(request), true);
  assert.equal(consumeRateLimit(request), false);
});

test("serves health and public landing pages", async (context) => {
  const server = createHttpServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).service, "pdf-table-to-excel");
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
