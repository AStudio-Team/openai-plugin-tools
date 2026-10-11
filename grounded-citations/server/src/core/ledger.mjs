import { createHash } from "node:crypto";
import { sanitizeLabel } from "./extraction.mjs";

export function sourceKey(kind, identity) { return `${kind}:${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`; }
export function confirmLedger(session, selectedKeys, revision) {
  if (revision !== session.scopeRevision) throw Object.assign(new Error(`Scope revision ${revision} is stale. Current revision is ${session.scopeRevision}.`), { code: "revision_conflict", details: { current_revision: session.scopeRevision } });
  const unique = [...new Set(selectedKeys)];
  const selected = unique.map(key => session.candidateSources.find(source => source.source_key === key && ["accepted", "partial"].includes(source.intake_status)));
  if (selected.some(source => !source)) throw Object.assign(new Error("Selection contains an unavailable source key."), { code: "invalid_selection" });
  const ledgerRevision = session.ledgerRevision + 1;
  const entries = selected.map((source, index) => ({
    id: index + 1, source_key: source.source_key, kind: source.kind, display_title: sanitizeLabel(source.display_title),
    submitted_url: source.submitted_url, final_url: source.final_url, file_name: source.file_name, mime_type: source.mime_type,
    accessed_at: source.accessed_at, extraction_status: source.extraction_status, text_digest: source.text_digest,
    text: source.text, truncated: source.truncated, quotes: [], warnings: [...source.warnings],
  }));
  session.ledgerRevision = ledgerRevision; session.status = "active"; session.ledgers.set(ledgerRevision, entries);
  return entries;
}
export function publicEntry(entry) {
  return { id: entry.id, source_key: entry.source_key, kind: entry.kind, display_title: entry.display_title, submitted_url: entry.submitted_url, final_url: entry.final_url, file_name: entry.file_name, mime_type: entry.mime_type, accessed_at: entry.accessed_at, extraction_status: entry.extraction_status, truncated: entry.truncated, quotes: entry.quotes.map(({ id, text, source_start, source_end, status, claim_label, created_at }) => ({ id, text, source_start, source_end, status, claim_label, created_at })), warnings: entry.warnings };
}
