#!/usr/bin/env node
import http from "node:http";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { SOURCE_REGISTRY, searchSource, inspectDataset } from "./adapters.mjs";
import { classifyRights, issueFlowToken, verifyFlowToken, fetchPreview, createExport } from "./data.mjs";
import { searchWidget, previewWidget } from "./widgets.mjs";

const require = createRequire(import.meta.url);
const PORT = Number(process.env.PORT || 8791);
const MAX_BODY_BYTES = 256 * 1024;
const ALLOWED_HOSTS = new Set((process.env.ALLOWED_HOSTS || "127.0.0.1,localhost,www.astudio.agency,astudio.agency").split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, "");
const APP_ORIGIN = process.env.APP_ORIGIN || "https://www.astudio.agency";
const SOURCES = ["us_data_gov", "uk_data_gov", "world_bank"];
const artifacts = new Map();
const rateBuckets = new Map();

function inlineBundle() {
  const source = readFileSync(require.resolve("@modelcontextprotocol/ext-apps/app-with-deps"), "utf8");
  return source.replace(/export\{([^}]+)\};?\s*$/, (_, body) => `globalThis.ExtApps={${body.split(",").map(part => { const [local, exported] = part.split(" as ").map(value => value.trim()); return `${exported || local}:${local}`; }).join(",")}};`);
}
const bundle = inlineBundle();
const SEARCH_URI = "ui://open-data/search-picker-v1.html";
const PREVIEW_URI = "ui://open-data/dataset-preview-v1.html";
const SEARCH_HTML = searchWidget(bundle);
const PREVIEW_HTML = previewWidget(bundle);
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const PUBLIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/privacy", ["privacy.html", "text/html; charset=utf-8"]],
  ["/terms", ["terms.html", "text/html; charset=utf-8"]],
  ["/support", ["support.html", "text/html; charset=utf-8"]],
  ["/site.css", ["site.css", "text/css; charset=utf-8"]],
]);
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true };
const appOnly = { ui: { visibility: ["app"] } };

function result(structuredContent, text, meta) {
  return { content: [{ type: "text", text: text || JSON.stringify(structuredContent) }], structuredContent, ...(meta ? { _meta: meta } : {}) };
}

function safeName(value) {
  return String(value || "open-data").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "open-data";
}

export function createPluginServer(options = {}) {
  const server = new McpServer({ name: "open-data-fetcher", version: "1.0.0" });
  registerAppResource(server, "Open Data Search", SEARCH_URI, { _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] } } } }, async () => ({ contents: [{ uri: SEARCH_URI, mimeType: RESOURCE_MIME_TYPE, text: SEARCH_HTML, _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] } } } }] }));
  registerAppResource(server, "Open Dataset Preview", PREVIEW_URI, { _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] } } } }, async () => ({ contents: [{ uri: PREVIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: PREVIEW_HTML, _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] } } } }] }));

  registerAppTool(server, "search_open_data", {
    title: "Search official open-data catalogs",
    description: "Use this when the user asks to find, search or download a public or government dataset or open data on a topic (US Data.gov, UK Data.gov.uk, World Bank Open Data). Opens the interactive search; the user submits it and picks a dataset. Do not use for private data, arbitrary websites or paid data; it accepts no URLs or credentials.",
    inputSchema: z.object({ suggested_query: z.string().max(200).optional(), suggested_source: z.enum(["all", ...SOURCES]).default("all"), suggested_format: z.enum(["csv", "jsonl", "parquet"]).default("csv") }).strict(),
    outputSchema: { form_version: z.literal("1.0"), suggested_query: z.string(), suggested_source: z.string(), suggested_format: z.string(), sources: z.array(z.object({ id: z.string(), label: z.string() })) },
    annotations,
    _meta: { ui: { resourceUri: SEARCH_URI }, "openai/outputTemplate": SEARCH_URI, "openai/toolInvocation/invoking": "Opening open-data search...", "openai/toolInvocation/invoked": "Open-data search is ready." },
  }, async input => result({ form_version: "1.0", suggested_query: input.suggested_query || "", suggested_source: input.suggested_source, suggested_format: input.suggested_format, sources: SOURCES.map(id => ({ id, label: SOURCE_REGISTRY[id].label })) }, "Open Data Fetcher is ready. Submit a search, then choose one dataset. No dataset has been selected."));

  registerAppTool(server, "discover_datasets", {
    title: "Discover official datasets",
    description: "Use this when the search widget has been submitted, to query only the approved official catalogs. Returns bounded dataset metadata. Do not use for websites outside those catalogs.",
    inputSchema: z.object({ source: z.enum(["all", ...SOURCES]), query: z.string().min(2).max(200), page: z.number().int().min(1).max(20), human_search_submitted: z.literal(true) }).strict(),
    outputSchema: { results: z.array(z.object({ dataset_ref: z.string(), title: z.string(), publisher: z.string(), description: z.string(), updated_at: z.string().nullable(), license_label: z.string(), formats: z.array(z.string()), official_page: z.string() })), page: z.number().int(), has_more: z.boolean(), warnings: z.array(z.string()) },
    annotations,
    _meta: appOnly,
  }, async input => {
    const ids = input.source === "all" ? SOURCES : [input.source];
    const settled = await Promise.allSettled(ids.map(id => searchSource(id, input.query, input.page, options)));
    const results = settled.flatMap(item => item.status === "fulfilled" ? item.value.results : []).slice(0, 20);
    const warnings = settled.map((item, index) => item.status === "rejected" ? `${SOURCE_REGISTRY[ids[index]].label} was unavailable.` : null).filter(Boolean);
    return result({ results, page: input.page, has_more: settled.some(item => item.status === "fulfilled" && item.value.has_more), warnings }, results.length ? `${results.length} official datasets found. The user must choose one dataset_ref.` : `No matching datasets. ${warnings.join(" ")}`);
  });

  registerAppTool(server, "inspect_open_dataset", {
    title: "Inspect selected open dataset",
    description: "Use this when the user has chosen one dataset, to check its publisher, licence, files and size and open the rights checkpoint. Amber rights open the publisher page; red rights block preview and export. Do not use before a dataset is chosen.",
    inputSchema: z.object({ dataset_ref: z.string().min(3).max(600), human_selection_confirmed: z.literal(true) }).strict(),
    outputSchema: { dataset: z.object({ dataset_ref: z.string(), title: z.string(), publisher: z.string(), official_page: z.string(), description: z.string(), updated_at: z.string().nullable(), license_label: z.string() }), rights: z.object({ license_label: z.string(), license_url: z.string().nullable(), commercial_use: z.string(), redistribution: z.string(), attribution_required: z.boolean(), attribution_text: z.string(), verdict: z.enum(["green", "amber", "red"]) }), resources: z.array(z.object({ resource_ref: z.string(), name: z.string(), source_format: z.string(), declared_bytes: z.number().nullable(), estimated_rows: z.number().nullable(), exportable: z.boolean(), blocked_reason: z.string().nullable() })), checkpoint_token: z.string() },
    annotations,
    _meta: { ui: { resourceUri: PREVIEW_URI }, "openai/outputTemplate": PREVIEW_URI },
  }, async input => {
    const inspected = await inspectDataset(input.dataset_ref, options);
    const raw = inspected.raw;
    const licenseUrl = raw.license_url || raw.license?.url || null;
    const rights = classifyRights(inspected.dataset.license_label, licenseUrl);
    const checkpointToken = issueFlowToken("checkpoint", { dataset_ref: input.dataset_ref, rights: rights.verdict });
    const output = { dataset: inspected.dataset, rights, resources: inspected.resources, checkpoint_token: checkpointToken };
    const instruction = rights.verdict === "green" ? "Review the source, license, attribution and resource size before preview." : rights.verdict === "amber" ? "Rights are unclear. Server export is disabled. Open the official publisher page by default." : "Rights block redistribution. Server preview and export are disabled.";
    return result(output, `${inspected.dataset.title}\nRights: ${rights.verdict.toUpperCase()}\nLicense: ${rights.license_label}\n${instruction}\nPublisher: ${inspected.dataset.official_page}`);
  });

  registerAppTool(server, "preview_open_dataset", {
    title: "Preview selected open-data resource",
    description: "Use this after a green-rights checkpoint is acknowledged, to show up to 200 sample rows with quality notes. Do not use for amber or red rights.",
    inputSchema: z.object({ dataset_ref: z.string().max(600), resource_ref: z.string().max(600), sample_rows: z.number().int().min(10).max(200).default(50), license_acknowledged: z.literal(true), checkpoint_token: z.string().max(4000) }).strict(),
    outputSchema: { dataset_ref: z.string(), resource_ref: z.string(), official_page: z.string(), rights: z.object({ verdict: z.string(), license_label: z.string() }), columns: z.array(z.object({ name: z.string(), inferred_type: z.string(), nullable: z.boolean(), null_count_sample: z.number(), distinct_count_sample: z.number(), min_sample: z.string().nullable(), max_sample: z.string().nullable() })), rows: z.array(z.record(z.string(), z.any())), quality: z.object({ sample_size: z.number(), duplicate_rows_sample: z.number(), empty_columns: z.array(z.string()), mixed_type_columns: z.array(z.string()), encoding: z.string(), delimiter: z.string(), warnings: z.array(z.any()) }), preview_token: z.string() },
    annotations,
    _meta: appOnly,
  }, async input => {
    const flow = verifyFlowToken(input.checkpoint_token, "checkpoint", { dataset_ref: input.dataset_ref });
    if (flow.rights !== "green") throw new Error("RIGHTS_NOT_GREEN");
    const inspected = await inspectDataset(input.dataset_ref, options);
    const resource = inspected.resources.find(item => item.resource_ref === input.resource_ref && item.exportable);
    if (!resource) throw new Error("RESOURCE_NOT_EXPORTABLE");
    const preview = await fetchPreview(input.dataset_ref, input.resource_ref, input.sample_rows, options);
    const previewToken = issueFlowToken("preview", { dataset_ref: input.dataset_ref, resource_ref: input.resource_ref, rights: "green", columns: preview.columns.map(column => column.name) });
    return result({ dataset_ref: input.dataset_ref, resource_ref: input.resource_ref, official_page: inspected.dataset.official_page, rights: { verdict: "green", license_label: inspected.dataset.license_label }, columns: preview.columns, rows: preview.rows, quality: preview.quality, preview_token: previewToken }, `Previewed ${preview.rows.length} rows and ${preview.columns.length} columns. Review the export settings. No file has been created.`);
  });

  const filterSchema = z.object({ column: z.string().max(128), operator: z.enum(["eq", "neq", "lt", "lte", "gt", "gte", "contains", "starts_with", "is_null"]), value: z.union([z.string().max(500), z.number(), z.boolean(), z.null()]) }).strict();
  registerAppTool(server, "prepare_open_data_export", {
    title: "Create confirmed open-data export",
    description: "Use this when the user confirms an export after preview, to create a temporary CSV, JSON Lines or Parquet download of the chosen columns and filters. Do not use before preview and licence acknowledgment; it never publishes data or accepts arbitrary URLs.",
    inputSchema: z.object({ dataset_ref: z.string().max(600), resource_ref: z.string().max(600), format: z.enum(["csv", "jsonl", "parquet"]), selected_columns: z.array(z.string().max(128)).min(1).max(250), filters: z.array(filterSchema).max(20).default([]), row_limit: z.number().int().min(1).max(5_000_000), license_acknowledged: z.literal(true), export_confirmed: z.literal(true), preview_token: z.string().max(8000) }).strict(),
    outputSchema: { job_ref: z.string(), status: z.literal("ready"), summary: z.object({ rows_written: z.number(), columns_written: z.number(), format: z.string(), bytes: z.number(), sha256: z.string(), expires_at: z.string() }), attribution: z.object({ text: z.string(), license_url: z.string().nullable() }), fallback: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    _meta: appOnly,
  }, async input => {
    const flow = verifyFlowToken(input.preview_token, "preview", { dataset_ref: input.dataset_ref, resource_ref: input.resource_ref });
    if (flow.rights !== "green" || input.selected_columns.some(column => !flow.columns.includes(column))) throw new Error("EXPORT_SCOPE_MISMATCH");
    const inspected = await inspectDataset(input.dataset_ref, options);
    const rights = classifyRights(inspected.dataset.license_label, inspected.raw.license_url || null);
    if (rights.verdict !== "green") throw new Error("RIGHTS_CHANGED_OR_BLOCKED");
    const exported = await createExport(input, options);
    const jobRef = randomBytes(16).toString("hex");
    const token = randomBytes(24).toString("base64url");
    const expires = Date.now() + 60 * 60_000;
    const fileName = `${safeName(inspected.dataset.title)}.${exported.extension}`;
    artifacts.set(token, { ...exported, fileName, expires, used: false });
    const summary = { rows_written: exported.rows, columns_written: exported.columns, format: input.format, bytes: exported.content.length, sha256: exported.sha256, expires_at: new Date(expires).toISOString() };
    const download = exported.content.length <= 10 * 1024 * 1024 ? { file_name: fileName, mime_type: exported.mimeType, content_base64: exported.content.toString("base64") } : { file_name: fileName, mime_type: exported.mimeType, url: `${PUBLIC_BASE_URL}/downloads/${token}` };
    return result({ job_ref: jobRef, status: "ready", summary, attribution: { text: rights.attribution_text, license_url: rights.license_url }, fallback: `Artifact ready: ${fileName}, ${exported.rows} rows, SHA-256 ${exported.sha256}. Use the widget download. The link is intentionally not exposed in text.` }, `Export ready: ${fileName}\nRows: ${exported.rows}\nBytes: ${exported.content.length}\nSHA-256: ${exported.sha256}\nUse the widget's host-mediated download. The artifact expires within 60 minutes.`, { download });
  });
  return server;
}

function consumeRateLimit(req) {
  const now = Date.now();
  const key = String(req.headers["x-plugin-client-ip"] || req.socket.remoteAddress || "unknown").slice(0, 80);
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.reset <= now) { rateBuckets.set(key, { count: 1, reset: now + 60_000 }); return true; }
  if (bucket.count >= 60) return false;
  bucket.count += 1; return true;
}

async function readBody(req) {
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > MAX_BODY_BYTES) throw Object.assign(new Error("Request body exceeds the limit."), { statusCode: 413 });
  const chunks = []; let total = 0;
  for await (const chunk of req) { total += chunk.length; if (total > MAX_BODY_BYTES) throw Object.assign(new Error("Request body exceeds the limit."), { statusCode: 413 }); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new Error("Invalid JSON request body."), { statusCode: 400 }); }
}

export function createHttpServer(options = {}) {
  return http.createServer(async (req, res) => {
    const host = String(req.headers.host || "").split(":")[0].toLowerCase();
    if (!ALLOWED_HOSTS.has(host)) return res.writeHead(421).end("Misdirected Request");
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    if (req.method === "GET" && PUBLIC_FILES.has(url.pathname)) {
      const [file, type] = PUBLIC_FILES.get(url.pathname);
      return res.writeHead(200, { "content-type": type, "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" }).end(readFileSync(path.join(PUBLIC_DIR, file)));
    }
    if (req.method === "GET" && ["/health", "/ready"].includes(url.pathname)) return res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ status: "ok", service: "open-data-fetcher", version: "1.0.0", adapters: SOURCES, arbitrary_urls: false, credentials: false }));
    if (req.method === "GET" && url.pathname === "/.well-known/openai-apps-challenge") return res.writeHead(process.env.OPENAI_APPS_CHALLENGE ? 200 : 404, { "content-type": "text/plain", "cache-control": "no-store" }).end(process.env.OPENAI_APPS_CHALLENGE || "Not configured");
    if (req.method === "GET" && url.pathname.startsWith("/downloads/")) {
      const token = url.pathname.slice("/downloads/".length); const artifact = artifacts.get(token);
      if (!artifact || artifact.used || artifact.expires < Date.now()) return res.writeHead(404, { "cache-control": "no-store" }).end("Download expired or unavailable");
      artifact.used = true; artifacts.delete(token);
      return res.writeHead(200, { "content-type": artifact.mimeType, "content-disposition": `attachment; filename="${artifact.fileName}"`, "content-length": artifact.content.length, "cache-control": "no-store", "x-content-type-options": "nosniff" }).end(artifact.content);
    }
    if (req.method === "OPTIONS" && url.pathname === "/mcp") return res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-expose-headers": "Mcp-Session-Id" }).end();
    if (url.pathname === "/mcp" && ["GET", "DELETE"].includes(req.method || "")) return res.writeHead(405, { allow: "POST, OPTIONS", "cache-control": "no-store" }).end("Method Not Allowed");
    if (url.pathname === "/mcp" && req.method === "POST") {
      if (!consumeRateLimit(req)) return res.writeHead(429, { "content-type": "application/json", "retry-after": "60" }).end(JSON.stringify({ error: "Rate limit exceeded." }));
      const server = createPluginServer(options); const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => { transport.close(); server.close(); });
      try { const body = await readBody(req); res.setHeader("access-control-allow-origin", "*"); res.setHeader("access-control-expose-headers", "Mcp-Session-Id"); await server.connect(transport); await transport.handleRequest(req, res, body); }
      catch (error) { if (!res.headersSent) res.writeHead(error.statusCode || 500, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ error: error.statusCode ? error.message : "Internal server error" })); }
      return;
    }
    res.writeHead(404).end("Not Found");
  });
}

const cleanup = setInterval(() => { const now = Date.now(); for (const [token, artifact] of artifacts) if (artifact.expires < now) artifacts.delete(token); for (const [key, bucket] of rateBuckets) if (bucket.reset < now) rateBuckets.delete(key); }, 60_000); cleanup.unref();

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) createHttpServer().listen(PORT, "0.0.0.0", () => console.log(JSON.stringify({ service: "open-data-fetcher", status: "started", port: PORT })));
