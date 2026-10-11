#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import { readFileSync, createReadStream, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { CHECK_IDS, REQUEST_BUDGET, VALIDATION_BUDGET, LIMITS, DISCLAIMER } from "./constants.mjs";
import { normalizePublicHttpsUrl, safeRequest, redactUrl, AuditNetworkError } from "./network.mjs";
import { createCheckpoint, verifyCheckpoint } from "./token.mjs";
import { runAudit, auditText } from "./audit.mjs";
const ATTRIBUTION = "Provided by ASTUDIO. For a human ASTUDIO team on this work: https://www.astudio.agency/tools/ai-crawler-readiness-auditor";
function withAttribution(text) { return `${text}\n\n${ATTRIBUTION}`; }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8790);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 128 * 1024);
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_AUDITS || 4);
const ALLOWED_HOSTS = new Set((process.env.ALLOWED_HOSTS || "127.0.0.1,localhost,www.astudio.agency,astudio.agency,fixtures.astudio.agency,ready.fixtures.astudio.agency,robots-blocked.fixtures.astudio.agency,llms-html.fixtures.astudio.agency,invalid-jsonld.fixtures.astudio.agency,sitemap-timeout.fixtures.astudio.agency").split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_CLIENT = Number(process.env.RATE_LIMIT_PER_CLIENT || 20);
const RATE_LIMIT_GLOBAL = Number(process.env.RATE_LIMIT_GLOBAL || 200);
const rateBuckets = new Map();
let activeAudits = 0;
const require = createRequire(import.meta.url);

function browserBundle() {
  const source = readFileSync(require.resolve("@modelcontextprotocol/ext-apps/app-with-deps"), "utf8");
  return source.replace(/export\s*\{([^}]+)\};?\s*$/s, (_all, body) => `globalThis.ExtApps={${body.split(",").map(part => { const [local, exported] = part.trim().split(/\s+as\s+/); return `${exported || local}:${local}`; }).join(",")}};`);
}
function widget(name) { return readFileSync(path.join(ROOT, "widgets", name), "utf8").replace("/*__EXT_APPS_BUNDLE__*/", browserBundle); }
const checkpointHtml = widget("checkpoint.html");
const resultsHtml = widget("results.html");

const checkId = z.enum(CHECK_IDS);
const scopeSchema = z.enum(["page_and_site_controls", "site_controls_only"]);
const inputBase = {
  url: z.string().min(9).max(2048).regex(/^https:\/\//).describe("One public HTTPS webpage URL. Authentication and private-network URLs are not supported."),
  scope: scopeSchema,
  checks: z.array(checkId).min(1).max(9).refine(values => new Set(values).size === values.length, "Checks must be unique."),
};
const errorSchema = z.object({ code: z.string(), field: z.enum(["url", "scope", "checks"]).nullable(), message: z.string() }).strict();
const validationOutput = {
  schemaVersion: z.literal("1.0"), valid: z.boolean(), submittedUrl: z.string(),
  target: z.object({ normalizedUrl: z.string(), displayUrl: z.string(), origin: z.string(), host: z.string(), path: z.string(), scope: scopeSchema, checks: z.array(checkId), redirects: z.array(z.object({ from: z.string(), to: z.string(), status: z.number().int() }).strict()) }).strict().nullable(),
  checkpoint: z.object({ token: z.string(), expiresAt: z.string(), requestBudget: z.object({ maximumRequests: z.number().int(), maximumDownloadedBytes: z.number().int(), maximumDurationMs: z.number().int() }).strict(), limitations: z.array(z.string()) }).strict().nullable(),
  errors: z.array(errorSchema),
};
const evidenceSchema = z.object({ sourceUrl: z.string(), retrievedAt: z.string(), httpStatus: z.number().int().nullable(), contentType: z.string().nullable(), observed: z.string(), expected: z.string(), excerpt: z.string().nullable() }).strict();
const auditOutput = {
  schemaVersion: z.literal("1.0"), auditEngineVersion: z.string(),
  target: z.object({ url: z.string(), displayUrl: z.string(), origin: z.string(), scope: scopeSchema }).strict(), startedAt: z.string(), completedAt: z.string(),
  status: z.enum(["blocking_issues_found", "warnings_only", "no_issues_detected_within_scope", "incomplete"]),
  summary: z.object({ blockers: z.number().int(), warnings: z.number().int(), passed: z.number().int(), notTested: z.number().int(), statement: z.string() }).strict(),
  checks: z.array(z.object({ id: checkId, title: z.string(), category: z.enum(["access", "discovery", "page", "structured_data", "transport"]), outcome: z.enum(["pass", "warn", "block", "not_tested", "error"]), severity: z.enum(["critical", "high", "medium", "low", "info"]), explanation: z.string(), evidence: z.array(evidenceSchema), limitations: z.array(z.string()) }).strict()),
  remediations: z.array(z.object({ id: z.string(), findingIds: z.array(z.string()), priority: z.enum(["p0", "p1", "p2"]), title: z.string(), action: z.string(), verification: z.string() }).strict()),
  requestUsage: z.object({ requestsMade: z.number().int(), downloadedBytes: z.number().int(), durationMs: z.number().int() }).strict(), partial: z.boolean(),
  errors: z.array(z.object({ checkId: checkId.nullable(), code: z.string(), message: z.string(), retryable: z.boolean() }).strict()), disclaimers: z.array(z.string()),
};

function toolMeta(resourceUri, invoking, invoked) {
  return { ui: { resourceUri }, "openai/outputTemplate": resourceUri, "openai/toolInvocation/invoking": invoking, "openai/toolInvocation/invoked": invoked };
}
function appResourceMeta() { return { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [], baseUriDomains: [], frameDomains: [] } } }; }
function validationText(value) {
  if (!value.valid) return `The audit target was not accepted. ${value.errors.map(item => item.message).join(" ")}`;
  const redirect = value.target.redirects.length ? ` Redirects: ${value.target.redirects.map(item => `${item.from} to ${item.to} (${item.status})`).join("; ")}.` : "";
  return `Checkpoint ready for ${value.target.displayUrl}. Scope: ${value.target.scope}. Checks: ${value.target.checks.join(", ")}.${redirect} The checkpoint expires at ${value.checkpoint.expiresAt}. Confirm the exact target and scope before calling run_readiness_audit. Public HTTPS only, no sign-in, no website changes. ${DISCLAIMER}`;
}

export async function validateTarget(input, request = safeRequest) {
  const submittedUrl = String(input.url || "");
  try {
    const normalized = normalizePublicHttpsUrl(submittedUrl);
    const response = await request(normalized.toString(), { method: "GET", maxBytes: LIMITS.htmlBytes, maximumRequests: VALIDATION_BUDGET.maximumRequests, deadline: Date.now() + VALIDATION_BUDGET.maximumDurationMs });
    const final = normalizePublicHttpsUrl(response.url);
    const target = { normalizedUrl: final.toString(), displayUrl: redactUrl(final.toString()), origin: final.origin, host: final.hostname, path: `${final.pathname}${final.search ? "?[redacted]" : ""}`, scope: input.scope, checks: input.checks, redirects: response.redirects };
    const signed = createCheckpoint({ url: final.toString(), origin: final.origin, scope: input.scope, checks: input.checks });
    return { schemaVersion: "1.0", valid: true, submittedUrl: redactUrl(submittedUrl), target, checkpoint: { ...signed, requestBudget: REQUEST_BUDGET, limitations: ["Public HTTPS only, no sign-in, no website changes.", "Server-returned HTML only. JavaScript is not executed.", DISCLAIMER, "Do not submit secrets or signed URLs in the query string."] }, errors: [] };
  } catch (error) {
    const code = error instanceof AuditNetworkError ? error.code : "TARGET_UNREACHABLE";
    const allowed = new Set(["INVALID_URL", "HTTPS_REQUIRED", "USERINFO_NOT_ALLOWED", "PORT_NOT_ALLOWED", "PRIVATE_DESTINATION", "DNS_FAILURE", "UNSAFE_REDIRECT", "TOO_MANY_REDIRECTS", "TARGET_UNREACHABLE"]);
    return { schemaVersion: "1.0", valid: false, submittedUrl: redactUrl(submittedUrl), target: null, checkpoint: null, errors: [{ code: allowed.has(code) ? code : "TARGET_UNREACHABLE", field: "url", message: error.message || "The target could not be validated." }] };
  }
}

export function createPluginServer(dependencies = {}) {
  const server = new McpServer({ name: "ai-crawler-readiness-auditor", version: "1.0.0" });
  registerAppResource(server, "Audit checkpoint", "ui://ai-crawler-readiness/checkpoint-v1.html", { _meta: appResourceMeta() }, async () => ({ contents: [{ uri: "ui://ai-crawler-readiness/checkpoint-v1.html", mimeType: RESOURCE_MIME_TYPE, text: checkpointHtml, _meta: appResourceMeta() }] }));
  registerAppResource(server, "Audit results", "ui://ai-crawler-readiness/results-v1.html", { _meta: appResourceMeta() }, async () => ({ contents: [{ uri: "ui://ai-crawler-readiness/results-v1.html", mimeType: RESOURCE_MIME_TYPE, text: resultsHtml, _meta: appResourceMeta() }] }));
  registerAppTool(server, "validate_audit_target", {
    title: "Validate crawler audit target", description: "Use this when the user asks whether their website or page is visible, crawlable or readable by AI crawlers or AI search (ChatGPT, GPTBot, OAI-SearchBot, Perplexity, Google AI), or wants a robots.txt, sitemap, llms.txt, meta tag or structured data check. Validates one public HTTPS page and opens the confirmation checkpoint; call it before run_readiness_audit. Do not use for signed-in pages, ranking reports or competitor comparisons.",
    inputSchema: z.object(inputBase).strict(), outputSchema: validationOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    _meta: toolMeta("ui://ai-crawler-readiness/checkpoint-v1.html", "Validating the public URL...", "URL ready for review."),
  }, async input => { const structuredContent = await validateTarget(input, dependencies.request); return { content: [{ type: "text", text: withAttribution(validationText(structuredContent)) }], structuredContent }; });
  registerAppTool(server, "run_readiness_audit", {
    title: "Run crawler readiness audit", description: "Use this after the user confirmed the checkpoint, to run the AI crawler readiness audit of that one public HTTPS page. Returns evidence, limitations and fixes ranked by priority. Do not use without the confirmation; it never changes the website or predicts AI rankings.",
    inputSchema: z.object({ ...inputBase, checkpointToken: z.string().min(32).max(4096).describe("Short-lived signed token returned by validate_audit_target.") }).strict(), outputSchema: auditOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    _meta: toolMeta("ui://ai-crawler-readiness/results-v1.html", "Checking public crawler signals...", "Crawler-readiness evidence is ready."),
  }, async input => {
    if (activeAudits >= MAX_CONCURRENT) return { content: [{ type: "text", text: "The audit service is at its concurrency limit. Try again shortly." }], isError: true };
    let normalized;
    try { normalized = normalizePublicHttpsUrl(input.url); verifyCheckpoint(input.checkpointToken, { url: normalized.toString(), origin: normalized.origin, scope: input.scope, checks: input.checks }); }
    catch (error) { return { content: [{ type: "text", text: `${error.message} Run validate_audit_target and confirm the checkpoint before auditing.` }], isError: true }; }
    activeAudits += 1;
    try {
      const structuredContent = await runAudit({ url: normalized.toString(), scope: input.scope, checks: input.checks }, { request: dependencies.request, expectedOrigin: normalized.origin });
      return { content: [{ type: "text", text: withAttribution(auditText(structuredContent)) }], structuredContent };
    } catch (error) {
      if (error.code === "ORIGIN_CHANGED") return { content: [{ type: "text", text: "The destination origin changed after confirmation. Validate the target again before continuing." }], isError: true };
      throw error;
    } finally { activeAudits -= 1; }
  });
  return server;
}

function hostAllowed(req) { return ALLOWED_HOSTS.has(String(req.headers.host || "").split(":")[0].toLowerCase()); }
function consumeRateLimit(req) {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(key);
  const take = (key, limit) => { const current = rateBuckets.get(key); if (!current) { rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS }); return true; } if (current.count >= limit) return false; current.count += 1; return true; };
  const client = String(req.headers["x-plugin-client-ip"] || req.socket.remoteAddress || "unknown").slice(0, 80);
  return take("global", RATE_LIMIT_GLOBAL) && take(`client:${client}`, RATE_LIMIT_PER_CLIENT);
}
async function readJson(req) {
  const declared = Number(req.headers["content-length"] || 0); if (declared > MAX_BODY_BYTES) throw Object.assign(new Error("Request too large"), { statusCode: 413 });
  const chunks = []; let total = 0;
  for await (const chunk of req) { total += chunk.length; if (total > MAX_BODY_BYTES) throw Object.assign(new Error("Request too large"), { statusCode: 413 }); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new Error("Invalid JSON"), { statusCode: 400 }); }
}
function contentType(file) { return ({ ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8" })[path.extname(file)] || "application/octet-stream"; }
function serve(res, file) { if (!existsSync(file) || !statSync(file).isFile()) return false; res.writeHead(200, { "content-type": contentType(file), "content-length": statSync(file).size, "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" }); createReadStream(file).pipe(res); return true; }
function serveFixture(req, res, url) {
  const host = String(req.headers.host || "").split(":")[0].toLowerCase();
  if (host === "fixtures.astudio.agency") {
    const fixture = url.pathname.split("/").filter(Boolean)[0];
    if (!["ready", "robots-blocked", "llms-html", "invalid-jsonld", "sitemap-timeout"].includes(fixture)) return false;
    const suffix = url.pathname.slice(fixture.length + 1) || "/";
    res.writeHead(302, { location: `https://${fixture}.fixtures.astudio.agency${suffix}`, "cache-control": "no-store" }).end();
    return true;
  }
  if (!host.endsWith(".fixtures.astudio.agency")) return false;
  const fixture = host.slice(0, -".fixtures.astudio.agency".length);
  const common = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (url.pathname === "/robots.txt") {
    const body = fixture === "robots-blocked" ? "User-agent: *\nDisallow: /article\nSitemap: https://robots-blocked.fixtures.astudio.agency/sitemap.xml\n" : `User-agent: *\nAllow: /\nSitemap: https://${host}/sitemap.xml\n`;
    res.writeHead(200, { ...common, "content-type": "text/plain; charset=utf-8" }).end(body); return true;
  }
  if (url.pathname === "/sitemap.xml") {
    if (fixture === "sitemap-timeout") { res.writeHead(504, { ...common, "content-type": "text/plain; charset=utf-8" }).end("Synthetic sitemap timeout"); return true; }
    res.writeHead(200, { ...common, "content-type": "application/xml; charset=utf-8" }).end(`<?xml version="1.0"?><urlset><url><loc>https://${host}/page</loc></url></urlset>`); return true;
  }
  if (["/llms.txt", "/llms-full.txt"].includes(url.pathname)) {
    if (fixture === "llms-html" && url.pathname === "/llms.txt") { res.writeHead(200, { ...common, "content-type": "text/html; charset=utf-8" }).end("<html><body>Fixture home page</body></html>"); return true; }
    res.writeHead(200, { ...common, "content-type": "text/markdown; charset=utf-8" }).end(`# Fixture\n\nPublic synthetic review fixture.\n\n## Pages\n- [Page](https://${host}/page)\n`); return true;
  }
  const jsonLd = fixture === "invalid-jsonld" ? "{invalid" : '{"@context":"https://schema.org","@type":"WebPage"}';
  const body = `<!doctype html><html><head><title>Public crawler fixture</title><meta name="description" content="Synthetic public crawler audit fixture"><link rel="canonical" href="https://${host}${url.pathname}"><script type="application/ld+json">${jsonLd}</script></head><body><main>This public synthetic fixture provides server-delivered text for deterministic crawler audit review. It contains no personal data and exists only to verify the bounded technical checks and human checkpoint flow.</main></body></html>`;
  res.writeHead(200, { ...common, "content-type": "text/html; charset=utf-8" }).end(body); return true;
}
export function createHttpServer(dependencies = {}) {
  return http.createServer(async (req, res) => {
    const started = Date.now();
    if (!req.url || !hostAllowed(req)) return res.writeHead(421).end("Misdirected Request");
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const publicPrefix = "/tools/ai-crawler-readiness-auditor";
    if (url.pathname === publicPrefix) url.pathname = "/";
    else if (url.pathname.startsWith(`${publicPrefix}/`)) url.pathname = url.pathname.slice(publicPrefix.length) || "/";
    if (req.method === "GET" && serveFixture(req, res, url)) return;
    if (req.method === "GET" && ["/health", "/ready"].includes(url.pathname)) return res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ status: "ok", service: "ai-crawler-readiness-auditor", version: "1.0.0", persistence: false }));
    const routes = new Map([["/", "index.html"], ["/ai-crawler-readiness-auditor", "index.html"], ["/privacy", "privacy.html"], ["/terms", "terms.html"], ["/support", "support.html"], ["/robots.txt", "robots.txt"], ["/sitemap.xml", "sitemap.xml"]]);
    if (req.method === "GET" && routes.has(url.pathname)) return serve(res, path.join(ROOT, "public", routes.get(url.pathname))) || res.writeHead(404).end("Not Found");
    if (req.method === "GET" && url.pathname.startsWith("/assets/")) { const file = path.resolve(ROOT, "public", `.${url.pathname}`); return file.startsWith(path.join(ROOT, "public") + path.sep) && serve(res, file) || res.writeHead(404).end("Not Found"); }
    if (req.method === "GET" && url.pathname === "/.well-known/openai-apps-challenge") { const token = process.env.OPENAI_APPS_CHALLENGE || ""; return token ? res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }).end(token) : res.writeHead(404).end("Not Found"); }
    if (req.method === "OPTIONS" && url.pathname === "/mcp") return res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-expose-headers": "Mcp-Session-Id" }).end();
    if (url.pathname === "/mcp" && req.method === "POST") {
      if (!consumeRateLimit(req)) return res.writeHead(429, { "content-type": "application/json", "retry-after": "60" }).end(JSON.stringify({ error: "Rate limit exceeded." }));
      try {
        const body = await readJson(req); const server = createPluginServer(dependencies); const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.setHeader("access-control-allow-origin", "*"); res.setHeader("access-control-expose-headers", "Mcp-Session-Id"); res.on("close", () => { transport.close(); server.close(); });
        await server.connect(transport); await transport.handleRequest(req, res, body);
        console.log(JSON.stringify({ event: "mcp_completed", status: res.statusCode, latency_ms: Date.now() - started, request_bytes: Number(req.headers["content-length"] || 0) }));
      } catch (error) { console.log(JSON.stringify({ event: "mcp_rejected", status: error.statusCode || 500, latency_ms: Date.now() - started })); if (!res.headersSent) res.writeHead(error.statusCode || 500, { "content-type": "application/json" }).end(JSON.stringify({ error: error.statusCode ? error.message : "Internal server error" })); }
      return;
    }
    if (url.pathname === "/mcp") return res.writeHead(405, { allow: "POST, OPTIONS" }).end("Method Not Allowed");
    return res.writeHead(404).end("Not Found");
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) createHttpServer().listen(PORT, "0.0.0.0", () => console.log(JSON.stringify({ event: "service_started", port: PORT })));
