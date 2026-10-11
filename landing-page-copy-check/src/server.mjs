#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8790);
const ATTRIBUTION = "Provided by ASTUDIO. For a human ASTUDIO team on this work: https://www.astudio.agency/tools/landing-page-copy-check";
const clean = value => String(value ?? "").trim();
const nonBlank = (min = 1) => z.string().trim().min(min);
const brief = z.object({ pageType: nonBlank(2), product: nonBlank(2), audience: nonBlank(2), offer: nonBlank(2), goal: nonBlank(2), tone: nonBlank(2), currentCopy: nonBlank().optional(), mustKeepFacts: z.array(nonBlank()).min(1).max(20) }).strict();
const copy = z.object({ headline: nonBlank(2), subhead: nonBlank(2), valuePoints: z.array(nonBlank()).min(3).max(5), proof: z.array(nonBlank()).min(1), primaryCta: nonBlank(2), faq: z.array(z.object({ question: nonBlank(), answer: nonBlank() }).strict()).default([]) }).strict();
const briefReceipt = z.object({ kind: z.literal("brief"), digest: z.string().length(64), signature: z.string().length(64) }).strict();
const selectionReceipt = z.object({ kind: z.literal("selection"), digest: z.string().length(64), selectedIndex: z.number().int().min(1).max(3), signature: z.string().length(64) }).strict();
const receipt = z.discriminatedUnion("kind", [briefReceipt, selectionReceipt]);
function receiptKey() { const value = process.env.APPROVAL_HMAC_KEY; if (!value || value.length < 32) throw Error("APPROVAL_HMAC_KEY must contain at least 32 characters."); return value; }
const performanceClaim = /(?:\bwe will (?:increase|double|triple|grow|boost|rank|deliver)\b|\bproven to\b|\bresults guaranteed\b|\bguaranteed\b|\bguarantee\b|\bindustry(?:-| )leading\b|\bbest(?:-| )in class\b|\bnumber one\b|(?<![\p{L}\p{N}])#1(?![\p{L}\p{N}])|\bworld-class\b|\bleading provider\b|\brank first\b|\bfirst page of google\b|(?<![\p{L}\p{N}])100%(?![\p{L}\p{N}])|\bincrease(?:s|d)?\s+[\p{L}\s-]{0,40}?\s+by\s+\d+(?:\.\d+)?\s*(?:%|percent)\b|\b\d+(?:\.\d+)?\s*(?:%|percent)\b|\b\d+(?:\.\d+)?\s*x\b|\bfake\b|\bfabricated\b|\binvented testimonial\b)/giu;

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function sign(value) { return createHmac("sha256", receiptKey()).update(JSON.stringify(value)).digest("hex"); }
function makeReceipt(kind, value, selectedIndex) { const unsigned = { kind, digest: digest(value), ...(selectedIndex !== undefined ? { selectedIndex } : {}) }; return { ...unsigned, signature: sign(unsigned) }; }
function verifyReceipt(value, kind, subject) { const parsed = receipt.parse(value); const unsigned = { kind: parsed.kind, digest: parsed.digest, ...(parsed.kind === "selection" ? { selectedIndex: parsed.selectedIndex } : {}) }; const expected = sign(unsigned); if (parsed.kind !== kind || parsed.digest !== digest(subject) || !timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(parsed.signature, "hex"))) throw Error(`A valid signed ${kind} receipt is required.`); return parsed; }
function hasWholeFact(haystack, fact) { const value = clean(fact); return value.length > 0 && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(value)}(?=$|[^\\p{L}\\p{N}])`, "iu").test(haystack); }
function bannedClaims(value) { performanceClaim.lastIndex = 0; const found = [...String(value).matchAll(performanceClaim)].map(match => match[0]); performanceClaim.lastIndex = 0; return found; }
const ctaVerb = /^(?:get|start|try|book|buy|join|see|learn|discover|request|download|contact|sign\s*up|subscribe|register|apply|claim|order|shop|schedule|talk|call|compare|choose|create|build|explore)\b/iu;
const explicitAsk = /^(?:(?:ready|want|need)\s+(?:to\s+)?(?:get|start|try|book|buy|join|see|learn|discover|request|download|contact|sign\s*up|subscribe|register|apply|claim|order|shop|schedule|talk|call|compare|choose|create|build|explore)|(?:want|need)\s+(?:a|an|the)?\s*(?:demo|trial|quote|consultation|call))\b/iu;
function countCtas(value) { return String(value).split(/[.!?\n]+/u).map(part => clean(part).replace(/^(?:(?:primary\s+)?cta\s*:\s*)/iu, "")).filter(part => ctaVerb.test(part) || explicitAsk.test(part)).length; }
function validateCopy(value, sourceBrief = { mustKeepFacts: [] }) {
  const parsed = copy.parse(value);
  if (clean(parsed.headline).split(/\s+/u).length > 12) throw Error("The Landing Page Copy Check house limit is 12 words for a headline.");
  const body = JSON.stringify(parsed);
  const allowed = sourceBrief.mustKeepFacts || [];
  const bannedFacts = allowed.filter(fact => bannedClaims(fact).length);
  if (bannedFacts.length) throw Error(`Remove banned claims from must-keep facts: ${bannedFacts.join(", ")}.`);
  const unsupportedProof = parsed.proof.filter(item => !allowed.some(fact => hasWholeFact(fact, item)));
  if (unsupportedProof.length) throw Error(`Remove unsupported proof: ${unsupportedProof.join(", ")}.`);
  const unsupported = bannedClaims(body);
  if (unsupported.length) throw Error(`Remove banned or unsupported claims: ${unsupported.join(", ")}.`);
  const missing = allowed.filter(fact => !hasWholeFact(body, fact));
  if (missing.length) throw Error(`Missing must-keep facts: ${missing.join(", ")}.`);
  return { copy: parsed, missing };
}
function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
function escapeMarkdown(value) { return String(value).replace(/([\\`*_{}[\]()#+.!|>-])/g, "\\$1"); }

export function openPageBrief(input = {}) { return { fields: ["pageType", "product", "audience", "offer", "goal", "tone", "currentCopy", "mustKeepFacts"], prefill: input.prefill || {}, privacyNotice: "This tool works on pasted text only. It does not fetch URLs or change sites." }; }
export function reviewPageBrief(input) { const value = brief.parse(input); const banned = bannedClaims(JSON.stringify({ currentCopy: value.currentCopy, mustKeepFacts: value.mustKeepFacts })); if (banned.length) throw Error(`Banned claim in brief: ${banned.join(", ")}.`); return { normalizedBrief: value, canApprove: true, confirmationRequired: true, message: "Review the visible brief, then use the Approve brief button to authorize drafting." }; }
export function approvePageBrief(input) { const value = brief.parse(input.brief); z.literal("approve").parse(input.approvalAction); return { approvalReceipt: makeReceipt("brief", value), approvedBrief: value }; }
export function draftPageCopy(input) { const b = brief.parse(input.brief); verifyReceipt(input.approvalReceipt, "brief", b); const proposed = z.array(copy).min(2).max(3).parse(input.variants); const signatures = new Set(proposed.map(item => digest(item))); if (signatures.size !== proposed.length) throw Error("Draft variants must be distinct."); const variants = proposed.map(item => { const checked = validateCopy(item, b); const report = checkPageConversion({ draft: checked.copy, headline: checked.copy.headline }); return { ...checked.copy, issues: report.issues, checklist: report.checks }; }); return { brief: b, variants, approvalReceipt: input.approvalReceipt, warnings: [] }; }
export function checkPageConversion(input) {
  input = conversionInput.parse(input);
  const source = clean(input.copy ?? (input.draft ? JSON.stringify(input.draft) : ""));
  if (input.formFieldCount !== undefined && (!Number.isInteger(input.formFieldCount) || input.formFieldCount < 0)) throw Error("Form field count must be a non-negative integer.");
  if (input.popupDelaySeconds !== undefined && (!Number.isFinite(input.popupDelaySeconds) || input.popupDelaySeconds < 0)) throw Error("Popup delay must be a non-negative number.");
  const fields = input.formFieldCount, delay = input.popupDelaySeconds;
  const headline = clean(input.headline ?? input.draft?.headline ?? (input.copy ? source.split("\n")[0] : ""));
  const ctas = input.draft ? countCtas(input.draft.primaryCta) : countCtas(source);
  const banned = bannedClaims(source);
  const headlineSpecific = headline.length > 5 && headline.split(/\s+/u).length <= 12 && !/^(?:better|simpler|smarter|more|do more|your solution|welcome|transform your business)\b/iu.test(headline) && /\b(?:tool|platform|software|app|service|product|schedule|scheduling|team|work|page|conversion|demo|trial|sales|marketing|[A-Z][\p{L}\p{N}-]{2,})\b/u.test(headline);
  const checked = (name, pass, passDetail, failDetail) => ({ name, status: pass ? "pass" : "finding", pass, detail: pass ? passDetail : failDetail });
  const unchecked = (name, detail) => ({ name, status: "not checked", pass: null, detail });
  const checks = [
    source ? checked("CTA presence", ctas > 0, `${ctas} CTA phrase(s) found.`, "Add one primary CTA.") : unchecked("CTA presence", "Not checked because copy was not supplied."),
    source ? checked("CTA focus", ctas === 1, "Exactly one primary CTA found.", ctas === 0 ? "Add one primary CTA before assessing focus." : "Use exactly one primary CTA.") : unchecked("CTA focus", "Not checked because copy was not supplied."),
    headline ? checked("Headline clarity", headlineSpecific, "Headline names a product or concrete outcome.", "Name the product or a concrete outcome; avoid vague wording and keep it within 12 words.") : unchecked("Headline clarity", "Not checked because a headline was not supplied."),
    fields === undefined ? unchecked("Form friction", "Not checked because form field count was not supplied.") : checked("Form friction", fields <= 5, "Form has low friction.", "Ask for fewer fields."),
    delay === undefined ? unchecked("Popup timing", "Not checked because popup timing was not supplied.") : checked("Popup timing", delay >= 10, "Popup is not immediate.", "Delay popup at least 10 seconds."),
  ];
  if (source) checks.push(checked("Banned claims", banned.length === 0, "No banned claims found.", `Remove banned claims: ${banned.join(", ")}.`));
  const scored = checks.filter(item => item.pass !== null);
  const rawScore = scored.length ? Math.round(scored.filter(item => item.pass).length / scored.length * 100) : null;
  return { score: rawScore === null ? null : banned.length ? Math.min(rawScore, 40) : rawScore, checks, issues: banned.map(claim => `Banned claim: ${claim}`), inputs: { formFields: fields ?? null, popupDelay: delay ?? null, ctaCount: source ? ctas : null }, limits: "Heuristic check only. It does not predict traffic or conversions." };
}
export function selectPageCopyVariant(input) { const variants = z.array(copy).min(2).max(3).parse(input.variants); const b = brief.parse(input.brief); const checked = variants.map(item => validateCopy(item, b)); const selected = z.number().int().min(1).max(variants.length).parse(input.selected); const chosen = checked[selected - 1]; return { variants: checked.map(item => item.copy), selected: chosen.copy, selectedIndex: selected, selectionReceipt: makeReceipt("selection", chosen.copy, selected), brief: b, factCheck: { missing: chosen.missing }, selectionRequired: false }; }
export function exportPageCopy(input) {
  if (!input.selectionReceipt) throw Error("A signed selection receipt is required for export.");
  const b = brief.parse(input.brief), checked = validateCopy(input.copy, b), c = checked.copy, format = z.enum(["markdown", "html"]).parse(input.format);
  verifyReceipt(input.selectionReceipt, "selection", c);
  const md = `# ${escapeMarkdown(c.headline)}\n\n${escapeMarkdown(c.subhead)}\n\n${c.valuePoints.map(item => `- ${escapeMarkdown(item)}`).join("\n")}\n\n## Proof\n\n${c.proof.length ? c.proof.map(item => `- ${escapeMarkdown(item)}`).join("\n") : "None supplied."}\n\n[${escapeMarkdown(c.primaryCta)}](#cta)\n\n## FAQ\n\n${c.faq.length ? c.faq.map(item => `### ${escapeMarkdown(item.question)}\n\n${escapeMarkdown(item.answer)}`).join("\n\n") : "None supplied."}\n`;
  const html = `<section><h1>${escapeHtml(c.headline)}</h1><p>${escapeHtml(c.subhead)}</p><ul>${c.valuePoints.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul><h2>Proof</h2>${c.proof.length ? `<ul>${c.proof.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "<p>None supplied.</p>"}<a href="#cta">${escapeHtml(c.primaryCta)}</a><h2>FAQ</h2>${c.faq.length ? c.faq.map(item => `<h3>${escapeHtml(item.question)}</h3><p>${escapeHtml(item.answer)}</p>`).join("") : "<p>None supplied.</p>"}</section>`;
  return { fileName: `landing-page-copy.${format === "html" ? "html" : "md"}`, mimeType: format === "html" ? "text/html" : "text/markdown", content: format === "html" ? html : md, retained: false, factCheck: { kept: b.mustKeepFacts.filter(item => !checked.missing.includes(item)), missing: checked.missing }, warnings: checked.missing.length ? ["Some must-keep facts are absent."] : [] };
}

const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
const openOutput = { fields: z.array(z.string()), prefill: z.record(z.string(), z.unknown()), privacyNotice: z.string() };
const reviewOutput = { normalizedBrief: brief, canApprove: z.boolean(), confirmationRequired: z.boolean(), message: z.string() };
const factCheck = z.object({ kept: z.array(z.string()).optional(), missing: z.array(z.string()) }).strict();
const checklistItem = z.object({ name: z.string(), status: z.string(), pass: z.boolean().nullable(), detail: z.string() });
const draftVariant = copy.extend({ issues: z.array(z.string()), checklist: z.array(checklistItem) });
const conversionInput = z.object({ copy: z.string().optional(), draft: copy.optional(), headline: z.string().optional(), formFieldCount: z.number().int().min(0).optional(), popupDelaySeconds: z.number().min(0).optional() }).strict().superRefine((value, context) => { if ((value.copy === undefined) === (value.draft === undefined)) context.addIssue({ code: "custom", message: "Provide exactly one of copy or draft." }); });
const defs = [
  ["open_page_brief", "Use this when you need a guided landing page copy brief. Do not use for fetching a URL or changing a site.", z.object({ prefill: z.record(z.string(), z.unknown()).optional() }).strict(), openOutput, openPageBrief, "ui://landing-page-copy-check/brief-builder.html"],
  ["review_page_brief", "Use this when a completed page brief needs read-only confirmation. Do not use for drafting before approval.", brief, reviewOutput, reviewPageBrief, "ui://landing-page-copy-check/brief-review.html"],
  ["approve_page_brief", "Use this when the person clicks Approve brief in the review app to issue a signed, brief-bound receipt. Do not use for conversational or inferred approval.", z.object({ brief, approvalAction: z.literal("approve") }).strict(), { approvalReceipt: briefReceipt, approvedBrief: brief }, approvePageBrief, "ui://landing-page-copy-check/brief-review.html", true],
  ["draft_page_copy", "Use this when a signed approval receipt and two or three distinct proposed variants need validation and comparison. Do not use for drafting before approval or for live-site changes.", z.object({ approvalReceipt: briefReceipt, brief, variants: z.array(copy).min(2).max(3) }).strict(), { brief, variants: z.array(draftVariant).min(2).max(3), approvalReceipt: briefReceipt, warnings: z.array(z.string()) }, draftPageCopy, "ui://landing-page-copy-check/copy-comparison.html"],
  ["check_page_conversion", "Use this when pasted copy needs a deterministic conversion checklist. Do not use for traffic or conversion guarantees.", conversionInput, { score: z.number().nullable(), checks: z.array(z.object({ name: z.string(), status: z.string(), pass: z.boolean().nullable(), detail: z.string() })), issues: z.array(z.string()), inputs: z.object({ formFields: z.number().nullable(), popupDelay: z.number().nullable(), ctaCount: z.number().nullable() }), limits: z.string() }, checkPageConversion, "ui://landing-page-copy-check/conversion-report.html"],
  ["select_page_copy_variant", "Use this when the person clicks Select on one of two or three visible variants in the comparison app. Do not use for conversational or inferred selection.", z.object({ variants: z.array(copy).min(2).max(3), selected: z.number().int(), brief }).strict(), { variants: z.array(copy), selected: copy, selectedIndex: z.number(), selectionReceipt, brief, factCheck, selectionRequired: z.literal(false) }, selectPageCopyVariant, "ui://landing-page-copy-check/copy-comparison.html", true],
  ["export_page_copy", "Use this when selected page copy should be exported as Markdown or HTML. Do not use for publishing a live page.", z.object({ copy, format: z.enum(["markdown", "html"]), brief, selectionReceipt: receipt }).strict(), { fileName: z.string(), mimeType: z.string(), content: z.string(), retained: z.literal(false), factCheck, warnings: z.array(z.string()) }, exportPageCopy, "ui://landing-page-copy-check/export-panel.html", true],
];
let browserBundle;
function widget(file) { const html = readFileSync(path.join(ROOT, "widgets", file), "utf8"); if (!html.includes("/*__EXT_APPS_BUNDLE__*/")) return html; if (!browserBundle) { const source = readFileSync(createRequire(import.meta.url).resolve("@modelcontextprotocol/ext-apps/app-with-deps"), "utf8"); browserBundle = source.replace(/export\{([^}]+)\};?\s*$/s, (_, body) => `globalThis.ExtApps={${body.split(",").map(part => { const [local, exported] = part.split(" as ").map(item => item.trim()); return `${exported || local}:${local}`; }).join(",")}};`); } return html.replace("/*__EXT_APPS_BUNDLE__*/", () => browserBundle); }
const widgets = { "ui://landing-page-copy-check/brief-builder.html": "brief-builder.html", "ui://landing-page-copy-check/brief-review.html": "brief-review.html", "ui://landing-page-copy-check/conversion-report.html": "conversion-report.html", "ui://landing-page-copy-check/copy-comparison.html": "copy-comparison.html", "ui://landing-page-copy-check/export-panel.html": "export-panel.html" };
export function createPluginServer() { const server = new McpServer({ name: "landing-page-copy-check", version: "1.0.0" }); server.createToolError = message => ({ content: [{ type: "text", text: `${message}\n\n${ATTRIBUTION}` }], isError: true }); for (const [name, description, inputSchema, outputSchema, handler, uri, appOnly] of defs) registerAppTool(server, name, { description, inputSchema, outputSchema, annotations, _meta: { ui: { resourceUri: uri, ...(appOnly ? { visibility: ["app"] } : {}) } } }, async input => { try { return { content: [{ type: "text", text: `${name} completed.\n\n${ATTRIBUTION}` }], structuredContent: handler(input) }; } catch (error) { return { content: [{ type: "text", text: `Copy check error: ${clean(error.message)}\n\n${ATTRIBUTION}` }], isError: true }; } }); const csp = { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] }; for (const [uri, file] of Object.entries(widgets)) registerAppResource(server, `Landing Page Copy Check ${file}`, uri, { _meta: { ui: { prefersBorder: false, csp } } }, async () => ({ contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: widget(file), _meta: { ui: { prefersBorder: false, csp } } }] })); return server; }
function readJsonBody(req, res) { return new Promise((resolve, reject) => { let size = 0, chunks = [], settled = false; req.on("data", chunk => { size += chunk.length; if (size > 256 * 1024 && !settled) { settled = true; res.writeHead(413, { "content-type": "application/json", connection: "close" }).end(JSON.stringify({ error: "Request body too large." })); req.destroy(); reject(Object.assign(Error("Request body too large."), { handled: true })); return; } chunks.push(chunk); }); req.on("end", () => { if (settled) return; try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (error) { reject(error); } }); req.on("error", error => { if (!settled) reject(error); }); }); }
function attributeErrorResponse(res) { const originalEnd = res.end; res.end = function (chunk, encoding, callback) { try { if (chunk) { const parsed = JSON.parse(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk)); const result = parsed?.result; if (result?.isError && Array.isArray(result.content)) { const last = result.content.filter(item => item?.type === "text").at(-1); if (last && !last.text.endsWith(ATTRIBUTION)) last.text = `${last.text.trimEnd()}\n\n${ATTRIBUTION}`; chunk = JSON.stringify(parsed); res.removeHeader("content-length"); } } } catch {} return originalEnd.call(this, chunk, encoding, callback); }; }
export function createHttpServer() { return http.createServer(async (req, res) => { try { const pathname = new URL(req.url || "/", `http://127.0.0.1:${PORT}`).pathname; if (req.method === "GET" && ["/health", "/ready"].includes(pathname)) return res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ status: "ok", service: "landing-page-copy-check", version: "1.0.0", persistence: false, outbound_network: false })); if (pathname === "/" && req.method === "GET") { res.writeHead(200, { "content-type": "text/html" }); return res.end(existsSync(path.join(ROOT, "public/index.html")) ? readFileSync(path.join(ROOT, "public/index.html")) : "Landing Page Copy Check"); } if (pathname !== "/mcp" || req.method !== "POST") { res.writeHead(404); return res.end(); } const body = await readJsonBody(req, res); attributeErrorResponse(res); const mcp = createPluginServer(), transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true }); res.on("close", () => { transport.close(); mcp.close(); }); await mcp.connect(transport); await transport.handleRequest(req, res, body); } catch (error) { if (!error?.handled && !res.headersSent) res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: `Invalid request. ${ATTRIBUTION}` })); } }); }
if (process.argv[1] === fileURLToPath(import.meta.url)) createHttpServer().listen(PORT);
