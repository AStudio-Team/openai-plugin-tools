export function renderSources(ledger, style = "markdown", ids) {
  const wanted = ids?.length ? new Set(ids) : null;
  const entries = ledger.filter(entry => !wanted || wanted.has(entry.id));
  const line = entry => {
    const target = entry.final_url || entry.submitted_url;
    const label = entry.kind === "file" ? `${entry.file_name || entry.display_title}, user-provided attachment` : entry.kind === "pasted_text" ? `${entry.display_title}, user-provided text` : entry.display_title;
    if (style === "footnotes") return `[^${entry.id}]: ${label}${target ? ` - ${target}` : ""}`;
    return `[${entry.id}] ${label}${target ? ` - ${target}` : ""}`;
  };
  let rendered = style === "footnotes" ? entries.map(line).join("\n") : `Sources\n${entries.map(line).join("\n")}`;
  if (style === "evidence") rendered += `\n\nEvidence\n${entries.map(entry => entry.quotes.length ? entry.quotes.map(quote => `[${entry.id}] Found in source: "${quote.text}"${quote.claim_label ? ` (${quote.claim_label})` : ""}`).join("\n") : `[${entry.id}] [unverified] No verified quote selected.`).join("\n")}`;
  return rendered;
}
