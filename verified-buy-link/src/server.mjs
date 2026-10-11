#!/usr/bin/env node
import http from "node:http";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { ASSESSMENT_NOTICE, recheckCandidate, researchOptions } from "./research.mjs";
import { normalizeProductUrl } from "./security.mjs";
import { EncryptedReportStore } from "./store.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT || 8790);
const MAX_BODY_BYTES = 256 * 1024;
const ALLOWED_HOSTS = new Set((process.env.ALLOWED_HOSTS || "127.0.0.1,localhost,www.astudio.agency,astudio.agency").split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
const INTAKE_URI = "ui://verified-buy-link/intake-v1.html";
const COMPARISON_URI = "ui://verified-buy-link/comparison-v1.html";
const store = new EncryptedReportStore();

function loadRights() {
  const file = process.env.SOURCE_RIGHTS_FILE || path.join(ROOT, "source-rights-register.json");
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(data.sources) ? data.sources : [];
  } catch {
    return [];
  }
}

const require = createRequire(import.meta.url);
const browserBundle = readFileSync(require.resolve("@modelcontextprotocol/ext-apps/app-with-deps"), "utf8")
  .replace(/export\{([^}]+)\};?\s*$/, (_, body) => `globalThis.ExtApps={${body.split(",").map(part => {
    const [local, exported] = part.split(" as ").map(value => value.trim());
    return `${exported || local}:${local}`;
  }).join(",")}};`);
if (/\bexport\s*\{/.test(browserBundle)) throw new Error("MCP Apps browser bundle was not inlined correctly.");
const widget = name => readFileSync(path.join(ROOT, "widgets", name), "utf8").replace("/*__EXT_APPS_BUNDLE__*/", () => browserBundle);
const intakeHtml = widget("intake.html");
const comparisonHtml = widget("comparison.html");

function previewHtml(name) {
  const sample = name === "comparison.html" ? {
    report_id: "11111111-1111-4111-8111-111111111111",
    researched_at: "2026-10-11T12:00:00.000Z",
    expires_at: "2026-10-11T12:30:00.000Z",
    candidates: [
      { candidate_id: "cand_01", retailer: { display_name: "Example Trading", identity_status: "supported" }, listing: { title: "Acme Nova Headphones N7", selected_variant: "Black", price: 499, currency: "AED", normalized_product_url: "https://shop.example/products/nova-n7" }, product_match: { status: "exact" }, purchasability: { status: "verified", control: "add_to_cart", verified_at: "2026-10-11T12:00:00.000Z" }, authorization: { status: "not_proven" }, returns: { window_days: 14 }, risk_flags: [{ message: "Delivery cost remains unknown." }], verdict: "conditional_go", verdict_reasons: [ASSESSMENT_NOTICE], citations: ["src_1_listing"], open_allowed: true },
      { candidate_id: "cand_02", retailer: { display_name: "Unreviewed Shop", identity_status: "unverified" }, listing: { title: "User-supplied product page", selected_variant: "Unverified", price: null, currency: "", normalized_product_url: "https://other.example/item" }, product_match: { status: "unknown" }, purchasability: { status: "uncertain", control: "missing", verified_at: "2026-10-11T12:00:00.000Z" }, authorization: { status: "not_proven" }, returns: {}, risk_flags: [{ message: "Automated access rights are not documented." }], verdict: "unable_to_verify", verdict_reasons: [ASSESSMENT_NOTICE], citations: [], open_allowed: false },
    ],
  } : null;
  const shim = `globalThis.ExtApps={App:class{constructor(){}async connect(){this.ontoolinput?.({arguments:{query:"Acme Nova",supplied_product_url:"https://shop.example/products/nova-n7"}});${sample ? `this.ontoolresult?.({structuredContent:${JSON.stringify(sample)}});` : ""}}getHostContext(){return{theme:new URLSearchParams(location.search).get("theme")||"light",safeAreaInsets:{top:0,right:0,bottom:0,left:0}}}sendMessage(){return Promise.resolve()}callServerTool(){return Promise.reject(new Error("Preview only"))}openLink(){return Promise.resolve()}}};`;
  return readFileSync(path.join(ROOT, "widgets", name), "utf8").replace("/*__EXT_APPS_BUNDLE__*/", shim);
}

const short = z.string().trim().min(1).max(160);
const optionalShort = z.string().trim().min(1).max(160).optional();
const domain = z.string().trim().toLowerCase().regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);
const productUrl = z.string().url().max(2048).superRefine((value, context) => {
  try {
    const normalized = normalizeProductUrl(value);
    if (/\/(?:cart|basket|bag|checkout|login|sign-?in|payment|subscribe)(?:\/|$)/i.test(new URL(normalized).pathname)) context.addIssue({ code: "custom", message: "Only product-detail URLs are accepted." });
  } catch (error) {
    context.addIssue({ code: "custom", message: error.message });
  }
});
const productSchema = z.object({
  brand: short,
  name: short,
  model: optionalShort,
  variant: optionalShort,
  size: z.string().trim().min(1).max(80).optional(),
  identifiers: z.object({ sku: optionalShort, gtin: optionalShort, mpn: optionalShort }).strict().optional(),
}).strict();
const verifySchema = z.object({
  product: productSchema,
  product_urls: z.array(productUrl).min(1).max(5),
  market: z.object({ country_code: z.string().regex(/^[A-Z]{2}$/), currency: z.string().regex(/^[A-Z]{3}$/) }).strict(),
  constraints: z.object({
    maximum_delivered_price: z.number().nonnegative().finite().optional(),
    acceptable_conditions: z.array(z.enum(["new", "used", "refurbished", "tester", "decant", "open_box"])).min(1).max(6),
    substitutions_allowed: z.boolean(),
    authorization_requirement: z.enum(["required", "preferred", "not_required"]),
    maximum_lead_days: z.number().int().min(0).max(365).optional(),
    marketplace_tolerance: z.enum(["retailers_only", "marketplaces_allowed", "marketplaces_preferred"]),
    strict_returns_acceptable: z.boolean(),
    excluded_domains: z.array(domain).max(20).default([]),
  }).strict(),
  confirmation: z.object({ confirmed: z.literal(true), confirmed_at: z.string().datetime({ offset: true }) }).strict(),
}).strict().superRefine((value, context) => {
  const confirmedAt = Date.parse(value.confirmation.confirmed_at);
  const age = Date.now() - confirmedAt;
  if (!Number.isFinite(confirmedAt) || age < -60_000 || age > 10 * 60_000) context.addIssue({ code: "custom", path: ["confirmation", "confirmed_at"], message: "Confirmation must be current. Return to the checkpoint." });
  const unique = new Set(value.product_urls.map(url => normalizeProductUrl(url)));
  if (unique.size !== value.product_urls.length) context.addIssue({ code: "custom", path: ["product_urls"], message: "Duplicate product URLs are not accepted." });
});
const reportOutput = z.object({
  report_id: z.string(), researched_at: z.string(), expires_at: z.string(), product_match: z.record(z.string(), z.unknown()),
  candidates: z.array(z.record(z.string(), z.unknown())), conflicts: z.array(z.record(z.string(), z.unknown())),
  limitations: z.array(z.string()), citation_index: z.array(z.record(z.string(), z.unknown())),
}).passthrough();
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: false };

const ATTRIBUTION = "Provided by ASTUDIO (https://www.astudio.agency).";
function result(structuredContent, summary) {
  return { content: [{ type: "text", text: `${summary || JSON.stringify(structuredContent)}\n\n${ATTRIBUTION}` }], structuredContent };
}

function publicReport(report) {
  const { confirmed_input: _confirmed, ...value } = report;
  return value;
}

function reportSummary(report) {
  const lines = [`Verified Buy Link report ${report.report_id}`, `Researched: ${report.researched_at}`, `Expires: ${report.expires_at}`];
  for (const candidate of report.candidates) {
    const price = Number.isFinite(candidate.listing.price) ? `${candidate.listing.currency} ${candidate.listing.price}` : "price unknown";
    lines.push(`${candidate.candidate_id}: ${candidate.retailer.display_name} | ${candidate.listing.title} | ${price} | ${candidate.verdict.replaceAll("_", " ")} | ${candidate.purchasability.status}`);
    lines.push(`Product page: ${candidate.listing.normalized_product_url}`);
    for (const reason of candidate.verdict_reasons) lines.push(`- ${reason}`);
  }
  lines.push(...report.limitations.map(value => `Limitation: ${value}`));
  return lines.join("\n");
}

export function createPluginServer(options = {}) {
  const rights = options.rights || loadRights();
  const research = options.researchOptions || researchOptions;
  const recheck = options.recheckCandidate || recheckCandidate;
  const reportStore = options.store || store;
  const server = new McpServer({ name: "verified-buy-link", version: "1.0.0" });
  registerAppTool(server, "open_verified_buy_link", {
    title: "Open Verified Buy Link",
    description: "Use this when the user pastes exact product page links and asks to compare, verify or check them before buying (product match, variant, price, delivery country, returns, retailer). Opens the product and market checkpoint; call it first and it fetches nothing. Do not use to find retailers or deals, or to buy.",
    inputSchema: z.object({ query: z.string().max(500).optional(), supplied_product_url: productUrl.optional() }).strict(),
    outputSchema: z.object({ mode: z.literal("intake"), parsed_product: z.record(z.string(), z.unknown()).optional(), disclaimer: z.string() }),
    annotations,
    _meta: { ui: { resourceUri: INTAKE_URI }, "openai/outputTemplate": INTAKE_URI },
  }, async ({ query }) => result({ mode: "intake", parsed_product: query ? { query } : undefined, disclaimer: "Verified Buy Link researches public listings. It does not purchase, reserve, log in, add to cart, or guarantee authenticity or safety." }, "No retailer page has been fetched. In an MCP Apps host, complete the two-step widget. In a text-only host, collect 1 to 5 exact product URLs plus product identity, delivery country, currency, budget, conditions, lead time, marketplace tolerance, authorization requirement, return preference and excluded domains. Restate that scope and wait for explicit confirmation before calling verify_buy_options."));

  server.registerTool("verify_buy_options", {
    title: "Verify supplied product pages",
    description: "Use this after the checkpoint is confirmed, to inspect the 1 to 5 exact product-page URLs the user supplied and report evidence for product match, price, delivery and returns. Fails closed when the retailer domain has no documented access right or robots permission. Do not use to discover retailers.",
    inputSchema: verifySchema,
    outputSchema: reportOutput,
    annotations,
  }, async input => {
    const researched = await research(input, { rights });
    const stored = reportStore.put(researched);
    const visible = publicReport(stored);
    return result(visible, reportSummary(visible));
  });

  registerAppTool(server, "render_buy_comparison", {
    title: "Render buy comparison",
    description: "Use this when verification is complete, to show the evidence comparison with selection, recheck and link controls. Do not use before verify_buy_options.",
    inputSchema: z.object({ report_id: z.string().uuid() }).strict(),
    outputSchema: reportOutput,
    annotations,
    _meta: { ui: { resourceUri: COMPARISON_URI }, "openai/outputTemplate": COMPARISON_URI },
  }, async ({ report_id }) => {
    const report = reportStore.get(report_id);
    if (!report) throw new Error("Report is missing or expired. Start a new checkpoint.");
    const visible = publicReport(report);
    return result(visible, reportSummary(visible));
  });

  server.registerTool("inspect_buy_option", {
    title: "Recheck one buy option",
    description: "Use this when the user selects one candidate in the comparison, to recheck that exact product page immediately. Do not use to click, add to cart or submit anything.",
    inputSchema: z.object({ report_id: z.string().uuid(), candidate_id: z.string().regex(/^cand_\d{2}$/), focus: z.enum(["availability", "authorization", "returns", "delivery", "retailer"]).optional() }).strict(),
    outputSchema: z.object({ candidate: z.record(z.string(), z.unknown()), changes: z.array(z.record(z.string(), z.unknown())), rechecked_at: z.string(), citation: z.record(z.string(), z.unknown()).optional() }),
    annotations,
    _meta: { ui: { visibility: ["app"] } },
  }, async ({ report_id, candidate_id }) => {
    const report = reportStore.get(report_id);
    if (!report) throw new Error("Report is missing or expired. Start a new checkpoint.");
    const checked = await recheck(report, candidate_id, { rights });
    const index = report.candidates.findIndex(candidate => candidate.candidate_id === candidate_id);
    report.candidates[index] = checked.candidate;
    if (checked.citation) report.citation_index = [...report.citation_index.filter(item => item.citation_id !== checked.citation.citation_id), checked.citation];
    reportStore.update(report_id, report);
    return result(checked, `${candidate_id} rechecked at ${checked.rechecked_at}. ${checked.changes.length} tracked fact(s) changed. ${ASSESSMENT_NOTICE}`);
  });

  server.registerTool("refresh_buy_options", {
    title: "Refresh confirmed buy options",
    description: "Use this when the user asks to re-run an existing report with the same confirmed URLs and constraints. Do not use for a changed product or market; that needs a new checkpoint.",
    inputSchema: z.object({ report_id: z.string().uuid() }).strict(),
    outputSchema: reportOutput,
    annotations,
  }, async ({ report_id }) => {
    const existing = reportStore.get(report_id);
    if (!existing) throw new Error("Report is missing or expired. Start a new checkpoint.");
    const refreshed = await research(existing.confirmed_input, { rights });
    refreshed.report_id = report_id;
    const stored = reportStore.update(report_id, refreshed);
    const visible = publicReport(stored);
    return result(visible, reportSummary(visible));
  });

  const resourceMeta = { ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] } } };
  registerAppResource(server, "Verified Buy Link intake", INTAKE_URI, { description: "Product and market confirmation checkpoint", _meta: resourceMeta }, async () => ({ contents: [{ uri: INTAKE_URI, mimeType: RESOURCE_MIME_TYPE, text: intakeHtml, _meta: resourceMeta }] }));
  registerAppResource(server, "Verified Buy Link comparison", COMPARISON_URI, { description: "Evidence comparison and human selection", _meta: resourceMeta }, async () => ({ contents: [{ uri: COMPARISON_URI, mimeType: RESOURCE_MIME_TYPE, text: comparisonHtml, _meta: resourceMeta }] }));
  return server;
}

class AbuseLimiter {
  constructor(now = () => Date.now()) { this.now = now; this.key = randomBytes(32); this.keyExpiresAt = this.now() + 15 * 60_000; this.buckets = new Map(); this.concurrent = new Map(); }
  client(value) {
    if (this.keyExpiresAt <= this.now()) { this.key = randomBytes(32); this.keyExpiresAt = this.now() + 15 * 60_000; this.buckets.clear(); this.concurrent.clear(); }
    return createHmac("sha256", this.key).update(String(value || "unknown")).digest("hex").slice(0, 24);
  }
  begin(rawClient, action) {
    const client = this.client(rawClient); const now = this.now(); const isRecheck = action === "inspect_buy_option"; const windowMs = isRecheck ? 60_000 : 10 * 60_000; const limit = isRecheck ? 2 : 10;
    for (const [bucketKey, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(bucketKey);
    const key = `${client}:${isRecheck ? "recheck" : "research"}`; const current = this.buckets.get(key);
    if (!current || current.resetAt <= now) this.buckets.set(key, { count: 1, resetAt: now + windowMs });
    else if (current.count >= limit) return { allowed: false, retryAfter: Math.ceil((current.resetAt - now) / 1000) };
    else current.count += 1;
    if (!isRecheck) { const active = this.concurrent.get(client) || 0; if (active >= 2) return { allowed: false, retryAfter: 5 }; this.concurrent.set(client, active + 1); }
    return { allowed: true, release: () => { if (!isRecheck) this.concurrent.set(client, Math.max(0, (this.concurrent.get(client) || 1) - 1)); } };
  }
}
const limiter = new AbuseLimiter();

function hostAllowed(req) { return ALLOWED_HOSTS.has(String(req.headers.host || "").split(":")[0].toLowerCase()); }
async function readJsonBody(req) {
  const declared = Number(req.headers["content-length"] || 0); if (declared > MAX_BODY_BYTES) throw Object.assign(new Error("Request body exceeds the limit."), { statusCode: 413 });
  const chunks = []; let total = 0; for await (const chunk of req) { total += chunk.length; if (total > MAX_BODY_BYTES) throw Object.assign(new Error("Request body exceeds the limit."), { statusCode: 413 }); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new Error("Invalid JSON request body."), { statusCode: 400 }); }
}
function sendFile(res, file, type) { const body = readFileSync(path.join(ROOT, "public", file)); res.writeHead(200, { "content-type": type, "content-length": body.length, "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" }).end(body); }

export function createHttpServer() {
  return http.createServer(async (req, res) => {
    if (!req.url || !hostAllowed(req)) return res.writeHead(421).end("Misdirected Request");
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (req.method === "GET" && ["/health", "/ready"].includes(url.pathname)) return res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ status: "ok", service: "verified-buy-link", version: "1.0.0", persistence: "encrypted-memory-30-minutes", source_model: "exact-user-supplied-urls" }));
    const pages = { "/": ["index.html", "text/html; charset=utf-8"], "/privacy": ["privacy.html", "text/html; charset=utf-8"], "/terms": ["terms.html", "text/html; charset=utf-8"], "/support": ["support.html", "text/html; charset=utf-8"], "/source-rights": ["source-rights.html", "text/html; charset=utf-8"], "/assets/site.css": ["assets/site.css", "text/css; charset=utf-8"] };
    if (req.method === "GET" && pages[url.pathname]) return sendFile(res, ...pages[url.pathname]);
    if (process.env.NODE_ENV !== "production" && req.method === "GET" && ["/preview/intake", "/preview/comparison"].includes(url.pathname)) return res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(previewHtml(url.pathname.endsWith("intake") ? "intake.html" : "comparison.html"));
    if (req.method === "OPTIONS" && url.pathname === "/mcp") return res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-expose-headers": "Mcp-Session-Id" }).end();
    if (url.pathname === "/mcp" && ["GET", "DELETE"].includes(req.method || "")) return res.writeHead(405, { allow: "POST, OPTIONS" }).end("Method Not Allowed");
    if (url.pathname === "/mcp" && req.method === "POST") {
      let gate;
      const server = createPluginServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => { transport.close(); server.close(); gate?.release?.(); });
      try {
        const body = await readJsonBody(req); const action = body?.params?.name;
        if (["verify_buy_options", "refresh_buy_options", "inspect_buy_option"].includes(action)) { gate = limiter.begin(req.headers["x-plugin-client-ip"] || req.socket.remoteAddress, action); if (!gate.allowed) return res.writeHead(429, { "content-type": "application/json", "retry-after": String(gate.retryAfter), "cache-control": "no-store" }).end(JSON.stringify({ error: "Rate limit exceeded." })); }
        res.setHeader("access-control-allow-origin", "*"); res.setHeader("access-control-expose-headers", "Mcp-Session-Id"); res.setHeader("cache-control", "no-store");
        await server.connect(transport); await transport.handleRequest(req, res, body);
        console.log(JSON.stringify({ action: action || body?.method || "mcp", status: res.statusCode < 400 ? "completed" : "rejected" }));
      } catch (error) { console.log(JSON.stringify({ action: "mcp", status: "rejected" })); if (!res.headersSent) res.writeHead(error.statusCode || 500, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ error: error.statusCode ? error.message : "Internal server error" })); }
      return;
    }
    res.writeHead(404, { "cache-control": "no-store" }).end("Not Found");
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) createHttpServer().listen(PORT, "0.0.0.0", () => console.log(JSON.stringify({ action: "service", status: "started", port: PORT })));