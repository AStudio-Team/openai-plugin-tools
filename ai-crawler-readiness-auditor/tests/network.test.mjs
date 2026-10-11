import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { normalizePublicHttpsUrl, isGloballyRoutable, safeRequest, redactUrl } from "../src/network.mjs";

function response(status, headers = {}, body = "") { const stream = Readable.from([Buffer.from(body)]); stream.statusCode = status; stream.headers = headers; stream.resume = () => {}; stream.destroy = () => {}; return stream; }
const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

test("URL policy rejects unsafe target shapes", () => {
  for (const [url, code] of [
    ["http://example.com", "HTTPS_REQUIRED"], ["https://user@example.com", "USERINFO_NOT_ALLOWED"],
    ["https://example.com:8443", "PORT_NOT_ALLOWED"], ["https://127.0.0.1/admin", "PRIVATE_DESTINATION"],
    ["https://[::1]/", "PRIVATE_DESTINATION"], ["https://example.com/#x", "INVALID_URL"],
    ["https://example.com\\@evil.test/", "INVALID_URL"], ["https://example.com%2f.evil.test/", "INVALID_URL"],
  ]) assert.throws(() => normalizePublicHttpsUrl(url), error => error.code === code, url);
});

test("global address policy rejects private, reserved, mapped, documentation, and special ranges", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.1.1", "100.64.0.1", "192.0.2.1", "224.0.0.1", "0.0.0.0", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "2001:db8::1"]) assert.equal(isGloballyRoutable(address), false, address);
  assert.equal(isGloballyRoutable("93.184.216.34"), true);
  assert.equal(isGloballyRoutable("2606:4700:4700::1111"), true);
});

test("all DNS answers must be globally routable", async () => {
  await assert.rejects(() => safeRequest("https://example.com", { resolver: async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }], requestImpl: async () => { throw new Error("must not connect"); } }), error => error.code === "PRIVATE_DESTINATION");
});

test("safe request independently validates redirects and rejects private redirect", async () => {
  let calls = 0;
  await assert.rejects(() => safeRequest("https://example.com/start", {
    resolver: async host => host === "example.com" ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }],
    requestImpl: async () => { calls += 1; return { response: response(302, { location: "https://private.example/admin" }) }; },
  }), error => error.code === "PRIVATE_DESTINATION");
  assert.equal(calls, 1);
});

test("safe request rejects HTTPS downgrade, redirect loop, and request-budget excess", async () => {
  const redirect = location => async () => ({ response: response(302, { location }) });
  await assert.rejects(() => safeRequest("https://example.com", { resolver: publicResolver, requestImpl: redirect("http://example.com") }), error => error.code === "UNSAFE_REDIRECT");
  await assert.rejects(() => safeRequest("https://example.com/a", { resolver: publicResolver, requestImpl: redirect("/a"), maxRedirects: 5 }), error => error.code === "TOO_MANY_REDIRECTS");
  await assert.rejects(() => safeRequest("https://example.com/a", { resolver: publicResolver, requestImpl: redirect("/b"), maximumRequests: 1 }), error => error.code === "REQUEST_BUDGET_EXCEEDED");
});

test("body limits apply after gzip decompression and unsafe content types are rejected", async () => {
  const large = "x".repeat(100);
  await assert.rejects(() => safeRequest("https://example.com", { resolver: publicResolver, maxBytes: 20, requestImpl: async () => ({ response: response(200, { "content-type": "text/plain" }, large) }) }), error => error.code === "BODY_TOO_LARGE");
  await assert.rejects(() => safeRequest("https://example.com", { resolver: publicResolver, requestImpl: async () => ({ response: response(200, { "content-type": "application/zip" }, "PK") }) }), error => error.code === "UNSUPPORTED_CONTENT_TYPE");
});

test("query values are redacted from display URLs", () => {
  const value = redactUrl("https://example.com/page?token=abc&x=2");
  assert.ok(!value.includes("abc")); assert.ok(!value.includes("x=2")); assert.equal(new URL(value).searchParams.get("token"), "[redacted]");
});
