import assert from "node:assert/strict";
import test from "node:test";
import { extractListing, rankCandidates, recheckCandidate, researchOptions } from "../src/research.mjs";

const NOW = new Date("2026-10-11T12:00:00Z");
const right = { domain: "shop.example", automated_retrieval_allowed: true, access_basis: "Reviewed direct public product access", terms_url: "https://shop.example/terms", reviewed_at: "2026-10-01T00:00:00Z", owner: "Legal", permitted_fields: ["listing"], caching_and_retention: "30 minutes", attribution_requirement: "link", geographic_restrictions: "none", rate_limit: "10 per 10 minutes" };
const input = {
  product: { brand: "Acme", name: "Nova Headphones", model: "N7", variant: "Black", identifiers: { sku: "SKU-77" } },
  product_urls: ["https://shop.example/products/nova-n7"],
  market: { country_code: "AE", currency: "AED" },
  constraints: { maximum_delivered_price: 600, acceptable_conditions: ["new"], substitutions_allowed: false, authorization_requirement: "preferred", maximum_lead_days: 5, marketplace_tolerance: "retailers_only", strict_returns_acceptable: false, excluded_domains: [] },
  confirmation: { confirmed: true, confirmed_at: NOW.toISOString() },
};
const productHtml = `<!doctype html><title>Acme Nova N7 Black</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Acme Nova Headphones N7 Black","sku":"SKU-77","color":"Black","offers":{"@type":"Offer","price":"499.00","priceCurrency":"AED","availability":"https://schema.org/InStock","itemCondition":"https://schema.org/NewCondition","seller":{"@type":"Organization","name":"Example Trading LLC"}}}</script><main><button>Add to cart</button><p>Returns accepted within 14 days if unused in original packaging.</p></main>`;

function permittedFetch(url) {
  if (url.endsWith("/robots.txt")) return Promise.resolve({ url, status: 200, contentType: "text/plain", text: "User-agent: *\nAllow: /" });
  return Promise.resolve({ url, status: 200, contentType: "text/html", text: productHtml });
}

test("extracts typed listing fields and does not treat JSON-LD InStock alone as purchase control", () => {
  const listing = extractListing(productHtml.replace("<button>Add to cart</button>", ""), input.product_urls[0]);
  assert.equal(listing.price, 499);
  assert.equal(listing.currency, "AED");
  assert.equal(listing.identifiers.sku, "SKU-77");
  assert.equal(listing.purchasability.status, "uncertain");
  assert.equal(listing.returns.window_days, 14);
  assert.equal(listing.returns.unopened_only, true);
});

test("disabled add-to-cart control is not treated as purchasable", () => {
  const listing = extractListing(productHtml.replace("<button>Add to cart</button>", "<button disabled>Add to cart</button>"), input.product_urls[0]);
  assert.equal(listing.purchasability.status, "not_purchasable");
  assert.equal(listing.purchasability.control, "disabled");
});

test("missing rights fails closed without any network request", async () => {
  let fetches = 0;
  const report = await researchOptions(input, { rights: [], fetchText: async () => { fetches += 1; throw new Error("must not run"); }, now: () => NOW });
  assert.equal(fetches, 0);
  assert.equal(report.candidates[0].verdict, "unable_to_verify");
  assert.equal(report.candidates[0].open_allowed, false);
  assert.match(report.candidates[0].verdict_reasons[0], /rights/);
});

test("robots prohibition fetches robots only and returns unable to verify", async () => {
  const urls = [];
  const report = await researchOptions(input, { rights: [right], fetchText: async url => { urls.push(url); return { url, text: "User-agent: *\nDisallow: /products" }; }, now: () => NOW });
  assert.equal(urls.length, 1);
  assert.match(urls[0], /robots\.txt$/);
  assert.equal(report.candidates[0].verdict, "unable_to_verify");
});

test("permitted exact page produces a cited current candidate", async () => {
  const report = await researchOptions(input, { rights: [right], fetchText: permittedFetch, now: () => NOW });
  const candidate = report.candidates[0];
  assert.equal(candidate.product_match.status, "exact");
  assert.equal(candidate.purchasability.status, "verified");
  assert.equal(candidate.purchasability.control, "add_to_cart");
  assert.equal(candidate.listing.price, 499);
  assert.equal(candidate.verdict, "conditional_go");
  assert.equal(candidate.authorization.status, "not_proven");
  assert.equal(candidate.citations.length, 1);
  assert.equal(report.citation_index[0].source_type, "retailer_listing");
});

test("identity mismatch and sold-out control produce no-go", async () => {
  const mismatch = productHtml.replaceAll("Acme", "Other").replaceAll("Nova", "Legacy").replace("<button>Add to cart</button>", "<button>Sold out</button>");
  const fetchText = async url => url.endsWith("robots.txt") ? { url, text: "User-agent: *\nAllow: /" } : { url, text: mismatch };
  const report = await researchOptions(input, { rights: [right], fetchText, now: () => NOW });
  assert.equal(report.candidates[0].product_match.status, "mismatch");
  assert.equal(report.candidates[0].purchasability.status, "not_purchasable");
  assert.equal(report.candidates[0].verdict, "no_go");
});

test("login or CAPTCHA wall stops without treating the page as a candidate", async () => {
  const fetchText = async url => url.endsWith("robots.txt") ? { url, text: "User-agent: *\nAllow: /" } : { url, text: "<html><title>Verify you are human</title><div>CAPTCHA</div></html>" };
  const report = await researchOptions(input, { rights: [right], fetchText, now: () => NOW });
  assert.equal(report.candidates[0].verdict, "unable_to_verify");
  assert.equal(report.candidates[0].open_allowed, false);
  assert.match(report.candidates[0].verdict_reasons[0], /CAPTCHA or login/);
});

test("ranking keeps evidence quality ahead of lower price", () => {
  const base = { retailer: { identity_status: "supported", display_name: "A" }, listing: { price: 500 }, product_match: { status: "exact" }, purchasability: { status: "verified" }, authorization: { status: "not_proven" }, verdict: "go", candidate_id: "cand_01" };
  const weakCheap = { ...structuredClone(base), candidate_id: "cand_02", listing: { price: 100 }, product_match: { status: "probable" }, verdict: "conditional_go" };
  assert.equal(rankCandidates([weakCheap, base])[0].candidate_id, "cand_01");
});

test("recheck reports changed price and preserves candidate ID", async () => {
  const report = await researchOptions(input, { rights: [right], fetchText: permittedFetch, now: () => NOW });
  const changed = productHtml.replace("499.00", "529.00");
  const fetchText = async url => url.endsWith("robots.txt") ? { url, text: "User-agent: *\nAllow: /" } : { url, text: changed };
  const checked = await recheckCandidate(report, "cand_01", { rights: [right], fetchText, now: () => new Date("2026-10-11T12:05:00Z") });
  assert.equal(checked.candidate.candidate_id, "cand_01");
  assert.equal(checked.candidate.listing.price, 529);
  assert.ok(checked.changes.some(change => change.field === "listing.price"));
});