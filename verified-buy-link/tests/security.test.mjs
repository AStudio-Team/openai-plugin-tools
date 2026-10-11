import assert from "node:assert/strict";
import test from "node:test";
import { isPublicAddress, normalizeProductUrl, resolvePublicHost, robotsAllows, safeFetchText, validateSourceRight } from "../src/security.mjs";

test("normalizes IDNs, strips tracking and fragments, and sorts query keys", () => {
  const value = normalizeProductUrl("https://BÜCHER.example//product/x?utm_source=a&size=2&color=red#buy", { production: true });
  assert.equal(value, "https://xn--bcher-kva.example/product/x?color=red&size=2");
});

test("rejects credentials, unsafe schemes and production ports", () => {
  assert.throws(() => normalizeProductUrl("https://user:pass@example.com/p", { production: true }), /credentials/);
  assert.throws(() => normalizeProductUrl("file:///etc/passwd", { production: true }), /HTTPS/);
  assert.throws(() => normalizeProductUrl("https://example.com:8443/p", { production: true }), /port/);
  assert.throws(() => normalizeProductUrl("http://example.com/p", { production: true }), /HTTPS/);
});

test("blocks private, local, metadata, multicast and reserved addresses", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "224.0.0.1", "0.0.0.0", "::1", "fe80::1", "fc00::1"]) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress("93.184.216.34"), true);
  assert.equal(isPublicAddress("2606:2800:220:1:248:1893:25c8:1946"), true);
});

test("fails DNS resolution when any answer is private", async () => {
  const resolver = async () => [{ address: "93.184.216.34" }, { address: "127.0.0.1" }];
  await assert.rejects(resolvePublicHost("example.com", resolver), /blocked/);
});

test("robots honors the longest matching rule and named user agent", () => {
  const robots = "User-agent: *\nDisallow: /products\nAllow: /products/public\nUser-agent: VerifiedBuyLink\nDisallow: /private\n";
  assert.equal(robotsAllows(robots, "https://example.com/products/public/item"), true);
  assert.equal(robotsAllows(robots, "https://example.com/private/item"), false);
});

test("source rights require exact domain, approval, owner and current review", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  const entry = { domain: "shop.example", automated_retrieval_allowed: true, access_basis: "Reviewed public page access", terms_url: "https://shop.example/terms", reviewed_at: "2026-10-01T00:00:00Z", owner: "Legal", permitted_fields: ["listing"], caching_and_retention: "30 minutes", attribution_requirement: "link", geographic_restrictions: "none", rate_limit: "10 per 10 minutes" };
  assert.equal(validateSourceRight(entry, "shop.example", now), true);
  assert.equal(validateSourceRight({ ...entry, reviewed_at: "2026-01-01T00:00:00Z" }, "shop.example", now), false);
  assert.equal(validateSourceRight(entry, "other.example", now), false);
});

test("safe fetch validates redirect destinations and caps decoded body", async () => {
  const resolver = async () => [{ address: "93.184.216.34" }];
  let calls = 0;
  const redirecting = async () => {
    calls += 1;
    return new Response("", { status: 302, headers: { location: "https://other.example/product" } });
  };
  await assert.rejects(safeFetchText("https://shop.example/product", { production: true, resolver, fetchImpl: redirecting, dispatcherFactory: () => ({}), allowRedirect: (from, to) => new URL(from).hostname === new URL(to).hostname }), /not approved/);
  assert.equal(calls, 1);
  const oversized = async () => new Response("x".repeat(101), { status: 200, headers: { "content-type": "text/html" } });
  await assert.rejects(safeFetchText("https://shop.example/product", { production: true, resolver, fetchImpl: oversized, dispatcherFactory: () => ({}), limits: { responseBytes: 100 } }), /size limit/);
});