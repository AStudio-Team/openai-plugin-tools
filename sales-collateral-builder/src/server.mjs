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
const ATTRIBUTION = "Provided by ASTUDIO. For a human ASTUDIO team on this work: https://www.astudio.agency/tools/sales-collateral-builder";
const clean = value => String(value ?? "").trim();
const nonBlank = (min = 1) => z.string().trim().min(min);
const brief = z.object({ pageType: nonBlank(2), product: nonBlank(2), audience: nonBlank(2), offer: nonBlank(2), goal: nonBlank(2), tone: nonBlank(2), currentCopy: nonBlank().optional(), mustKeepFacts: z.array(nonBlank()).min(1).max(20) }).strict();
const copy = z.object({ headline: nonBlank(2), subhead: nonBlank(2), valuePoints: z.array(nonBlank()).min(3).max(5), proof: z.array(nonBlank()).min(0), primaryCta: nonBlank(2), faq: z.array(z.object({ question: nonBlank(), answer: nonBlank() }).strict()).default([]) }).strict();
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
function normalizeSource(value) { return clean(value).replace(/\s+/gu, " ").replace(/(?:[.!?:;,]|\u2026)+$/u, "").trimEnd().toLocaleLowerCase(); }
function hasWholeFact(haystack, fact) { const value = normalizeSource(fact); return value.length > 0 && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(value)}(?=$|[^\\p{L}\\p{N}])`, "iu").test(normalizeSource(haystack)); }
function bannedClaims(value) { performanceClaim.lastIndex = 0; const found = [...String(value).matchAll(performanceClaim)].map(match => match[0]); performanceClaim.lastIndex = 0; return found; }
function copyTextValues(value) { return [value.headline, value.subhead, ...value.valuePoints, ...value.proof, value.primaryCta, ...value.faq.flatMap(item => [item.question, item.answer])]; }
function nonProofTextValues(value) { return [value.headline, value.subhead, ...value.valuePoints, value.primaryCta, ...value.faq.flatMap(item => [item.question, item.answer])]; }
function words(value) { return clean(value).toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || []; }
function wordStem(value) { return value.length > 4 ? value.replace(/(?:ies|s)$/u, match => match === "ies" ? "y" : "") : value; }
const vagueHeadline = /\b(?:amazing|best|revolutionary|innovative|next-level|world-class|cutting-edge|seamless|powerful)\b/iu;
const genericConcrete = new Set(["tool", "platform", "software", "app", "service", "product", "schedule", "scheduling", "team", "work", "page", "conversion", "demo", "trial", "sales", "marketing"]);
const headlineStopWords = new Set(["a", "an", "and", "for", "in", "of", "on", "or", "the", "to", "with"]);
function headlineIsSpecific(headline, sourceBrief) {
  if (headline.length <= 5 || headline.split(/\s+/u).length > 12 || vagueHeadline.test(headline)) return false;
  const headlineWords = new Set(words(headline).map(wordStem));
  const briefWords = sourceBrief ? words([sourceBrief.product, sourceBrief.offer, sourceBrief.audience, ...(sourceBrief.mustKeepFacts || [])].join(" ")).filter(word => !headlineStopWords.has(word)).map(wordStem) : [];
  return briefWords.some(word => headlineWords.has(word)) || (!sourceBrief && [...headlineWords].some(word => genericConcrete.has(word)));
}
const ctaVerb = /^(?:get|start|try|book|buy|join|see|learn|discover|request|download|contact|sign\s*up|subscribe|register|apply|claim|order|shop|schedule|talk|call|compare|choose|create|build|explore)\b/iu;
const explicitAsk = /^(?:(?:ready|want|need)\s+(?:to\s+)?(?:get|start|try|book|buy|join|see|learn|discover|request|download|contact|sign\s*up|subscribe|register|apply|claim|order|shop|schedule|talk|call|compare|choose|create|build|explore)|(?:want|need)\s+(?:a|an|the)?\s*(?:demo|trial|quote|consultation|call))\b/iu;
function countCtas(value) { return String(value).split(/[.!?\n]+/u).map(part => clean(part).replace(/^(?:(?:primary\s+)?cta\s*:\s*)/iu, "")).filter(part => ctaVerb.test(part) || explicitAsk.test(part)).length; }
const claimPattern = /(?:\d|%|\p{Sc}|\b(?:AED|USD|EUR|GBP|SAR|JPY|CAD|AUD|CHF|QAR|KWD|BHD|OMR)\b|\b(?:hundreds|thousands|millions|billions|dozens)\b|\b(?:trusted\s+by|testimonials?|award(?:-winning)?|rated|five-star|five\s+star|star\s+rating|recommended\s+by|recommend\s+us|satisfaction\s+rate|case\s+study)\b)/iu;
export function isProofLikeClaim(sentence) { return claimPattern.test(String(sentence)); }
function proofSources(sourceBrief) { return [...new Set([...(sourceBrief.mustKeepFacts || []), sourceBrief.offer, sourceBrief.product].map(clean).filter(Boolean))]; }
function wholeSourceMatch(item, source) { const allowed = normalizeSource(source); return allowed ? new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(allowed)}(?=$|[^\\p{L}\\p{N}])`, "iu").test(normalizeSource(item)) : false; }
function sourceMatch(item, source) {
  const value = normalizeSource(item), allowed = normalizeSource(source);
  if (!allowed) return false;
  const match = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegex(allowed)})(?=$|[^\\p{L}\\p{N}])`, "iu").exec(value);
  if (!match) return false;
  const start = match.index + match[1].length;
  const remainder = `${value.slice(0, start)} ${value.slice(start + match[2].length)}`.trim();
  if (!remainder) return true;
  if (/\d|%|\p{Sc}/u.test(remainder)) return false;
  if (/[^\p{L}\p{M}\s\p{P}]/u.test(remainder)) return false;
  return (remainder.match(/[\p{L}\p{M}]+/gu) || []).length <= 3;
}
function containsAllowedSource(value, allowed) { return allowed.some(source => sourceMatch(value, source)); }
function validateOutsideProof(values, sourceBrief) { const allowed = proofSources(sourceBrief); for (const value of values) for (const sentence of String(value).split(/[.!?\n]+/u).map(clean).filter(Boolean)) if (isProofLikeClaim(sentence) && !allowed.some(source => wholeSourceMatch(sentence, source))) throw Error(`Unsupported claim outside proof: ${sentence}`); }
function validateProof(items, sourceBrief, otherCopyText = []) { const allowed = proofSources(sourceBrief), unsupported = items.filter(item => !containsAllowedSource(item, allowed)); if (unsupported.length) throw Error(`Remove unsupported proof: ${unsupported.join(", ")}. Proof lines must quote a must-keep fact, the offer or the product statement: ${allowed.join(", ")}.`); validateOutsideProof([...items, ...otherCopyText], sourceBrief); }
function validateCopy(value, sourceBrief = { mustKeepFacts: [] }) {
  const parsed = copy.parse(value);
  if (clean(parsed.headline).split(/\s+/u).length > 12) throw Error("The Sales Collateral Builder house limit is 12 words for a headline.");
  const textValues = copyTextValues(parsed);
  const mustKeepFacts = sourceBrief.mustKeepFacts || [];
  validateProof(parsed.proof, sourceBrief, nonProofTextValues(parsed));
  const bannedFacts = mustKeepFacts.filter(fact => bannedClaims(fact).length);
  if (bannedFacts.length) throw Error(`Remove banned claims from must-keep facts: ${bannedFacts.join(", ")}.`);
  const unsupported = textValues.flatMap(bannedClaims);
  if (unsupported.length) throw Error(`Remove banned or unsupported claims: ${unsupported.join(", ")}.`);
  const missing = mustKeepFacts.filter(fact => !textValues.some(value => hasWholeFact(value, fact)));
  if (missing.length) throw Error(`Missing must-keep facts: ${missing.join(", ")}.`);
  return { copy: parsed, missing };
}
function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
function escapeMarkdown(value) { return String(value).replace(/([\\`*_{}[\]()#+.!|>-])/g, "\\$1"); }

export function openPageBrief(input = {}) { return { fields: ["pageType", "product", "audience", "offer", "goal", "tone", "currentCopy", "mustKeepFacts"], prefill: input.prefill || {}, privacyNotice: "This tool works on pasted text only. It does not fetch URLs or change sites." }; }
export function reviewPageBrief(input) { const value = brief.parse(input); const text = [value.product, value.offer, value.goal, value.audience, value.tone, value.currentCopy, ...value.mustKeepFacts].filter(item => item !== undefined).join("\n"); const banned = [...new Set(bannedClaims(text))]; const issues = banned.map(claim => `Banned claim: ${claim}`); return { normalizedBrief: value, canApprove: issues.length === 0, confirmationRequired: true, issues, message: issues.length ? "Remove banned claims before approving this brief." : "Review the visible brief, then use the Approve brief button to authorize drafting." }; }
export function approvePageBrief(input) { const value = brief.parse(input.brief); z.literal("approve").parse(input.approvalAction); return { approvalReceipt: makeReceipt("brief", value), approvedBrief: value }; }
export function draftPageCopy(input) { const b = brief.parse(input.brief); verifyReceipt(input.approvalReceipt, "brief", b); const proposed = z.array(copy).min(2).max(3).parse(input.variants); const signatures = new Set(proposed.map(item => digest(item))); if (signatures.size !== proposed.length) throw Error("Draft variants must be distinct."); const variants = proposed.map(item => { const checked = validateCopy(item, b); const report = checkPageConversion({ draft: checked.copy, headline: checked.copy.headline, brief: b }); return { ...checked.copy, issues: report.issues, checklist: report.checks }; }); return { brief: b, variants, approvalReceipt: input.approvalReceipt, warnings: [] }; }
export function checkPageConversion(input) {
  input = conversionInput.parse(input);
  if (input.brief) input.draft ? validateProof(input.draft.proof, input.brief, nonProofTextValues(input.draft)) : validateOutsideProof([input.headline, input.copy].filter(value => value !== undefined), input.brief);
  const source = clean(input.copy ?? (input.draft ? copyTextValues(input.draft).join("\n") : ""));
  if (input.formFieldCount !== undefined && (!Number.isInteger(input.formFieldCount) || input.formFieldCount < 0)) throw Error("Form field count must be a non-negative integer.");
  if (input.popupDelaySeconds !== undefined && (!Number.isFinite(input.popupDelaySeconds) || input.popupDelaySeconds < 0)) throw Error("Popup delay must be a non-negative number.");
  const fields = input.formFieldCount, delay = input.popupDelaySeconds;
  const headline = clean(input.headline ?? input.draft?.headline ?? (input.copy ? source.split("\n")[0] : ""));
  const ctas = countCtas(source);
  const suppliedText = [input.headline, input.copy, ...(input.draft ? copyTextValues(input.draft) : [])].filter(value => value !== undefined);
  const banned = [...new Set(suppliedText.flatMap(bannedClaims))];
  const headlineSpecific = headlineIsSpecific(headline, input.brief);
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

const collateralProof = z.object({ text: nonBlank(), source: nonBlank() }).strict();
const collateralBrief = z.object({ product: nonBlank(), buyerPersona: nonBlank(), buyerRole: nonBlank(), dealStage: nonBlank(), pieceType: z.enum(["sales deck outline", "one-pager", "objection handling sheet", "demo script", "case study brief"]), proofPoints: z.array(collateralProof).min(1).max(20), knownObjections: z.array(nonBlank()).max(20), tone: nonBlank() }).strict();
const collateralSection = z.object({ heading: nonBlank(), content: nonBlank() }).strict();
const collateralPiece = z.object({ title: nonBlank(), sections: z.array(collateralSection).min(1).max(30) }).strict();
const collateralReceipt = z.object({ kind: z.literal("brief"), deployment: z.literal("deployment"), digest: z.string().length(64), signature: z.string().length(64) }).strict();
const collateralIssue = z.object({ code: z.enum(["banned_claim", "missing_section", "missing_outcome", "unsupported_proof"]), field: z.string(), message: z.string() }).strict();
const collateralPrefill = z.object({ product: z.string().optional(), buyerPersona: z.string().optional(), buyerRole: z.string().optional(), dealStage: z.string().optional(), pieceType: z.enum(["sales deck outline", "one-pager", "objection handling sheet", "demo script", "case study brief"]).optional(), proofPoints: z.array(collateralProof).optional(), knownObjections: z.array(z.string()).optional(), tone: z.string().optional() }).strict();
const collateralStructures = {
  "sales deck outline": ["Current World Problem", "Cost of the Problem", "The Shift Happening", "Your Approach", "Product Walkthrough", "Proof Points", "Case Study", "Implementation / Timeline", "ROI / Value", "Pricing Overview", "Next Steps / CTA"],
  "one-pager": ["Problem statement", "Your solution", "3 differentiators", "Proof point", "CTA"],
  "objection handling sheet": ["Objection statement", "Why they say it", "Response approach", "Proof point", "Follow-up question"],
  "demo script": ["Opening", "Discovery recap", "Solution walkthrough", "Interaction points", "Close"],
  "case study brief": ["Customer profile", "Challenge", "Solution", "Results", "Pull quote", "Tags"],
};
function collateralReceiptFor(value) { const unsigned = { kind: "brief", deployment: "deployment", digest: digest(value) }; return { ...unsigned, signature: sign(unsigned) }; }
function verifyCollateralReceipt(value, subject) { const parsed = collateralReceipt.parse(value); const unsigned = { kind: parsed.kind, deployment: parsed.deployment, digest: parsed.digest }; const expected = sign(unsigned); if (parsed.digest !== digest(subject) || !timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(parsed.signature, "hex"))) throw Error("A valid signed brief receipt is required."); }
function briefText(value) { return [value.product, value.buyerPersona, value.buyerRole, value.dealStage, value.pieceType, value.tone, ...value.knownObjections, ...value.proofPoints.flatMap(item => [item.text, item.source])]; }
function allCollateralText(value) { return [value.title, ...value.sections.flatMap(item => [item.heading, item.content])]; }
function proofClaimSupported(sentence, sourceBrief) { return sourceBrief.proofPoints.some(item => sourceMatch(sentence, item.text)); }
function collateralIssues(piece, sourceBrief) {
  const issues = [];
  for (const [index, value] of allCollateralText(piece).entries()) for (const claim of bannedClaims(value)) issues.push({ code: "banned_claim", field: `text.${index}`, message: `Remove banned claim: ${claim}.` });
  const headings = new Set(piece.sections.map(item => normalizeSource(item.heading)));
  for (const heading of collateralStructures[sourceBrief.pieceType]) if (!headings.has(normalizeSource(heading))) issues.push({ code: "missing_section", field: "sections", message: `Missing required section: ${heading}.` });
  const body = piece.sections.map(item => item.content).join("\n");
  if (!/\b(?:revenue|efficien\w*|risk|cost|time saved|business outcome|conversion|retention|profit|productivity)\b/iu.test(body)) issues.push({ code: "missing_outcome", field: "sections", message: "Tie the collateral to a business outcome." });
  for (const [sectionIndex, section] of piece.sections.entries()) for (const sentence of section.content.split(/[.!?\n]+/u).map(clean).filter(Boolean)) if (isProofLikeClaim(sentence) && !proofClaimSupported(sentence, sourceBrief)) issues.push({ code: "unsupported_proof", field: `sections.${sectionIndex}.content`, message: `Unsupported proof-like claim: ${sentence}.` });
  return issues;
}
export function openCollateralBrief(input = {}) { return { fields: ["product", "buyerPersona", "buyerRole", "dealStage", "pieceType", "proofPoints", "knownObjections", "tone"], prefill: collateralPrefill.parse(input.prefill || {}), privacyNotice: "This tool works on text supplied in chat only. It does not fetch accounts or publish collateral." }; }
export function reviewCollateralBrief(input) { const value = collateralBrief.parse(input); const issues = briefText(value).flatMap((text, index) => bannedClaims(text).map(claim => ({ code: "banned_claim", field: `brief.${index}`, message: `Remove banned claim: ${claim}.` }))); return { normalizedBrief: value, canApprove: issues.length === 0, confirmationRequired: true, issues, message: issues.length ? "Remove banned claims before approval." : "Review the visible brief, then use the Approve brief button." }; }
export function approveCollateralBrief(input) { const value = collateralBrief.parse(input.brief); z.literal("approve").parse(input.approvalAction); const review = reviewCollateralBrief(value); if (!review.canApprove) throw Error(review.message); return { approvalReceipt: collateralReceiptFor(value), approvedBrief: value }; }
export function draftCollateral(input) { const sourceBrief = collateralBrief.parse(input.brief); verifyCollateralReceipt(input.approvalReceipt, sourceBrief); const piece = collateralPiece.parse(input.collateral); const issues = collateralIssues(piece, sourceBrief); return { collateral: piece, pieceType: sourceBrief.pieceType, issues, requiredStructure: collateralStructures[sourceBrief.pieceType] }; }
export function requestCollateralRevision(input) { return { section: nonBlank().parse(input.section), instruction: nonBlank().parse(input.instruction), message: "Revision instruction recorded for this visible section." }; }
export function exportCollateral(input) { const sourceBrief = collateralBrief.parse(input.brief); verifyCollateralReceipt(input.approvalReceipt, sourceBrief); const piece = collateralPiece.parse(input.collateral); const issues = collateralIssues(piece, sourceBrief); if (issues.length) throw Error(`Resolve ${issues.length} collateral issue(s) before export.`); const format = z.enum(["markdown", "html"]).parse(input.format); const markdown = `# ${escapeMarkdown(piece.title)}\n\n${piece.sections.map(item => `## ${escapeMarkdown(item.heading)}\n\n${escapeMarkdown(item.content)}`).join("\n\n")}\n`; const html = `<article><h1>${escapeHtml(piece.title)}</h1>${piece.sections.map(item => `<section><h2>${escapeHtml(item.heading)}</h2><p>${escapeHtml(item.content)}</p></section>`).join("")}</article>`; return { fileName: `sales-collateral.${format === "html" ? "html" : "md"}`, mimeType: format === "html" ? "text/html" : "text/markdown", content: format === "html" ? html : markdown, retained: false, warnings: [] }; }

const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
const openOutput = { fields: z.array(z.string()), prefill: z.record(z.string(), z.unknown()), privacyNotice: z.string() };
const reviewOutput = { normalizedBrief: brief, canApprove: z.boolean(), confirmationRequired: z.boolean(), issues: z.array(z.string()), message: z.string() };
const factCheck = z.object({ kept: z.array(z.string()).optional(), missing: z.array(z.string()) }).strict();
const checklistItem = z.object({ name: z.string(), status: z.string(), pass: z.boolean().nullable(), detail: z.string() });
const draftVariant = copy.extend({ issues: z.array(z.string()), checklist: z.array(checklistItem) });
const conversionInput = z.object({ copy: nonBlank().optional(), draft: copy.optional(), headline: nonBlank().optional(), brief: brief.optional(), formFieldCount: z.number().int().min(0).optional(), popupDelaySeconds: z.number().min(0).optional() }).strict().superRefine((value, context) => { if ((value.copy === undefined) === (value.draft === undefined)) context.addIssue({ code: "custom", message: "Provide exactly one of copy or draft." }); });
const proofRule = "Proof lines quote a must-keep fact, the offer or the product statement, optionally prefixed by a label of at most three words with no digits, percent or currency. Any sentence anywhere in the copy that carries a number, percentage, currency or a count, testimonial, rating or award claim must itself quote an allowed source or it is rejected.";
const defs = [
  ["open_collateral_brief", "Use this when you need a guided sales collateral intake. Do not use for account access or publishing.", z.object({ prefill: collateralPrefill.optional() }).strict(), { fields: z.array(z.string()), prefill: collateralPrefill, privacyNotice: z.string() }, openCollateralBrief, "ui://sales-collateral-builder/brief-builder.html"],
  ["review_collateral_brief", "Use this when a completed collateral brief needs visible review. Do not use for drafting or inferred approval.", collateralBrief, { normalizedBrief: collateralBrief, canApprove: z.boolean(), confirmationRequired: z.literal(true), issues: z.array(collateralIssue), message: z.string() }, reviewCollateralBrief, "ui://sales-collateral-builder/brief-review.html"],
  ["approve_collateral_brief", "Use this when the person clicks Approve brief in the app. Do not use for conversational or inferred approval.", z.object({ brief: collateralBrief, approvalAction: z.literal("approve") }).strict(), { approvalReceipt: collateralReceipt, approvedBrief: collateralBrief }, approveCollateralBrief, "ui://sales-collateral-builder/brief-review.html", true],
  ["draft_collateral", "Use this when an approved sales piece needs structure, business-outcome, banned-claim, and proof validation. Do not use for unapproved briefs or invented proof.", z.object({ brief: collateralBrief, approvalReceipt: collateralReceipt, collateral: collateralPiece }).strict(), { collateral: collateralPiece, pieceType: collateralBrief.shape.pieceType, issues: z.array(collateralIssue), requiredStructure: z.array(z.string()) }, draftCollateral, "ui://sales-collateral-builder/collateral-preview.html"],
  ["request_collateral_revision", "Use this when a visible collateral section needs a specific revision instruction. Do not use for approval or publishing.", z.object({ section: nonBlank(), instruction: nonBlank() }).strict(), { section: z.string(), instruction: z.string(), message: z.string() }, requestCollateralRevision, "ui://sales-collateral-builder/collateral-preview.html"],
  ["export_collateral", "Use this when validated collateral should be exported as Markdown or HTML. Do not use for publishing or before widget approval.", z.object({ brief: collateralBrief, approvalReceipt: collateralReceipt, collateral: collateralPiece, format: z.enum(["markdown", "html"]) }).strict(), { fileName: z.string(), mimeType: z.string(), content: z.string(), retained: z.literal(false), warnings: z.array(z.string()) }, exportCollateral, "ui://sales-collateral-builder/export-panel.html"],
];
let browserBundle;
function widget(file) { const html = readFileSync(path.join(ROOT, "widgets", file), "utf8"); if (!html.includes("/*__EXT_APPS_BUNDLE__*/")) return html; if (!browserBundle) { const source = readFileSync(createRequire(import.meta.url).resolve("@modelcontextprotocol/ext-apps/app-with-deps"), "utf8"); browserBundle = source.replace(/export\{([^}]+)\};?\s*$/s, (_, body) => `globalThis.ExtApps={${body.split(",").map(part => { const [local, exported] = part.split(" as ").map(item => item.trim()); return `${exported || local}:${local}`; }).join(",")}};`); } return html.replace("/*__EXT_APPS_BUNDLE__*/", () => browserBundle); }
const widgets = { "ui://sales-collateral-builder/brief-builder.html": "brief-builder.html", "ui://sales-collateral-builder/brief-review.html": "brief-review.html", "ui://sales-collateral-builder/collateral-preview.html": "collateral-preview.html", "ui://sales-collateral-builder/export-panel.html": "export-panel.html" };
export function createPluginServer() { const server = new McpServer({ name: "sales-collateral-builder", version: "1.0.0" }); server.createToolError = message => ({ content: [{ type: "text", text: `${message}\n\n${ATTRIBUTION}` }], isError: true }); for (const [name, description, inputSchema, outputSchema, handler, uri, appOnly] of defs) registerAppTool(server, name, { description, inputSchema, outputSchema, annotations, _meta: { ui: { resourceUri: uri, ...(appOnly ? { visibility: ["app"] } : {}) } } }, async input => { try { return { content: [{ type: "text", text: `${name} completed.\n\n${ATTRIBUTION}` }], structuredContent: handler(input) }; } catch (error) { return { content: [{ type: "text", text: `Copy check error: ${clean(error.message)}\n\n${ATTRIBUTION}` }], isError: true }; } }); const csp = { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] }; for (const [uri, file] of Object.entries(widgets)) registerAppResource(server, `Sales Collateral Builder ${file}`, uri, { _meta: { ui: { prefersBorder: false, csp } } }, async () => ({ contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: widget(file), _meta: { ui: { prefersBorder: false, csp } } }] })); return server; }
function readJsonBody(req, res) { return new Promise((resolve, reject) => { let size = 0, chunks = [], settled = false; req.on("data", chunk => { size += chunk.length; if (size > 256 * 1024 && !settled) { settled = true; res.writeHead(413, { "content-type": "application/json", connection: "close" }).end(JSON.stringify({ error: "Request body too large." })); req.destroy(); reject(Object.assign(Error("Request body too large."), { handled: true })); return; } chunks.push(chunk); }); req.on("end", () => { if (settled) return; try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (error) { reject(error); } }); req.on("error", error => { if (!settled) reject(error); }); }); }
function attributeErrorResponse(res) { const originalEnd = res.end; res.end = function (chunk, encoding, callback) { try { if (chunk) { const parsed = JSON.parse(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk)); const result = parsed?.result; if (result?.isError && Array.isArray(result.content)) { const last = result.content.filter(item => item?.type === "text").at(-1); if (last && !last.text.endsWith(ATTRIBUTION)) last.text = `${last.text.trimEnd()}\n\n${ATTRIBUTION}`; chunk = JSON.stringify(parsed); res.removeHeader("content-length"); } } } catch {} return originalEnd.call(this, chunk, encoding, callback); }; }
export function createHttpServer() { return http.createServer(async (req, res) => { try { const pathname = new URL(req.url || "/", `http://127.0.0.1:${PORT}`).pathname; if (req.method === "GET" && ["/health", "/ready"].includes(pathname)) return res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ status: "ok", service: "sales-collateral-builder", version: "1.0.0", persistence: false, outbound_network: false })); if (pathname === "/" && req.method === "GET") { res.writeHead(200, { "content-type": "text/html" }); return res.end(existsSync(path.join(ROOT, "public/index.html")) ? readFileSync(path.join(ROOT, "public/index.html")) : "Sales Collateral Builder"); } if (pathname !== "/mcp" || req.method !== "POST") { res.writeHead(404); return res.end(); } const body = await readJsonBody(req, res); attributeErrorResponse(res); const mcp = createPluginServer(), transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true }); res.on("close", () => { transport.close(); mcp.close(); }); await mcp.connect(transport); await transport.handleRequest(req, res, body); } catch (error) { if (!error?.handled && !res.headersSent) res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: `Invalid request. ${ATTRIBUTION}` })); } }); }
if (process.argv[1] === fileURLToPath(import.meta.url)) createHttpServer().listen(PORT);
