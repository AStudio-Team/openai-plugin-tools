import { randomUUID } from "node:crypto";
import { normalizeProductUrl, robotsAllows, robotsUrlFor, safeFetchText, validateSourceRight } from "./security.mjs";

export const ASSESSMENT_NOTICE = "This is an evidence-based research assessment, not a guarantee of retailer conduct, product authenticity, inventory, delivery, or transaction safety.";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeEntities(value) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const radix = entity[1]?.toLowerCase() === "x" ? 16 : 10;
      const number = Number.parseInt(entity.replace(/^#x?/i, ""), radix);
      return Number.isFinite(number) && number >= 32 ? String.fromCodePoint(number) : " ";
    }
    return entities[entity.toLowerCase()] || match;
  });
}

function visibleText(html) {
  return clean(decodeEntities(String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " "))).slice(0, 500_000);
}

function metaContent(html, key, attribute = "property") {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+${attribute}=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attribute}=["']${escaped}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = String(html).match(pattern);
    if (match) return clean(decodeEntities(match[1]));
  }
  return "";
}

function parseJsonLd(html) {
  const values = [];
  for (const match of String(html).matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      values.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      continue;
    }
  }
  const flattened = [];
  const walk = value => {
    if (!value || typeof value !== "object") return;
    flattened.push(value);
    if (Array.isArray(value["@graph"])) value["@graph"].forEach(walk);
  };
  values.forEach(walk);
  return flattened;
}

function firstProduct(nodes) {
  return nodes.find(node => {
    const type = node["@type"];
    return type === "Product" || (Array.isArray(type) && type.includes("Product"));
  }) || {};
}

function offerFrom(product) {
  const offers = Array.isArray(product.offers) ? product.offers : product.offers ? [product.offers] : [];
  return offers.find(offer => offer && typeof offer === "object") || {};
}

function purchaseControl(html) {
  const controls = [];
  for (const match of String(html).matchAll(/<(button|a)\b([^>]*)>([\s\S]{0,500}?)<\/\1>/gi)) controls.push({ attributes: match[2], label: visibleText(match[3]) });
  for (const match of String(html).matchAll(/<input\b([^>]*)>/gi)) controls.push({ attributes: match[1], label: match[1].match(/\bvalue=["']([^"']+)["']/i)?.[1] || "" });
  for (const control of controls) {
    const label = clean(control.label).toLowerCase();
    const disabled = /\bdisabled\b|\baria-disabled=["']?true\b|\bclass=["'][^"']*\bdisabled\b/i.test(control.attributes);
    if (/\bnotify me\b/.test(label)) return { status: "not_purchasable", control: "notify_me" };
    if (/\b(sold out|out of stock)\b/.test(label)) return { status: "not_purchasable", control: "disabled" };
    if (/\badd to (?:cart|bag|basket)\b/.test(label)) return disabled ? { status: "not_purchasable", control: "disabled" } : { status: "verified", control: "add_to_cart" };
    if (/\bbuy now\b/.test(label)) return disabled ? { status: "not_purchasable", control: "disabled" } : { status: "verified", control: "buy_now" };
  }
  return { status: "uncertain", control: "missing" };
}

function numberFrom(value) {
  const match = String(value ?? "").replace(/,/g, "").match(/\d+(?:\.\d{1,2})?/);
  return match ? Number(match[0]) : undefined;
}

function normalizedTokens(value) {
  return clean(value).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(token => token.length > 1);
}

function identityMatch(product, extracted) {
  const haystack = `${extracted.title} ${extracted.text} ${Object.values(extracted.identifiers).join(" ")}`.toLowerCase();
  const required = [product.brand, product.name].flatMap(normalizedTokens);
  const optional = [product.model, product.variant, product.size].filter(Boolean).flatMap(normalizedTokens);
  const identifierEntries = Object.entries(product.identifiers || {}).filter(([, value]) => value);
  const missingRequired = required.filter(token => !haystack.includes(token));
  const missingOptional = optional.filter(token => !haystack.includes(token));
  const identifierConflicts = identifierEntries.filter(([, value]) => !haystack.includes(String(value).toLowerCase()));
  const matched = [];
  if (!missingRequired.length) matched.push("brand", "name");
  if (optional.length && !missingOptional.length) matched.push("model_or_variant");
  if (identifierEntries.length && !identifierConflicts.length) matched.push("identifier");
  if (missingRequired.length || identifierConflicts.length) {
    return { status: "mismatch", matched_fields: matched, conflicts: [...missingRequired.map(value => `Missing product token: ${value}`), ...identifierConflicts.map(([key]) => `Supplied ${key} not found on page.`)] };
  }
  if (missingOptional.length) return { status: "probable", matched_fields: matched, conflicts: missingOptional.map(value => `Variant token not found: ${value}`) };
  return { status: "exact", matched_fields: matched, conflicts: [] };
}

export function extractListing(html, productUrl) {
  const nodes = parseJsonLd(html);
  const product = firstProduct(nodes);
  const offer = offerFrom(product);
  const text = visibleText(html);
  const title = clean(product.name || metaContent(html, "og:title") || String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || new URL(productUrl).hostname);
  const purchasability = purchaseControl(html);
  const identifiers = {};
  for (const key of ["sku", "gtin", "gtin8", "gtin12", "gtin13", "gtin14", "mpn", "isbn"]) if (product[key]) identifiers[key] = clean(product[key]);
  const seller = typeof offer.seller === "object" ? clean(offer.seller.name) : clean(offer.seller);
  const returnWindow = text.match(/(?:return|refund)[^.!?]{0,80}?\b(\d{1,3})\s*days?\b/i)?.[1];
  const unopened = /(?:unopened|unused|original packaging)[^.!?]{0,100}(?:return|refund)|(?:return|refund)[^.!?]{0,100}(?:unopened|unused|original packaging)/i.test(text);
  return {
    title,
    text,
    productPageEvidence: Object.keys(product).length > 0 || metaContent(html, "og:type").toLowerCase() === "product",
    selectedVariant: clean(product.size || product.color || product.model || "Not stated"),
    identifiers,
    condition: clean(offer.itemCondition || product.itemCondition || "not stated").replace(/^https?:\/\/schema.org\//i, ""),
    price: numberFrom(offer.price ?? offer.lowPrice ?? metaContent(html, "product:price:amount")),
    currency: clean(offer.priceCurrency || metaContent(html, "product:price:currency")).toUpperCase(),
    seller,
    organization: clean(nodes.find(node => ["Organization", "LocalBusiness", "Store"].includes(node["@type"]))?.name),
    purchasability,
    returns: {
      window_days: returnWindow ? Number(returnWindow) : undefined,
      unopened_only: unopened || undefined,
      unknowns: returnWindow ? [] : ["Return window was not stated on the supplied product page."],
    },
  };
}

function conditionMatches(acceptable, listingCondition) {
  if (!acceptable?.length) return false;
  const condition = String(listingCondition).toLowerCase().replace(/[^a-z]/g, "");
  return acceptable.some(value => condition.includes(value.replace(/_/g, "")));
}

function unavailableCandidate(url, index, reason, at) {
  const domain = new URL(url).hostname;
  return {
    candidate_id: `cand_${String(index + 1).padStart(2, "0")}`,
    retailer: { display_name: domain, normalized_domain: domain, identity_status: "unverified" },
    listing: { normalized_product_url: url, title: "User-supplied product page", selected_variant: "Unverified", identifiers: {}, condition: "unverified", price: null, currency: "", delivery_cost: null },
    product_match: { status: "unknown", matched_fields: [], conflicts: [reason] },
    purchasability: { status: "uncertain", control: "missing", selected_variant_verified: false, verified_at: at },
    authorization: { status: "not_proven", target_brand_evidence: [] },
    returns: { unknowns: ["Unable to inspect return terms on the supplied page."] },
    risk_flags: [{ severity: "material", code: "coverage_gap", message: reason }],
    verdict: "unable_to_verify",
    verdict_reasons: [reason, ASSESSMENT_NOTICE],
    citations: [],
    open_allowed: false,
  };
}

export function rankCandidates(candidates) {
  const score = candidate => {
    const match = { exact: 4, probable: 2, mismatch: 0, unknown: 0 }[candidate.product_match.status] || 0;
    const buy = candidate.purchasability.status === "verified" ? 3 : candidate.purchasability.status === "not_purchasable" ? 0 : 1;
    const verdict = { go: 3, conditional_go: 2, no_go: 0, unable_to_verify: 0 }[candidate.verdict] || 0;
    const identity = candidate.retailer.identity_status === "supported" ? 2 : 0;
    const auth = candidate.authorization.status === "brand_confirmed" ? 2 : candidate.authorization.status === "circumstantial" ? 1 : 0;
    const price = Number.isFinite(candidate.listing.price) ? candidate.listing.price : Number.MAX_SAFE_INTEGER;
    return { quality: match * 100 + buy * 20 + verdict * 10 + identity * 3 + auth, price };
  };
  return [...candidates].sort((a, b) => score(b).quality - score(a).quality || score(a).price - score(b).price || a.candidate_id.localeCompare(b.candidate_id));
}

export async function researchOne({ url, index, input, rights, fetchText = safeFetchText, now = () => new Date(), deadlineAt = Date.now() + 60_000 }) {
  const at = now().toISOString();
  let normalized;
  try {
    normalized = normalizeProductUrl(url);
  } catch (error) {
    return unavailableCandidate(normalizeProductUrl(url, { production: false }), index, error.message, at);
  }
  const domain = new URL(normalized).hostname;
  if ((input.constraints.excluded_domains || []).map(value => value.toLowerCase()).includes(domain)) return unavailableCandidate(normalized, index, "Retailer domain is excluded by the confirmed constraints.", at);
  const right = rights.find(entry => entry.domain === domain);
  if (!validateSourceRight(right, domain, now())) return unavailableCandidate(normalized, index, "Automated access rights for this domain are not currently documented. The page was not fetched.", at);
  const sameHostRedirect = (from, to) => new URL(from).hostname === new URL(to).hostname;
  try {
    const remaining = () => {
      const value = deadlineAt - Date.now();
      if (value <= 0) throw new Error("The 60-second research deadline was reached.");
      return Math.min(12_000, value);
    };
    const robots = await fetchText(robotsUrlFor(normalized), { allowRedirect: sameHostRedirect, limits: { totalMs: remaining() } });
    if (!robotsAllows(robots.text, normalized)) return unavailableCandidate(normalized, index, "The site's robots policy does not permit this product-page retrieval.", at);
    const page = await fetchText(normalized, { allowRedirect: sameHostRedirect, limits: { totalMs: remaining() } });
    if (/(?:captcha|verify you are human|sign in to continue|log in to continue)/i.test(page.text)) return unavailableCandidate(normalized, index, "The source requires CAPTCHA or login. Retrieval stopped without bypassing it.", at);
    const extracted = extractListing(page.text, page.url);
    const match = identityMatch(input.product, extracted);
    const selectedVariantVerified = match.status === "exact";
    const citationId = `src_${index + 1}_listing`;
    const conflicts = [...match.conflicts];
    const risks = [];
    if (!extracted.price) risks.push({ severity: "material", code: "price_unknown", message: "A current item price could not be extracted." });
    if (!extracted.productPageEvidence) risks.push({ severity: "material", code: "product_page_unproven", message: "The retrieved URL did not expose product-page metadata." });
    if (extracted.currency && extracted.currency !== input.market.currency) risks.push({ severity: "material", code: "currency_mismatch", message: `Page currency ${extracted.currency} differs from confirmed currency ${input.market.currency}.` });
    if (Number.isFinite(input.constraints.maximum_delivered_price) && Number.isFinite(extracted.price) && extracted.price > input.constraints.maximum_delivered_price) risks.push({ severity: "material", code: "budget_exceeded", message: "Item price alone exceeds the confirmed maximum delivered price." });
    if (Number.isFinite(input.constraints.maximum_delivered_price)) risks.push({ severity: "material", code: "delivered_total_unknown", message: "Delivery cost was not stated on the supplied page, so the maximum delivered price cannot be confirmed." });
    if (Number.isFinite(input.constraints.maximum_lead_days)) risks.push({ severity: "material", code: "lead_time_unknown", message: "Delivery lead time was not stated on the supplied page." });
    if (!conditionMatches(input.constraints.acceptable_conditions, extracted.condition)) risks.push({ severity: "material", code: "condition_uncertain", message: "The stated item condition could not be confirmed as acceptable." });
    if (!input.constraints.strict_returns_acceptable && extracted.returns.unopened_only) risks.push({ severity: "material", code: "strict_returns_conflict", message: "The extracted unopened or unused return restriction conflicts with the confirmed return preference." });
    if (extracted.purchasability.status !== "verified") risks.push({ severity: "material", code: "purchase_control_unverified", message: "An enabled purchase control for the selected variant was not verified." });
    if (match.status !== "exact") risks.push({ severity: "material", code: "identity_conflict", message: "Exact product and variant identity was not fully matched." });
    const retailerName = extracted.seller || extracted.organization || domain;
    const identityStatus = extracted.seller || extracted.organization ? "supported" : "unverified";
    if (input.constraints.authorization_requirement === "required") risks.push({ severity: "material", code: "authorization_required", message: "Target-brand authorization was required but could not be independently proven from the supplied product page." });
    const severe = match.status === "mismatch" || extracted.purchasability.status === "not_purchasable" || input.constraints.authorization_requirement === "required";
    let verdict = "conditional_go";
    if (severe) verdict = "no_go";
    else if (match.status !== "exact" || extracted.purchasability.status !== "verified" || risks.length) verdict = "conditional_go";
    else verdict = "go";
    const reasons = [
      match.status === "exact" ? "Supplied identity fields match the listing evidence." : "Product identity has unresolved conflicts.",
      extracted.purchasability.status === "verified" ? "A visible purchase control was present during this retrieval." : "Current purchasability was not verified.",
      "Target-brand authorization was not independently proven because version 1 inspects only the supplied product page.",
      ASSESSMENT_NOTICE,
    ];
    const citation = {
      citation_id: citationId,
      url: page.url,
      page_title: extracted.title,
      publisher: domain,
      source_type: "retailer_listing",
      retrieved_at: at,
      evidence_strength: "direct_page",
      extractor: "typed-html-jsonld-v1",
      fields_supported: ["listing.title", "listing.price", "listing.currency", "listing.identifiers", "purchasability.control", "returns"],
      conflict_status: conflicts.length ? "conflicting" : "none",
    };
    return {
      candidate: {
        candidate_id: `cand_${String(index + 1).padStart(2, "0")}`,
        retailer: { display_name: retailerName, normalized_domain: domain, identity_status: identityStatus },
        listing: {
          normalized_product_url: page.url,
          title: extracted.title,
          selected_variant: extracted.selectedVariant,
          identifiers: extracted.identifiers,
          condition: extracted.condition,
          price: extracted.price ?? null,
          currency: extracted.currency,
          delivery_cost: null,
        },
        product_match: match,
        purchasability: { ...extracted.purchasability, selected_variant_verified: selectedVariantVerified, verified_at: at },
        authorization: { status: "not_proven", target_brand_evidence: [] },
        returns: extracted.returns,
        risk_flags: risks,
        verdict,
        verdict_reasons: reasons,
        citations: [citationId],
        open_allowed: (verdict === "go" || verdict === "conditional_go") && extracted.productPageEvidence && match.status === "exact" && extracted.purchasability.status === "verified",
      },
      citation,
    };
  } catch (error) {
    const reason = /captcha|login/i.test(error.message) ? "The source requires CAPTCHA or login. Retrieval stopped without bypassing it." : `The page could not be safely inspected: ${error.message}`;
    return unavailableCandidate(normalized, index, reason, at);
  }
}

export async function researchOptions(input, options = {}) {
  const now = options.now || (() => new Date());
  const deadlineAt = Date.now() + 60_000;
  const results = [];
  for (let index = 0; index < input.product_urls.length; index += 1) {
    results.push(await researchOne({ url: input.product_urls[index], index, input, rights: options.rights || [], fetchText: options.fetchText, now, deadlineAt }));
  }
  const candidates = rankCandidates(results.map(result => result.candidate || result));
  const citations = results.flatMap(result => result.citation ? [result.citation] : []);
  const productMatches = candidates.map(candidate => candidate.product_match.status);
  return {
    report_id: randomUUID(),
    researched_at: now().toISOString(),
    product_match: {
      status: productMatches.includes("exact") ? "exact" : productMatches.includes("probable") ? "probable" : productMatches.includes("mismatch") ? "mismatch" : "unknown",
      requested: input.product,
    },
    candidates,
    conflicts: candidates.flatMap(candidate => candidate.product_match.conflicts.map(message => ({ candidate_id: candidate.candidate_id, message }))),
    limitations: [
      "Only the exact user-supplied product pages were considered. No retailer discovery, review corpus, registry, or arbitrary search was used.",
      "Authorization and retailer identity may remain unproven when the supplied page lacks direct evidence.",
      "Delivery cost is unknown unless shown directly on the supplied page.",
      ASSESSMENT_NOTICE,
    ],
    citation_index: citations,
    confirmed_input: input,
  };
}

export async function recheckCandidate(report, candidateId, options = {}) {
  const candidate = report.candidates.find(item => item.candidate_id === candidateId);
  if (!candidate) throw new Error("Candidate was not found in this report.");
  const originalIndex = report.confirmed_input.product_urls.findIndex(url => new URL(normalizeProductUrl(url)).hostname === candidate.retailer.normalized_domain);
  const result = await researchOne({
    url: candidate.listing.normalized_product_url,
    index: originalIndex < 0 ? 0 : originalIndex,
    input: report.confirmed_input,
    rights: options.rights || [],
    fetchText: options.fetchText,
    now: options.now || (() => new Date()),
  });
  const updated = result.candidate || result;
  updated.candidate_id = candidateId;
  const changes = [];
  for (const path of ["verdict", "listing.price", "listing.currency", "purchasability.status", "purchasability.control"]) {
    const parts = path.split(".");
    const read = object => parts.reduce((value, key) => value?.[key], object);
    if (read(candidate) !== read(updated)) changes.push({ field: path, before: read(candidate) ?? null, after: read(updated) ?? null });
  }
  return { candidate: updated, changes, rechecked_at: updated.purchasability.verified_at, citation: result.citation };
}