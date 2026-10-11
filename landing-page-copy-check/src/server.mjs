#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8790);
const ATTRIBUTION = "Provided by ASTUDIO. For a human ASTUDIO team on this work: https://www.astudio.agency/tools/landing-page-copy-check";
const clean = value => String(value ?? "").trim();
const brief = z.object({ pageType: z.string().min(2), product: z.string().min(2), audience: z.string().min(2), offer: z.string().min(2), goal: z.string().min(2), tone: z.string().min(2), currentCopy: z.string().optional(), mustKeepFacts: z.array(z.string()).default([]) }).strict();
const copy = z.object({ headline: z.string().min(2), subhead: z.string().min(2), valuePoints: z.array(z.string()).min(3).max(5), proof: z.array(z.string()).default([]), primaryCta: z.string().min(2), faq: z.array(z.object({ question: z.string(), answer: z.string() }).strict()).default([]) }).strict();
const performanceClaim = /\b(?:increase(?:s|d)?\s+[\p{L}\s-]{0,40}?\s+by\s+\d+(?:\.\d+)?\s*(?:%|percent)|\d+(?:\.\d+)?\s*(?:%|percent)\b|\d+(?:\.\d+)?\s*x\b|guaranteed?|fake|fabricated|invented testimonial)\b/giu;

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function hasWholeFact(haystack, fact) { const value = clean(fact); return value.length > 0 && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(value)}(?=$|[^\\p{L}\\p{N}])`, "iu").test(haystack); }
function validateCopy(value, sourceBrief = { mustKeepFacts: [] }) {
  const parsed = copy.parse(value);
  if (clean(parsed.headline).split(/\s+/u).length > 12) throw Error("The Landing Page Copy Check house limit is 12 words for a headline.");
  const body = JSON.stringify(parsed);
  const allowed = sourceBrief.mustKeepFacts || [];
  const unsupported = [...body.matchAll(performanceClaim)].map(match => match[0]).filter(claim => !allowed.some(fact => hasWholeFact(fact, claim)));
  if (unsupported.length) throw Error(`Remove banned or unsupported claims: ${unsupported.join(", ")}.`);
  const missing = allowed.filter(fact => !hasWholeFact(body, fact));
  return { copy: parsed, missing };
}
function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
function escapeMarkdown(value) { return String(value).replace(/([\\`*_{}[\]()#+.!|>-])/g, "\\$1"); }

export function openPageBrief(input = {}) { return { fields: ["pageType", "product", "audience", "offer", "goal", "tone", "currentCopy", "mustKeepFacts"], prefill: input.prefill || {}, privacyNotice: "This tool works on pasted text only. It does not fetch URLs or change sites." }; }
export function reviewPageBrief(input) { const value = brief.parse(input); return { normalizedBrief: value, canApprove: true, confirmationRequired: true, message: "Reply approve to allow drafting." }; }
export function draftPageCopy(input) { if (input.briefApproved !== true) throw Error("Drafting requires explicit brief approval."); const b = brief.parse(input.brief); const checked = validateCopy(input.copy, b); return { brief: b, copy: checked.copy, approval: { briefApproved: true }, factCheck: { kept: b.mustKeepFacts.filter(item => !checked.missing.includes(item)), missing: checked.missing }, warnings: checked.missing.length ? ["Some must-keep facts are absent."] : [] }; }
export function checkPageConversion(input) {
  const source = clean(input.copy ?? (input.draft ? JSON.stringify(input.draft) : ""));
  if (input.formFieldCount !== undefined && (!Number.isInteger(input.formFieldCount) || input.formFieldCount < 0)) throw Error("Form field count must be a non-negative integer.");
  if (input.popupDelaySeconds !== undefined && (!Number.isFinite(input.popupDelaySeconds) || input.popupDelaySeconds < 0)) throw Error("Popup delay must be a non-negative number.");
  const fields = input.formFieldCount, delay = input.popupDelaySeconds;
  const headline = clean(input.headline ?? input.draft?.headline ?? (input.copy ? source.split("\n")[0] : ""));
  const ctas = (source.match(/\b(?:see\s+(?:plans|pricing|options)|get\s+started|start|book|buy|get|try|request|contact|sign\s+up|learn\s+more)\b/giu) || []).length;
  const checked = (name, pass, passDetail, failDetail) => ({ name, status: pass ? "pass" : "finding", pass, detail: pass ? passDetail : failDetail });
  const unchecked = (name, detail) => ({ name, status: "not checked", pass: null, detail });
  const checks = [
    source ? checked("CTA presence", ctas > 0, `${ctas} CTA phrase(s) found.`, "Add one primary CTA.") : unchecked("CTA presence", "Not checked because copy was not supplied."),
    source ? checked("CTA focus", ctas > 0 && ctas <= 3, "CTA count is focused.", ctas === 0 ? "Add one primary CTA before assessing focus." : "Reduce competing CTAs.") : unchecked("CTA focus", "Not checked because copy was not supplied."),
    headline ? checked("Headline clarity", headline.split(/\s+/u).length <= 12 && headline.length > 5, "Headline meets the plugin's 12-word house limit.", "Make the headline clear and no more than 12 words.") : unchecked("Headline clarity", "Not checked because a headline was not supplied."),
    fields === undefined ? unchecked("Form friction", "Not checked because form field count was not supplied.") : checked("Form friction", fields <= 5, "Form has low friction.", "Ask for fewer fields."),
    delay === undefined ? unchecked("Popup timing", "Not checked because popup timing was not supplied.") : checked("Popup timing", delay >= 10, "Popup is not immediate.", "Delay popup at least 10 seconds."),
  ];
  const scored = checks.filter(item => item.pass !== null);
  return { score: scored.length ? Math.round(scored.filter(item => item.pass).length / scored.length * 100) : null, checks, inputs: { formFields: fields ?? null, popupDelay: delay ?? null, ctaCount: source ? ctas : null }, limits: "Heuristic check only. It does not predict traffic or conversions." };
}
export function selectPageCopyVariant(input) { const variants = z.array(copy).min(2).max(3).parse(input.variants); if (input.selected === undefined) return { variants, selected: null, selectedIndex: null, approval: null, selectionRequired: true }; const selected = z.number().int().min(1).max(variants.length).parse(input.selected); if (input.selectionApproved !== true) throw Error("Selection requires explicit approval."); const b = input.brief ? brief.parse(input.brief) : { mustKeepFacts: [] }; const checked = validateCopy(variants[selected - 1], b); return { variants, selected: checked.copy, selectedIndex: selected, approval: { selectionApproved: true, selectedIndex: selected }, selectionRequired: false }; }
export function exportPageCopy(input) {
  if (input.selectionApproved === false) throw Error("Export requires an approved selection.");
  const b = input.brief ? brief.parse(input.brief) : { mustKeepFacts: [] }, c = validateCopy(input.copy, b).copy, format = z.enum(["markdown", "html"]).parse(input.format);
  const md = `# ${escapeMarkdown(c.headline)}\n\n${escapeMarkdown(c.subhead)}\n\n${c.valuePoints.map(item => `- ${escapeMarkdown(item)}`).join("\n")}\n\n## Proof\n\n${c.proof.length ? c.proof.map(item => `- ${escapeMarkdown(item)}`).join("\n") : "None supplied."}\n\n[${escapeMarkdown(c.primaryCta)}](#cta)\n\n## FAQ\n\n${c.faq.length ? c.faq.map(item => `### ${escapeMarkdown(item.question)}\n\n${escapeMarkdown(item.answer)}`).join("\n\n") : "None supplied."}\n`;
  const html = `<section><h1>${escapeHtml(c.headline)}</h1><p>${escapeHtml(c.subhead)}</p><ul>${c.valuePoints.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul><h2>Proof</h2>${c.proof.length ? `<ul>${c.proof.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "<p>None supplied.</p>"}<a href="#cta">${escapeHtml(c.primaryCta)}</a><h2>FAQ</h2>${c.faq.length ? c.faq.map(item => `<h3>${escapeHtml(item.question)}</h3><p>${escapeHtml(item.answer)}</p>`).join("") : "<p>None supplied.</p>"}</section>`;
  return { fileName: `landing-page-copy.${format === "html" ? "html" : "md"}`, mimeType: format === "html" ? "text/html" : "text/markdown", content: format === "html" ? html : md, retained: false };
}

const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
const defs = [
  ["open_page_brief", "Use this when you need a guided landing page copy brief. Do not use for fetching a URL or changing a site.", z.object({ prefill: z.record(z.string(), z.unknown()).optional() }).strict(), openPageBrief, "ui://landing-page-copy-check/brief-builder.html"],
  ["review_page_brief", "Use this when a completed page brief needs read-only confirmation. Do not use for drafting before approval.", brief, reviewPageBrief, "ui://landing-page-copy-check/brief-review.html"],
  ["draft_page_copy", "Use this when an approved brief and proposed copy need validation. Do not use for live-site changes.", z.object({ briefApproved: z.boolean(), brief, copy }).strict(), draftPageCopy, "ui://landing-page-copy-check/copy-comparison.html"],
  ["check_page_conversion", "Use this when pasted copy needs a deterministic conversion checklist. Do not use for traffic or conversion guarantees.", z.object({ copy: z.string().optional(), draft: copy.optional(), headline: z.string().optional(), formFieldCount: z.number().int().min(0).optional(), popupDelaySeconds: z.number().min(0).optional() }).strict(), checkPageConversion, "ui://landing-page-copy-check/conversion-report.html"],
  ["select_page_copy_variant", "Use this when choosing among two or three visible copy variants. Do not use for unapproved selection.", z.object({ variants: z.array(copy).min(2).max(3), selected: z.number().int().optional(), selectionApproved: z.boolean().optional(), brief: brief.optional() }).strict(), selectPageCopyVariant, "ui://landing-page-copy-check/copy-comparison.html"],
  ["export_page_copy", "Use this when approved page copy should be exported as Markdown or HTML. Do not use for publishing a live page.", z.object({ copy, format: z.enum(["markdown", "html"]), brief: brief.optional(), selectionApproved: z.boolean().optional() }).strict(), exportPageCopy, "ui://landing-page-copy-check/export-panel.html"],
];
let browserBundle;
function widget(file) { const html = readFileSync(path.join(ROOT, "widgets", file), "utf8"); if (!html.includes("/*__EXT_APPS_BUNDLE__*/")) return html; if (!browserBundle) { const source = readFileSync(createRequire(import.meta.url).resolve("@modelcontextprotocol/ext-apps/app-with-deps"), "utf8"); browserBundle = source.replace(/export\{([^}]+)\};?\s*$/s, (_, body) => `globalThis.ExtApps={${body.split(",").map(part => { const [local, exported] = part.split(" as ").map(item => item.trim()); return `${exported || local}:${local}`; }).join(",")}};`); } return html.replace("/*__EXT_APPS_BUNDLE__*/", browserBundle); }
const widgets = { "ui://landing-page-copy-check/brief-builder.html": "brief-builder.html", "ui://landing-page-copy-check/brief-review.html": "brief-review.html", "ui://landing-page-copy-check/conversion-report.html": "conversion-report.html", "ui://landing-page-copy-check/copy-comparison.html": "copy-comparison.html", "ui://landing-page-copy-check/export-panel.html": "export-panel.html" };
export function createPluginServer() { const server = new McpServer({ name: "landing-page-copy-check", version: "1.0.0" }); for (const [name, description, inputSchema, handler, uri] of defs) registerAppTool(server, name, { description, inputSchema, annotations, _meta: { ui: { resourceUri: uri } } }, async input => { try { return { content: [{ type: "text", text: `${name} completed.\n\n${ATTRIBUTION}` }], structuredContent: handler(input) }; } catch (error) { return { content: [{ type: "text", text: `Copy check error: ${clean(error.message)}\n\n${ATTRIBUTION}` }], isError: true }; } }); const csp = { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] }; for (const [uri, file] of Object.entries(widgets)) registerAppResource(server, `Landing Page Copy Check ${file}`, uri, { _meta: { ui: { prefersBorder: false, csp } } }, async () => ({ contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: widget(file), _meta: { ui: { prefersBorder: false, csp } } }] })); return server; }
export function createHttpServer() { return http.createServer(async (req, res) => { const pathname = new URL(req.url || "/", `http://127.0.0.1:${PORT}`).pathname; if (req.method === "GET" && ["/health", "/ready"].includes(pathname)) return res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ status: "ok", service: "landing-page-copy-check", version: "1.0.0", persistence: false, outbound_network: false })); if (pathname === "/" && req.method === "GET") { res.writeHead(200, { "content-type": "text/html" }); return res.end(existsSync(path.join(ROOT, "public/index.html")) ? readFileSync(path.join(ROOT, "public/index.html")) : "Landing Page Copy Check"); } if (pathname !== "/mcp" || req.method !== "POST") { res.writeHead(404); return res.end(); } const mcp = createPluginServer(), transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true }); res.on("close", () => { transport.close(); mcp.close(); }); try { await mcp.connect(transport); await transport.handleRequest(req, res); } catch { if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: "Internal server error" })); } }); }
if (process.argv[1] === fileURLToPath(import.meta.url)) createHttpServer().listen(PORT);
