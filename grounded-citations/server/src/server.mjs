#!/usr/bin/env node
import http from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { SessionStore } from "./core/session-store.mjs";
import { retrieveUrl, normalizePublicUrl } from "./core/url-policy.mjs";
import { extractSource, normalizeExtractedText, sanitizeLabel } from "./core/extraction.mjs";
import { confirmLedger, publicEntry, sourceKey } from "./core/ledger.mjs";
import { verifyQuoteInText } from "./core/quote-matcher.mjs";
import { verifyDraftAgainstLedger } from "./core/draft-verifier.mjs";
import { renderSources } from "./core/source-renderer.mjs";
import { confirmScopeInput, endSessionInput, outputs, prepareScopeInput, previewEvidenceInput, renderInput, verifyDraftInput, verifyQuoteInput } from "./schemas.mjs";

const PORT = Number(process.env.PORT || 8790);
if ((process.env.PERSISTENCE_BACKEND || "memory") !== "memory") throw new Error("Unsupported persistence backend. Configure reviewed production persistence before enabling it.");
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 512 * 1024);
const MAX_SESSION_BYTES = Number(process.env.MAX_SESSION_BYTES || 75 * 1024 * 1024);
const MAX_SESSION_CHARS = Number(process.env.MAX_SESSION_CHARS || 1_000_000);
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_CLIENT || 60);
const GLOBAL_RATE_LIMIT = Number(process.env.RATE_LIMIT_GLOBAL || 600);
const ALLOWED_HOSTS = new Set((process.env.ALLOWED_HOSTS || "127.0.0.1,localhost,www.astudio.agency,astudio.agency").split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
const store = new SessionStore();
const buckets = new Map();
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");
const RESOURCE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "resources");
const require = createRequire(import.meta.url);
let widgetBundle;
const WIDGET_URIS = {
  scope: "ui://grounded-citations/scope-review.html",
  evidence: "ui://grounded-citations/evidence-ledger.html",
  verification: "ui://grounded-citations/verification-report.html",
};

function loadWidget(name) {
  if (!widgetBundle) widgetBundle = readFileSync(require.resolve("@modelcontextprotocol/ext-apps/app-with-deps"), "utf8").replace(/export\{([^}]+)\};?\s*$/, (_, body) => `globalThis.ExtApps={${body.split(",").map(part => { const [local, exported] = part.split(" as ").map(value => value.trim()); return `${exported || local}:${local}`; }).join(",")}};`);
  return readFileSync(path.join(RESOURCE_DIR, name), "utf8").replace("/*__EXT_APPS_BUNDLE__*/", () => widgetBundle);
}
function appMeta(uri) { return { ui: { resourceUri: uri } }; }
function annotations(title, readOnlyHint, destructiveHint, openWorldHint) { return { title, readOnlyHint, destructiveHint, openWorldHint, idempotentHint: readOnlyHint }; }
const ATTRIBUTION = "Provided by ASTUDIO (https://www.astudio.agency).";
function success(value, text) { return { content: [{ type: "text", text: `${text}\n\n${ATTRIBUTION}` }], structuredContent: value }; }
function failure(error) { return { content: [{ type: "text", text: `Grounded Citations error (${error.code || "internal_error"}): ${error.message}` }], isError: true }; }
function iso(ms) { return new Date(ms).toISOString(); }

export async function prepareScope(input, dependencies = {}) {
  const retrieve = dependencies.retrieve || retrieveUrl; const now = dependencies.now || Date.now(); const preparationStarted = Date.now();
  const remainingPreparationMs = () => { const remaining = 120_000 - (Date.now() - preparationStarted); if (remaining <= 0) throw Object.assign(new Error("Source preparation exceeded the total time limit."), { code: "preparation_timeout" }); return Math.min(30_000, remaining); };
  const brief = { objective: input.objective.trim(), mode: input.mode, output_format: input.output_format, coverage_threshold: input.coverage_threshold ?? null };
  const candidates = []; const seen = new Set(); let totalBytes = 0; let totalChars = 0; let redirectCount = 0;
  const add = source => { if (seen.has(source.source_key)) { source.intake_status = "duplicate"; source.warnings.push("Duplicate of an earlier source."); } else if (["accepted", "partial"].includes(source.intake_status)) seen.add(source.source_key); candidates.push(source); };
  for (const item of input.urls || []) {
    const accessed = iso(now); let key = sourceKey("url", item.url); const base = { source_key: key, kind: "url", display_title: sanitizeLabel(item.title_hint || "Web source"), intake_status: "rejected", extraction_status: "failed", submitted_url: item.url, accessed_at: accessed, extracted_characters: 0, warnings: [] };
    try {
      const normalized = normalizePublicUrl(item.url); key = sourceKey("url", normalized); base.source_key = key; base.submitted_url = normalized;
      const fetched = await retrieve(normalized, { maxBytes: 25 * 1024 * 1024, timeoutMs: remainingPreparationMs(), maxRedirects: Math.max(0, 20 - redirectCount) });
      redirectCount += fetched.redirects; totalBytes += fetched.body.length; if (totalBytes > MAX_SESSION_BYTES) throw Object.assign(new Error("Session exceeds the download byte limit."), { code: "session_byte_limit" });
      const extracted = await extractSource(fetched.body, fetched.contentType); totalChars += extracted.text.length; if (totalChars > MAX_SESSION_CHARS) throw Object.assign(new Error("Session exceeds the extracted character limit."), { code: "session_character_limit" });
      Object.assign(base, { display_title: sanitizeLabel(item.title_hint || extracted.title || new URL(fetched.finalUrl).hostname), intake_status: extracted.truncated ? "partial" : "accepted", extraction_status: extracted.truncated ? "partial" : "complete", final_url: fetched.finalUrl, mime_type: extracted.mime, extracted_characters: extracted.text.length, text: extracted.text, text_digest: extracted.digest, truncated: extracted.truncated });
      if (extracted.truncated) base.warnings.push("Extraction was truncated at the per-source character limit.");
    } catch (error) { base.rejection_code = error.code || "extraction_failed"; base.warnings.push(error.message); base.text = ""; base.text_digest = ""; base.truncated = false; }
    add(base);
  }
  for (const item of input.files || []) {
    const accessed = iso(now); const key = sourceKey("file", item.file_id); const base = { source_key: key, kind: "file", display_title: sanitizeLabel(item.file_name || "Attached file"), file_name: sanitizeLabel(item.file_name || "attachment"), mime_type: item.mime_type, intake_status: "rejected", extraction_status: "failed", accessed_at: accessed, extracted_characters: 0, warnings: ["Attachments may not have durable public URLs."] };
    try {
      const fetched = await retrieve(item.download_url, { maxBytes: 25 * 1024 * 1024, timeoutMs: remainingPreparationMs(), maxRedirects: Math.max(0, 20 - redirectCount) }); redirectCount += fetched.redirects;
      totalBytes += fetched.body.length; if (totalBytes > MAX_SESSION_BYTES) throw Object.assign(new Error("Session exceeds the download byte limit."), { code: "session_byte_limit" });
      const extracted = await extractSource(fetched.body, item.mime_type || fetched.contentType); totalChars += extracted.text.length; if (totalChars > MAX_SESSION_CHARS) throw Object.assign(new Error("Session exceeds the extracted character limit."), { code: "session_character_limit" });
      Object.assign(base, { mime_type: extracted.mime, intake_status: extracted.truncated ? "partial" : "accepted", extraction_status: extracted.truncated ? "partial" : "complete", extracted_characters: extracted.text.length, text: extracted.text, text_digest: extracted.digest, truncated: extracted.truncated });
      if (extracted.truncated) base.warnings.push("Extraction was truncated at the per-source character limit.");
    } catch (error) { base.rejection_code = error.code || "extraction_failed"; base.warnings.push(error.message); base.text = ""; base.text_digest = ""; base.truncated = false; }
    add(base);
  }
  for (const item of input.pasted_sources || []) {
    const text = normalizeExtractedText(item.text); const key = sourceKey("pasted_text", `${item.title}\0${text}`); totalChars += text.length;
    const accepted = totalChars <= MAX_SESSION_CHARS;
    add({ source_key: key, kind: "pasted_text", display_title: sanitizeLabel(item.title), intake_status: accepted ? "accepted" : "rejected", extraction_status: accepted ? "complete" : "failed", accessed_at: iso(now), extracted_characters: accepted ? text.length : 0, warnings: accepted ? [] : ["Session exceeds the extracted character limit."], rejection_code: accepted ? undefined : "session_character_limit", text: accepted ? text : "", text_digest: accepted ? sourceKey("text", text).slice(5) : "", truncated: false });
  }
  const session = (dependencies.store || store).create(brief, candidates, now);
  const sources = candidates.map(({ text, text_digest, truncated, ...source }) => source);
  return { session_id: session.id, revision: 1, expires_at: iso(session.expiresAtMs), brief, sources, requires_confirmation: true, limits_applied: ["20 URLs", "10 files", "25 MB per remote source", "500 PDF pages per source", "75 MB per session", "200,000 extracted characters per source", "1,000,000 extracted characters per session", "20 redirects per session", "30 seconds per retrieval", "2 minutes total source preparation", "200,000 draft characters"], warnings: candidates.flatMap(source => source.warnings.map(warning => `${source.display_title}: ${warning}`)) };
}

export function createPluginServer(options = {}) {
  const sessions = options.store || store; const server = new McpServer({ name: "grounded-citations", version: "1.0.0" });
  const tool = (name, config, handler) => {
    const wrapped = async input => { try { return await handler(input); } catch (error) { return failure(error); } };
    return config._meta?.ui ? registerAppTool(server, name, config, wrapped) : server.registerTool(name, config, wrapped);
  };
  tool("prepare_scope", { title: "Prepare citation scope", description: "Use this when the user asks to check, verify or build citations, sources, references or exact quotes against web pages, attached files or pasted text they supply. Extracts those sources and opens the source-scope checkpoint; call it first. Do not use for open web research or to judge whether a claim is true.", inputSchema: prepareScopeInput, outputSchema: outputs.prepare.shape, annotations: annotations("Prepare citation scope", true, false, true), _meta: { ...appMeta(WIDGET_URIS.scope), "openai/fileParams": ["files"] } }, async input => {
    const value = await prepareScope(input, { store: sessions, retrieve: options.retrieve });
    const lines = value.sources.map(source => `${source.source_key}  ${source.intake_status}  ${source.display_title}${source.warnings.length ? `, ${source.warnings.join("; ")}` : ""}`);
    return success(value, `Scope checkpoint\n\nObjective: ${value.brief.objective}\nMode: ${value.brief.mode}\nFormat: ${value.brief.output_format}\n\nSources:\n${lines.join("\n")}\n\nReply with: Use sources [source keys], Revise intake, or Cancel. No final citation work has run.`);
  });
  tool("confirm_scope", { title: "Confirm citation scope", description: "Use this when the user has confirmed the source selection in the checkpoint, to assign stable citation IDs for a new ledger revision. Do not use before confirmation.", inputSchema: confirmScopeInput, outputSchema: outputs.confirm.shape, annotations: annotations("Confirm citation scope", false, false, false) }, async input => {
    const session = sessions.get(input.session_id); const ledger = confirmLedger(session, input.selected_source_keys, input.revision);
    const value = { session_id: session.id, scope_revision: session.scopeRevision, ledger_revision: session.ledgerRevision, expires_at: iso(session.expiresAtMs), brief: session.brief, sources: ledger.map(publicEntry), warnings: ledger.flatMap(entry => entry.warnings), retention_notice: "Source content expires after 2 idle hours or 24 hours total and can be deleted immediately with end_session." };
    return success(value, `Citation scope confirmed at ledger revision ${value.ledger_revision}.\n${ledger.map(entry => `[${entry.id}] ${entry.display_title}`).join("\n")}\nSource content is session-scoped and may be deleted now with end_session.`);
  });
  tool("verify_quote", { title: "Verify source quote", description: "Use this when a draft quotes a selected source, to check whether the exact quote occurs in that source. A match means found in source, not proven true; case, whitespace and Markdown presentation are ignored, never paraphrased. Do not use for sources outside the ledger.", inputSchema: verifyQuoteInput, outputSchema: outputs.quote.shape, annotations: annotations("Verify source quote", true, false, false) }, async input => {
    const { ledger } = sessions.requireLedger(input.session_id, input.ledger_revision); const entry = ledger.find(item => item.id === input.source_id); if (!entry) throw Object.assign(new Error("Source ID is not in the active ledger."), { code: "unknown_source_id" });
    const match = verifyQuoteInText(entry.text, input.quote, entry.truncated); const value = { source_id: entry.id, status: match.status, submitted_quote: match.submitted_quote, matched_quote: match.matched_quote, occurrence_count: match.occurrence_count, location: match.location, normalization: match.normalization };
    if (match.status === "verified") entry.quotes.push({ id: match.evidence_id, text: match.matched_quote, source_start: match.location.start, source_end: match.location.end, status: "verified", claim_label: input.claim_label, created_at: iso(Date.now()) });
    return success(value, match.status === "verified" ? `Found in source [${entry.id}]: "${match.matched_quote}"\nThis confirms occurrence, not truth or semantic support.` : `Quote status for source [${entry.id}]: ${match.status}. Occurrences: ${match.occurrence_count}. No evidence was attached.`);
  });
  tool("preview_evidence", { title: "Review citation evidence", description: "Use this when the user wants to see the citation ledger: selected sources and the verified quote spans, paginated. Do not use to decide whether a source proves a claim.", inputSchema: previewEvidenceInput, outputSchema: outputs.preview.shape, annotations: annotations("Review citation evidence", true, false, false), _meta: appMeta(WIDGET_URIS.evidence) }, async input => {
    const { ledger } = sessions.requireLedger(input.session_id, input.ledger_revision); const filtered = input.source_ids?.length ? ledger.filter(entry => input.source_ids.includes(entry.id)) : ledger; const rows = filtered.slice(input.cursor, input.cursor + input.page_size).map(publicEntry); const next = input.cursor + input.page_size < filtered.length ? input.cursor + input.page_size : null;
    const value = { session_id: input.session_id, ledger_revision: input.ledger_revision, rows, page: { cursor: input.cursor, page_size: input.page_size, next_cursor: next, total: filtered.length }, source_counts: { total: filtered.length, with_verified_evidence: filtered.filter(entry => entry.quotes.length).length, unresolved: filtered.filter(entry => !entry.quotes.length).length }, unresolved_claims: [], warnings: filtered.flatMap(entry => entry.warnings) };
    return success(value, rows.map(entry => `[${entry.id}] ${entry.display_title}\n${entry.final_url ? `URL: ${entry.final_url}\n` : ""}Evidence: ${entry.quotes.length ? "verified" : "missing"}${entry.quotes.map(quote => `\nFound in source: "${quote.text}"`).join("")}`).join("\n\n") + (next !== null ? `\n\nMore sources are available at cursor ${next}.` : ""));
  });
  tool("verify_draft", { title: "Verify draft citations", description: "Use this when the user asks to check a draft's citations against the ledger: unknown IDs, Sources list mapping, URL mismatches, citation limits, coverage, evidence requirements and unverified markers. Do not use before confirm_scope.", inputSchema: verifyDraftInput, outputSchema: outputs.draft.shape, annotations: annotations("Verify draft citations", true, false, false), _meta: appMeta(WIDGET_URIS.verification) }, async input => {
    const { session, ledger } = sessions.requireLedger(input.session_id, input.ledger_revision); const checked = verifyDraftAgainstLedger(ledger, input.draft, { coverageThreshold: input.coverage_threshold ?? session.brief.coverage_threshold, requireEvidence: input.require_evidence ?? session.brief.mode === "evidence", strict: input.strict }); const value = { ledger_revision: input.ledger_revision, ...checked };
    return success(value, `Draft verification: ${value.passed ? "passed" : "failed"}.\nCited sources: ${value.cited_source_ids.join(", ") || "none"}.\nCoverage: ${value.coverage.cited_sentences}/${value.coverage.prose_sentences} sentences (${value.coverage.ratio}).\nErrors: ${value.errors.map(issue => issue.message).join("; ") || "none"}.\nWarnings: ${value.warnings.map(issue => issue.message).join("; ") || "none"}.`);
  });
  tool("render_citations", { title: "Render citation sources", description: "Use this when the user asks for the Sources list or reference block, to render source URLs, attachment labels, pasted-text labels and optional exact evidence from the ledger. Do not use to invent or search for sources.", inputSchema: renderInput, outputSchema: outputs.render.shape, annotations: annotations("Render citation sources", true, false, false) }, async input => {
    const { ledger } = sessions.requireLedger(input.session_id, input.ledger_revision); const unknown = (input.cited_source_ids || []).filter(id => !ledger.some(entry => entry.id === id)); if (unknown.length) throw Object.assign(new Error(`Unknown source IDs: ${unknown.join(", ")}.`), { code: "unknown_source_id" });
    const selected = input.cited_source_ids?.length ? ledger.filter(entry => input.cited_source_ids.includes(entry.id)) : ledger; const rendered = renderSources(ledger, input.style, input.cited_source_ids); const warnings = selected.filter(entry => entry.kind === "file" && !entry.final_url).map(entry => `[${entry.id}] Attachment has no durable public URL.`); const value = { ledger_revision: input.ledger_revision, style: input.style, rendered, source_ids: selected.map(entry => entry.id), verification_summary: "Rendering is mechanical. Run verify_draft after placing citations in a draft.", warnings, retention_notice: "Source content expires after 2 idle hours or 24 hours total. Use end_session for immediate deletion." };
    return success(value, `${rendered}\n\n${value.verification_summary}\n${value.retention_notice}${warnings.length ? `\nWarnings: ${warnings.join("; ")}` : ""}`);
  });
  tool("end_session", { title: "Delete citation session", description: "Use this when the user asks to delete or end the citation session. Removes its stored source text, ledger and evidence immediately; calling it twice is safe. Do not use mid-task.", inputSchema: endSessionInput, outputSchema: outputs.end.shape, annotations: annotations("Delete citation session", false, true, false) }, async input => {
    const value = { session_id: input.session_id, status: sessions.delete(input.session_id), source_content_deleted: true }; return success(value, value.status === "deleted" ? "Citation session deleted. Later access will fail." : "Citation session was already deleted or unavailable.");
  });
  for (const [name, uri] of Object.entries(WIDGET_URIS)) registerAppResource(server, `Grounded Citations ${name}`, uri, { _meta: { ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [], baseUriDomains: [] } } } }, async () => ({ contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: loadWidget(name === "scope" ? "scope-review.html" : name === "evidence" ? "evidence-ledger.html" : "verification-report.html"), _meta: { ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [], baseUriDomains: [] } } } }] }));
  return server;
}

function hostAllowed(req) { return ALLOWED_HOSTS.has(String(req.headers.host || "").split(":")[0].toLowerCase()); }
function consumeRate(req) { const now = Date.now(); for (const [key, value] of buckets) if (value.reset <= now) buckets.delete(key); const client = String(req.headers["x-plugin-client-ip"] || req.socket.remoteAddress || "unknown").slice(0, 80); const take = (key, limit) => { const value = buckets.get(key); if (!value) { buckets.set(key, { count: 1, reset: now + 60_000 }); return true; } if (value.count >= limit) return false; value.count += 1; return true; }; return take("global", GLOBAL_RATE_LIMIT) && take(client, RATE_LIMIT); }
async function readBody(req) { const declared = Number(req.headers["content-length"] || 0); if (declared > MAX_BODY_BYTES) throw Object.assign(new Error("Request body exceeds the limit."), { statusCode: 413 }); const chunks = []; let total = 0; for await (const chunk of req) { total += chunk.length; if (total > MAX_BODY_BYTES) throw Object.assign(new Error("Request body exceeds the limit."), { statusCode: 413 }); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new Error("Invalid JSON."), { statusCode: 400 }); } }
function servePage(res, name, type = "text/html; charset=utf-8") { try { res.writeHead(200, { "content-type": type, "cache-control": "public, max-age=300", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", "x-content-type-options": "nosniff" }).end(readFileSync(path.join(PUBLIC_DIR, name))); } catch { res.writeHead(404).end("Not Found"); } }
export function createHttpServer(options = {}) { const sessions = options.store || store; return http.createServer(async (req, res) => { const started = Date.now(); if (!req.url || !hostAllowed(req)) return res.writeHead(421).end("Misdirected Request"); const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === "GET" && ["/health", "/ready"].includes(url.pathname)) return res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ status: "ok", service: "grounded-citations", version: "1.0.0", persistence: "bounded-in-memory", idle_ttl_hours: 2, hard_ttl_hours: 24 }));
  if (req.method === "GET" && url.pathname === "/") return servePage(res, "product.html"); if (req.method === "GET" && ["/privacy", "/terms", "/support"].includes(url.pathname)) return servePage(res, `${url.pathname.slice(1)}.html`);
  if (req.method === "GET" && url.pathname === "/.well-known/openai-apps-challenge") { const token = process.env.OPENAI_APPS_CHALLENGE; if (!token) return res.writeHead(404).end("Not Found"); return res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }).end(token); }
  if (req.method === "OPTIONS" && url.pathname === "/mcp") return res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-expose-headers": "Mcp-Session-Id" }).end();
  if (url.pathname === "/mcp" && req.method === "POST") { if (!consumeRate(req)) return res.writeHead(429, { "retry-after": "60", "cache-control": "no-store" }).end("Rate limit exceeded"); res.setHeader("access-control-allow-origin", "*"); res.setHeader("access-control-expose-headers", "Mcp-Session-Id"); const mcp = createPluginServer({ store: sessions, retrieve: options.retrieve }); const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true }); res.on("close", () => { transport.close(); mcp.close(); }); try { const body = await readBody(req); await mcp.connect(transport); await transport.handleRequest(req, res, body); console.log(JSON.stringify({ event: "mcp_request", status: res.statusCode < 400 ? "completed" : "rejected", latency_ms: Date.now() - started, request_bytes: Number(req.headers["content-length"] || 0) })); } catch (error) { console.log(JSON.stringify({ event: "mcp_request", status: "rejected", error_class: error.code || "request_error", latency_ms: Date.now() - started })); if (!res.headersSent) res.writeHead(error.statusCode || 500, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ error: error.statusCode ? error.message : "Internal server error" })); } return; }
  if (url.pathname === "/mcp") return res.writeHead(405, { allow: "POST, OPTIONS" }).end("Method Not Allowed"); res.writeHead(404).end("Not Found"); }); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) createHttpServer().listen(PORT, "0.0.0.0", () => console.log(JSON.stringify({ event: "service_started", port: PORT })));
