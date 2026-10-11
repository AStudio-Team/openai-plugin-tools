import { randomBytes } from "node:crypto";

export function normalizeForMatch(value) {
  const visibleLinks = String(value).replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  return visibleLinks.replace(/\\([\\`*_{}\[\]()#+.!-])/g, "$1").replace(/[*_~`]/g, "").normalize("NFC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}
function normalizedWithMap(value) {
  const chars = []; const map = []; let spacing = false;
  const markdown = String(value).replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  for (let i = 0; i < markdown.length; i += 1) {
    const char = markdown[i];
    if (/[\\*_~`]/.test(char)) continue;
    if (/\s/u.test(char)) { if (!spacing && chars.length) { chars.push(" "); map.push(i); spacing = true; } continue; }
    for (const lowered of char.normalize("NFC").toLocaleLowerCase("en-US")) { chars.push(lowered); map.push(i); }
    spacing = false;
  }
  while (chars.at(-1) === " ") { chars.pop(); map.pop(); }
  return { normalized: chars.join(""), map };
}
export function verifyQuoteInText(sourceText, quote, sourceTruncated = false) {
  const needle = normalizeForMatch(quote);
  if (needle.split(/\s+/).filter(Boolean).length < 3) throw Object.assign(new Error("Quote must contain at least three words after normalization."), { code: "quote_too_short" });
  const haystack = normalizedWithMap(sourceText); const starts = []; let from = 0;
  while (true) { const found = haystack.normalized.indexOf(needle, from); if (found < 0) break; starts.push(found); from = found + 1; }
  if (starts.length === 0) return { status: sourceTruncated ? "source_truncated" : "not_found", submitted_quote: quote, occurrence_count: 0, normalization: contract() };
  if (starts.length > 1) return { status: "ambiguous", submitted_quote: quote, occurrence_count: starts.length, normalization: contract() };
  const start = haystack.map[starts[0]]; const end = haystack.map[starts[0] + needle.length - 1] + 1;
  return { status: "verified", submitted_quote: quote, matched_quote: sourceText.slice(start, end), occurrence_count: 1, location: { start, end }, normalization: contract(), evidence_id: randomBytes(12).toString("base64url") };
}
function contract() { return { whitespace_insensitive: true, case_insensitive: true, markdown_presentation_insensitive: true }; }
