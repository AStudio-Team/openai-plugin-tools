function withoutFences(text) { let fenced = false; return String(text).split("\n").map(line => { if (/^\s*```/.test(line)) { fenced = !fenced; return ""; } return fenced ? "" : line; }).join("\n"); }
export function splitDraft(draft) {
  const clean = withoutFences(draft); const match = clean.match(/^#{0,6}\s*Sources\s*:?\s*$/im);
  if (!match) return { body: clean, sources: "" };
  const index = match.index; return { body: clean.slice(0, index), sources: clean.slice(index + match[0].length) };
}
function idsIn(text) { return [...String(text).matchAll(/\[(\d+)\]/g)].map(match => Number(match[1])); }
function sourceRows(block) {
  const rows = new Map();
  for (const line of block.split("\n")) { const match = line.match(/^\s*\[(\d+)\]\s+(.+?)\s*(?:-\s*(https:\/\/\S+))?\s*$/); if (match) rows.set(Number(match[1]), { text: match[2], url: match[3] }); }
  return rows;
}
function sentences(body) { return body.replace(/^#{1,6}.*$/gm, "").replace(/([.!?])((?:\[\d+\])*)\s+/gu, "$1$2\n").split(/\n+/u).map(value => value.trim()).filter(value => /[\p{L}\p{N}]/u.test(value)); }
export function verifyDraftAgainstLedger(ledger, draft, options = {}) {
  const { body, sources } = splitDraft(draft); const known = new Map(ledger.map(entry => [entry.id, entry]));
  const cited = [...new Set(idsIn(body))].sort((a,b)=>a-b); const rows = sourceRows(sources); const listed = [...rows.keys()].sort((a,b)=>a-b);
  const unknown = cited.filter(id => !known.has(id)); const missing = cited.filter(id => !rows.has(id)); const extra = listed.filter(id => !cited.includes(id));
  const mismatches = [];
  for (const [id, row] of rows) { const expected = known.get(id)?.final_url || known.get(id)?.submitted_url; if (expected && row.url && expected !== row.url) mismatches.push({ source_id: id, expected, found: row.url }); }
  const prose = sentences(body); const over = prose.filter(sentence => idsIn(sentence).length > 3).map(sentence => ({ excerpt: sentence.slice(0, 300), citation_count: idsIn(sentence).length }));
  const citedSentences = prose.filter(sentence => idsIn(sentence).length > 0).length; const unverified = prose.filter(sentence => sentence.includes("[unverified]")).length;
  const ratio = prose.length ? citedSentences / prose.length : 0; const threshold = options.coverageThreshold ?? null;
  const unevidenced = cited.filter(id => known.has(id) && known.get(id).quotes.length === 0);
  const errors = []; const warnings = [];
  const issue = (rule, message, details = {}) => ({ rule, message, ...details });
  if (unknown.length) errors.push(issue("unknown_source_ids", "Draft cites source IDs outside the active ledger.", { source_ids: unknown }));
  if (missing.length) errors.push(issue("missing_sources", "Cited sources are missing from the Sources block.", { source_ids: missing }));
  if (mismatches.length) errors.push(issue("source_url_mismatch", "A rendered source URL does not match the ledger."));
  if (over.length) errors.push(issue("citation_limit", "A sentence has more than three citation markers."));
  if (threshold !== null && ratio < threshold) errors.push(issue("coverage_threshold", "Citation coverage is below the requested threshold."));
  if (options.requireEvidence && unevidenced.length) errors.push(issue("missing_evidence", "Evidence mode requires a verified quote for every cited source.", { source_ids: unevidenced }));
  if (extra.length) warnings.push(issue("extra_sources", "The Sources block contains uncited entries.", { source_ids: extra }));
  if (unverified) warnings.push(issue("unverified_provenance", "The draft contains explicit [unverified] provenance markers.", { sentence_count: unverified }));
  return { passed: errors.length === 0, cited_source_ids: cited, unknown_source_ids: unknown, missing_from_sources_block: missing, extra_in_sources_block: extra, source_url_mismatches: mismatches, unevidenced_source_ids: unevidenced, over_cited_sentences: over, coverage: { prose_sentences: prose.length, cited_sentences: citedSentences, unverified_sentences: unverified, declared_provenance_sentences: citedSentences + unverified, ratio: Number(ratio.toFixed(4)), threshold }, errors, warnings };
}
