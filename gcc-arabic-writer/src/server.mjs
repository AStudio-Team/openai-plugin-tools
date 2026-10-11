#!/usr/bin/env node
import http from "node:http";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { closedUiMeta, loadWidget } from "./widget-support.mjs";

const PORT = Number(process.env.PORT || 8789);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 128 * 1024);
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_CLIENT = Number(process.env.RATE_LIMIT_PER_CLIENT || 60);
const RATE_LIMIT_GLOBAL = Number(process.env.RATE_LIMIT_GLOBAL || 600);
const MAX_RATE_BUCKETS = Number(process.env.MAX_RATE_BUCKETS || 2000);
const ALLOWED_HOSTS = new Set((process.env.ALLOWED_HOSTS || "127.0.0.1,localhost,www.astudio.agency,astudio.agency").split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
const rateBuckets = new Map();
const rateCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(key);
}, RATE_WINDOW_MS);
rateCleanup.unref();
const MARKETS = ["pan-arab", "uae", "saudi-arabia", "kuwait", "qatar", "bahrain", "oman"];
const REGISTERS = ["msa", "formal", "luxury", "warm", "playful", "authoritative", "heritage", "modern", "dialect-sensitive"];
const TASKS = ["write", "rewrite", "localize", "proofread", "tagline", "caption", "product-description", "website", "press-release", "video-script", "business-copy"];
const ARABIC_LETTER = /[\u0621-\u063A\u0641-\u064A]/u;
const ARABIC_MARK = /[\u064B-\u065F\u0670\u06D6-\u06ED]/u;
const NUMERAL_MAP = new Map([..."٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹"].map((character, index) => [character, String(index % 10)]));
const STOCK_CALQUES = ["حيث تلتقي الفخامة ب", "يعيد تعريف", "تجربة لا مثيل لها", "الارتقاء بتجربتك"];
const SUPERLATIVES = ["الأفضل", "الأرقى", "الأول", "الأكبر", "الأسرع", "لا مثيل له", "لا مثيل لها"];
const RELIGIOUS_SALES = ["بركة مضمونة", "ثواب", "أجر مضاعف", "بإرادة الله اشتر", "حلال معتمد", "متوافق مع الشريعة"];
const DIALECT_MARKERS = {
  uae: ["شو", "رمسة"],
  "saudi-arabia": ["وش", "مرّة", "أبشر"],
  kuwait: ["هالسالفة"],
  qatar: [],
  bahrain: ["شخبار"],
  oman: ["موه"],
};
const SHARED_GULF_MARKERS = ["وايد", "واجد", "شلون"];
const BRIEF_WIDGET_URI = "ui://gcc-arabic-writer/brief-builder.html";
const REVIEW_WIDGET_URI = "ui://gcc-arabic-writer/copy-review.html";
const briefWidgetHtml = loadWidget("../widgets/brief-builder.html");
const reviewWidgetHtml = loadWidget("../widgets/copy-review.html");

function utf8Bytes(value) {
  return Buffer.byteLength(String(value || ""), "utf8");
}

function normalizeText(value) {
  return String(value || "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableObject(value[key])]));
  return value;
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(stableObject(value))).digest("hex");
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeLiteral(value) {
  return String(value || "").normalize("NFC").trim();
}

function normalizeNumerals(value) {
  return String(value).replace(/[٠-٩۰-۹]/g, character => NUMERAL_MAP.get(character)).replace(/٫/g, ".").replace(/٬/g, ",").replace(/٪/g, "%");
}

function extractFacts(text) {
  const normalized = normalizeText(text);
  const numberPattern = /(?<![\p{L}\p{N}])[+\-]?[0-9٠-٩۰-۹]+(?:[.,٬٫][0-9٠-٩۰-۹]+)*(?![\p{L}\p{N}])/gu;
  const urls = normalized.match(/https?:\/\/[^\s<>{}\[\]"']+/giu) || [];
  const dates = normalized.match(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b|[٠-٩۰-۹]{1,4}[-/][٠-٩۰-۹]{1,2}[-/][٠-٩۰-۹]{1,4}/gu) || [];
  const percentages = normalized.match(/[0-9٠-٩۰-۹]+(?:[.,٫][0-9٠-٩۰-۹]+)?\s*(?:%|٪)/gu) || [];
  const currencyOrQuantity = normalized.match(/(?:\b(?:AED|SAR|QAR|KWD|BHD|OMR|USD|EUR)\s*[0-9٠-٩۰-۹.,٬٫]+|[0-9٠-٩۰-۹.,٬٫]+\s*(?:AED|SAR|QAR|KWD|BHD|OMR|USD|EUR|درهم|ريال|دولار|دينار|ر\.س|مل|ملل|لتر|غ|كغ|جرام|كيلوغرام|متر|سم|مم|قطعة|حبة))/giu) || [];
  const canonical = values => unique(values.map(value => normalizeNumerals(value).replace(/\s+/g, " ").trim().replace(/[.,;:!?،؛]+$/u, "").toLowerCase()));
  return {
    numbers: canonical(normalized.match(numberPattern) || []),
    dates: canonical(dates),
    percentages: canonical(percentages),
    currency_quantities: canonical(currencyOrQuantity),
    urls: unique(urls.map(value => value.replace(/[.,;:!?،؛]+$/u, ""))),
  };
}

function includesLiteral(text, literal) {
  return String(text).normalize("NFC").includes(normalizeLiteral(literal));
}

export function prepareBrief(input) {
  const sourceText = String(input.source_text || "");
  const facts = unique((input.mandatory_facts || []).map(normalizeText).filter(Boolean));
  const protectedLiterals = unique((input.protected_literals || []).map(normalizeLiteral).filter(Boolean));
  const market = input.market || "pan-arab";
  const dialectRequested = Boolean(input.dialect_requested);
  const register = input.register || "msa";
  const normalized = {
    task: input.task,
    market,
    audience: normalizeText(input.audience || "general audience"),
    surface: normalizeText(input.surface || "unspecified surface"),
    register,
    dialect_requested: dialectRequested,
    language_policy: dialectRequested ? "dialect-sensitive, MSA-led" : "Modern Standard Arabic",
    key_message: normalizeText(input.key_message || ""),
    source_text: sourceText,
    mandatory_facts: facts,
    protected_literals: protectedLiterals,
    constraints: unique((input.constraints || []).map(normalizeText).filter(Boolean)),
    fact_policy: "Use only user-provided or independently verified facts. Do not add claims.",
    market_policy: market === "pan-arab" ? "Use neutral contemporary MSA without country-specific dialect markers." : `Adapt for ${market} through context and cadence. Keep MSA unless dialect was explicitly requested.`,
    native_review_required: dialectRequested || register === "dialect-sensitive",
  };
  return { ...normalized, fingerprint: fingerprint(normalized) };
}

export function checkFidelity(input) {
  const source = normalizeText(input.source_text);
  const candidate = normalizeText(input.candidate_text);
  const sourceFacts = extractFacts(source);
  const candidateFacts = extractFacts(candidate);
  const missing = [];
  for (const [category, values] of Object.entries(sourceFacts)) {
    for (const value of values) if (!candidateFacts[category].includes(value)) missing.push({ category, literal: value });
  }
  for (const literal of unique((input.protected_literals || []).map(normalizeLiteral).filter(Boolean))) {
    if (!includesLiteral(candidate, literal)) missing.push({ category: "protected_literal", literal });
  }
  for (const literal of unique((input.mandatory_facts || []).map(normalizeLiteral).filter(Boolean))) {
    if (!includesLiteral(candidate, literal)) missing.push({ category: "mandatory_fact_literal", literal });
  }
  const extraNumericClaims = candidateFacts.numbers.filter(value => !sourceFacts.numbers.includes(value));
  return {
    preservation_passed: missing.length === 0 && extraNumericClaims.length === 0,
    missing_facts: missing,
    extra_numeric_claims: extraNumericClaims,
    compared: {
      source: sourceFacts,
      candidate: candidateFacts,
      protected_literals: unique(input.protected_literals || []),
      mandatory_fact_literals: unique(input.mandatory_facts || []),
    },
    scope_note: "This deterministic check tests literal preservation and extra numeric claims. It does not verify whether any statement is true.",
  };
}

function words(text) {
  return normalizeText(text).split(/\s+/u).filter(Boolean);
}

export function lintCopy(input) {
  const text = normalizeText(input.text);
  const issues = [];
  const add = (rule, severity, message, matches = []) => issues.push({ rule, severity, message, matches: unique(matches) });
  if (text.includes("\u2014")) add("em-dash", "error", "Replace em dash punctuation with punctuation natural to the sentence.", ["\u2014"]);
  const calques = STOCK_CALQUES.filter(phrase => text.includes(phrase));
  if (calques.length) add("stock-calque", "warning", "Rewrite stock translated phrasing around a concrete idea.", calques);
  const approved = input.approved_claims || [];
  const unsupported = SUPERLATIVES.filter(phrase => text.includes(phrase) && !approved.some(claim => normalizeText(claim).includes(phrase)));
  if (unsupported.length) add("unsupported-superlative", "error", "Remove or substantiate superlative claims.", unsupported);
  const religious = RELIGIOUS_SALES.filter(phrase => text.includes(phrase));
  if (religious.length) add("religious-sales-risk", "error", "Do not use religious language or endorsements as sales claims.", religious);
  const arabicTokens = new Set(text.match(/[\u0621-\u063A\u0641-\u064A\u064B-\u065F\u0670]+/gu) || []);
  const markerMarkets = Object.entries(DIALECT_MARKERS).filter(([, markers]) => markers.some(marker => arabicTokens.has(marker))).map(([market]) => market);
  const marketMarkers = Object.entries(DIALECT_MARKERS).flatMap(([market, markers]) => markers.filter(marker => arabicTokens.has(marker)).map(marker => `${market}:${marker}`));
  const sharedMarkers = SHARED_GULF_MARKERS.filter(marker => arabicTokens.has(marker)).map(marker => `shared-gulf:${marker}`);
  const allMarkers = unique([...marketMarkers, ...sharedMarkers]);
  if (!input.dialect_approved && allMarkers.length) add("unapproved-dialect-marker", "warning", "Dialect markers require explicit approval and native-market review.", allMarkers);
  if (markerMarkets.length > 1) add("mixed-dialect-markers", "error", "Markers associated with multiple GCC markets were detected by a limited heuristic.", markerMarkets);
  if (input.market !== "pan-arab" && markerMarkets.some(market => market !== input.market)) add("market-marker-mismatch", "warning", "A heuristic marker does not match the selected market.", markerMarkets.filter(market => market !== input.market));
  const arabicWords = words(text).filter(word => ARABIC_LETTER.test(word));
  const markedWords = arabicWords.filter(word => ARABIC_MARK.test(word));
  if (markedWords.length > 0 && markedWords.length < arabicWords.length) add("partial-diacritics", "warning", "Use diacritics consistently or remove unnecessary partial diacritics.", markedWords.slice(0, 10));
  const count = words(text).length;
  if (input.min_words !== undefined && count < input.min_words) add("minimum-length", "warning", `Copy has ${count} words, below the requested minimum of ${input.min_words}.`);
  if (input.max_words !== undefined && count > input.max_words) add("maximum-length", "warning", `Copy has ${count} words, above the requested maximum of ${input.max_words}.`);
  const letters = [...text].filter(character => /\p{L}/u.test(character));
  const arabicLetters = letters.filter(character => ARABIC_LETTER.test(character));
  const ratio = letters.length ? arabicLetters.length / letters.length : 0;
  if (ratio < input.minimum_arabic_ratio) add("arabic-script-ratio", "warning", `Arabic-script ratio ${ratio.toFixed(3)} is below ${input.minimum_arabic_ratio.toFixed(3)}.`);
  return {
    passed: !issues.some(issue => issue.severity === "error"),
    issues,
    metrics: { utf8_bytes: utf8Bytes(text), words: count, arabic_script_ratio: Number(ratio.toFixed(3)) },
    scope_note: "This transparent rule-based lint is not native-speaker certification, legal clearance or proof of cultural suitability.",
  };
}

const shortText = z.string().max(500);
const text12000 = z.string().min(1).max(12000);
const stringList = z.array(z.string().min(1).max(500)).max(50).default([]);
const factSetSchema = z.object({
  numbers: z.array(z.string()),
  dates: z.array(z.string()),
  percentages: z.array(z.string()),
  currency_quantities: z.array(z.string()),
  urls: z.array(z.string()),
}).strict();
const briefOutputSchema = {
  task: z.enum(TASKS),
  market: z.enum(MARKETS),
  audience: z.string(),
  surface: z.string(),
  register: z.enum(REGISTERS),
  dialect_requested: z.boolean(),
  language_policy: z.string(),
  key_message: z.string(),
  source_text: z.string(),
  mandatory_facts: z.array(z.string()),
  protected_literals: z.array(z.string()),
  constraints: z.array(z.string()),
  fact_policy: z.string(),
  market_policy: z.string(),
  native_review_required: z.boolean(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
};
const fidelityOutputSchema = {
  preservation_passed: z.boolean(),
  missing_facts: z.array(z.object({ category: z.string(), literal: z.string() }).strict()),
  extra_numeric_claims: z.array(z.string()),
  compared: z.object({
    source: factSetSchema,
    candidate: factSetSchema,
    protected_literals: z.array(z.string()),
    mandatory_fact_literals: z.array(z.string()),
  }).strict(),
  scope_note: z.string(),
};
const lintOutputSchema = {
  passed: z.boolean(),
  issues: z.array(z.object({
    rule: z.string(),
    severity: z.enum(["error", "warning"]),
    message: z.string(),
    matches: z.array(z.string()),
  }).strict()),
  metrics: z.object({
    utf8_bytes: z.number().int().nonnegative(),
    words: z.number().int().nonnegative(),
    arabic_script_ratio: z.number().min(0).max(1),
  }).strict(),
  scope_note: z.string(),
};

export function createPluginServer() {
  const server = new McpServer({ name: "gcc-arabic-writer", version: "1.1.0" });
  registerAppTool(server, "prepare_gcc_arabic_brief", {
    title: "Prepare a GCC Arabic writing brief",
    description: "Use this when preparing Arabic copywriting, rewriting or GCC localization. It normalizes only the supplied brief, defaults to MSA, protects literals and opens a focused review form when widgets are supported. The user must explicitly send the reviewed brief before ChatGPT writes. It does not generate copy or research facts.",
    inputSchema: z.object({
      task: z.enum(TASKS).describe("Requested Arabic writing deliverable."),
      market: z.enum(MARKETS).default("pan-arab").describe("Target GCC market or pan-Arab audience."),
      audience: shortText.optional().describe("Intended audience, if known."),
      surface: shortText.optional().describe("Where the copy will appear, such as a caption or product page."),
      register: z.enum(REGISTERS).default("msa").describe("Requested register. MSA is the default."),
      dialect_requested: z.boolean().default(false).describe("True only when the user explicitly requested dialect."),
      key_message: z.string().max(2000).optional().describe("The single main message the copy should communicate."),
      source_text: z.string().max(12000).optional().describe("Optional source copy to rewrite or localize."),
      mandatory_facts: stringList.describe("User-provided or verified facts that must be retained."),
      protected_literals: stringList.describe("Names, URLs, prices or exact strings that must remain unchanged."),
      constraints: stringList.describe("Additional user-provided constraints."),
    }).strict(),
    outputSchema: briefOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    _meta: { ui: { resourceUri: BRIEF_WIDGET_URI } },
  }, async input => briefResult(prepareBrief(input)));

  registerAppTool(server, "check_arabic_factual_fidelity", {
    title: "Check Arabic factual fidelity",
    description: "Use this when checking whether rewritten or localized Arabic copy preserved source numbers, dates, percentages, currency or quantity literals, URLs and protected literals. It flags missing facts and extra numeric claims but does not verify truth.",
    inputSchema: z.object({
      source_text: text12000.describe("Authoritative user-provided source text."),
      candidate_text: text12000.describe("Arabic draft to compare with the source."),
      mandatory_facts: stringList.describe("Caller-supplied fact strings that must appear literally in the candidate."),
      protected_literals: stringList.describe("Additional exact strings that must remain present."),
    }).strict(),
    outputSchema: fidelityOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    _meta: { ui: { resourceUri: REVIEW_WIDGET_URI } },
  }, async input => fidelityResult(checkFidelity(input)));

  registerAppTool(server, "lint_gcc_arabic_copy", {
    title: "Lint GCC Arabic copy",
    description: "Use this when reviewing Arabic marketing or business copy for transparent style and safety rules. It checks punctuation, stock calques, unsupported superlatives, religious sales risk, dialect-marker heuristics, partial diacritics, length and Arabic-script ratio. It never certifies native, legal or cultural quality.",
    inputSchema: z.object({
      text: text12000.describe("Arabic copy to lint."),
      market: z.enum(MARKETS).default("pan-arab").describe("Intended market."),
      dialect_approved: z.boolean().default(false).describe("True only if dialect was explicitly requested and approved."),
      approved_claims: stringList.describe("Exact user-provided or verified claims allowed in the copy."),
      min_words: z.number().int().min(1).max(2000).optional().describe("Optional minimum word count."),
      max_words: z.number().int().min(1).max(2000).optional().describe("Optional maximum word count."),
      minimum_arabic_ratio: z.number().min(0).max(1).default(0.6).describe("Minimum ratio of Arabic letters among all letters."),
    }).strict(),
    outputSchema: lintOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    _meta: { ui: { resourceUri: REVIEW_WIDGET_URI } },
  }, async input => lintResult(lintCopy(input)));

  registerWidgetResource(server, "GCC Arabic brief builder", BRIEF_WIDGET_URI, briefWidgetHtml);
  registerWidgetResource(server, "GCC Arabic copy review", REVIEW_WIDGET_URI, reviewWidgetHtml);
  return server;
}

function registerWidgetResource(server, name, uri, html) {
  registerAppResource(server, name, uri, {
    description: `${name} interactive MCP App`,
    _meta: { ui: closedUiMeta },
  }, async () => ({
    contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: html, _meta: { ui: closedUiMeta } }],
  }));
}

const ATTRIBUTION = "Provided by ASTUDIO. For a human ASTUDIO team on this work: https://www.astudio.agency/tools/gcc-arabic-writer";
function withAttribution(text) { return `${text}\n\n${ATTRIBUTION}`; }
function toolResult(text, structuredContent) {
  return { content: [{ type: "text", text: withAttribution(text) }], structuredContent };
}

function briefResult(brief) {
  const review = brief.native_review_required ? " Native-market review is required before publication because dialect-sensitive writing was requested." : " MSA remains the default.";
  const text = [
    `Brief prepared for ${brief.task} in ${brief.market}.`,
    `Audience: ${brief.audience}.`,
    `Surface: ${brief.surface}. Register: ${brief.register}.`,
    `Key message: ${brief.key_message || "Not supplied"}.`,
    `Source text (immutable at approval): ${brief.source_text || "Not supplied"}.`,
    `Mandatory facts: ${brief.mandatory_facts.length ? brief.mandatory_facts.join(" | ") : "None supplied"}.`,
    `Protected literals: ${brief.protected_literals.length ? brief.protected_literals.join(" | ") : "None supplied"}.`,
    `Constraints: ${brief.constraints.length ? brief.constraints.join(" | ") : "None supplied"}.`,
    `Review or edit this brief, then explicitly send the reviewed brief into chat before copy is generated.${review}`,
  ].join("\n");
  return toolResult(text, brief);
}

function fidelityResult(checked) {
  const text = checked.preservation_passed
    ? "Factual fidelity check passed for the deterministic literals and numeric claims tested. Ask for a revision if the copy still needs changes. This check does not verify whether statements are true."
    : `Factual fidelity check requires revision. Missing items: ${checked.missing_facts.map(item => `${item.category}: ${item.literal}`).join(" | ") || "none"}. Extra numeric claims: ${checked.extra_numeric_claims.join(" | ") || "none"}. Ask ChatGPT to revise before treating the copy as final.`;
  return toolResult(text, checked);
}

function lintResult(checked) {
  const findings = checked.issues.map(issue => `${issue.severity}: ${issue.message}${issue.matches.length ? ` (${issue.matches.join(", ")})` : ""}`);
  const text = `${checked.passed ? "Arabic copy lint found no blocking errors." : "Arabic copy lint found blocking errors."} ${findings.length ? findings.join(" | ") : "No deterministic issues were reported."} Ask for a revision or confirm the current option. Automated lint does not replace native-market, legal or cultural review.`;
  return toolResult(text, checked);
}

function logRequest(tool, status, startedAt, inputBytes = 0, ruleCount = 0) {
  console.log(JSON.stringify({ tool, status, latency_ms: Date.now() - startedAt, input_bytes: inputBytes, rule_count: ruleCount }));
}

function hostAllowed(req) {
  const host = String(req.headers.host || "").split(":")[0].toLowerCase();
  return ALLOWED_HOSTS.has(host);
}

export function consumeRateLimit(req) {
  const now = Date.now();
  const consume = (key, limit) => {
    const current = rateBuckets.get(key);
    if (!current || current.resetAt <= now) {
      if (rateBuckets.size >= MAX_RATE_BUCKETS) return false;
      rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
      return true;
    }
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  };
  if (!consume("global", RATE_LIMIT_GLOBAL)) return false;
  const client = String(req.headers["x-plugin-client-ip"] || req.socket.remoteAddress || "unknown").trim().slice(0, 80);
  if (!consume(`client:${client}`, RATE_LIMIT_PER_CLIENT)) return false;
  return true;
}

async function readJsonBody(req) {
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > MAX_BODY_BYTES) throw Object.assign(new Error("Request body exceeds the limit."), { statusCode: 413 });
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw Object.assign(new Error("Request body exceeds the limit."), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON request body."), { statusCode: 400 });
  }
}

export function createHttpServer() {
  return http.createServer(async (req, res) => {
    const startedAt = Date.now();
    if (!req.url || !hostAllowed(req)) return res.writeHead(421).end("Misdirected Request");
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (req.method === "GET" && ["/health", "/ready"].includes(url.pathname)) {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ status: "ok", service: "gcc-arabic-writer", version: "1.1.0", persistence: false, outbound_network: false }));
      return;
    }
    if (req.method === "OPTIONS" && url.pathname === "/mcp") {
      res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-expose-headers": "Mcp-Session-Id" }).end();
      return;
    }
    if (url.pathname === "/mcp" && ["GET", "DELETE"].includes(req.method || "")) {
      res.writeHead(405, { allow: "POST, OPTIONS", "cache-control": "no-store" }).end("Method Not Allowed");
      return;
    }
    if (url.pathname === "/mcp" && req.method === "POST") {
      if (!consumeRateLimit(req)) return res.writeHead(429, { "content-type": "application/json", "retry-after": "60", "cache-control": "no-store" }).end(JSON.stringify({ error: "Rate limit exceeded." }));
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("access-control-expose-headers", "Mcp-Session-Id");
      const server = createPluginServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => { transport.close(); server.close(); });
      try {
        const parsedBody = req.method === "POST" ? await readJsonBody(req) : undefined;
        const raw = parsedBody === undefined ? "" : JSON.stringify(parsedBody);
        const tool = parsedBody?.params?.name || parsedBody?.method || "mcp";
        await server.connect(transport);
        await transport.handleRequest(req, res, parsedBody);
        logRequest(tool, res.statusCode < 400 ? "http_completed" : "http_rejected", startedAt, utf8Bytes(raw));
      } catch (error) {
        logRequest("mcp", "rejected", startedAt, Number(req.headers["content-length"] || 0));
        if (!res.headersSent) res.writeHead(error.statusCode || 500, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ error: error.statusCode ? error.message : "Internal server error" }));
      }
      return;
    }
    res.writeHead(404).end("Not Found");
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createHttpServer().listen(PORT, "0.0.0.0", () => logRequest("service", "started", Date.now()));
}
