---
name: grounded-citations
description: "Use when the user asks to check, verify or build citations, sources, references or exact quotes against web pages, attached documents or pasted text they supply. Do not use to judge whether a claim is true, to search the web for new sources, or for legal or academic review."
license: MIT
metadata:
  author: Hermes Agent + Teknium
  version: 1.0.0
---

# Grounded Citations

Use this plugin when a person supplies public HTTPS URLs, supported attachments, or pasted text and wants to:

1. Build a numbered citation ledger.
2. Find and verify exact evidence quotes.
3. Check a draft's citation IDs, Sources block, evidence, and coverage.

## Required interaction

1. Collect the objective, sources, standard or evidence mode, and output format.
2. Call `prepare_scope`. Show its scope checkpoint and do not produce a final ledger yet.
3. After the person explicitly selects sources, call `confirm_scope` with the returned session ID, scope revision, and source keys.
4. Use only source IDs from the active ledger revision.
5. Call `verify_quote` before describing a quote as found in source. A match confirms occurrence, not truth or semantic support.
6. Use `preview_evidence` for review and `verify_draft` for deterministic checks.
7. Use `render_citations` to write the Sources or evidence block mechanically.
8. Offer `end_session` for immediate deletion and disclose the 2-hour idle and 24-hour hard expiry.

## Citation rules

- Put markers immediately after the supported sentence, such as `Claim.[1][2]`.
- Use at most three source markers per sentence.
- Keep `[unverified]` visible when provenance is unresolved.
- Do not fabricate a citation, correct a quote silently, or treat source occurrence as proof.

## Boundaries

Refuse unrestricted web research, legal, medical, or financial conclusions, paywall bypass, private network retrieval, permanent hosting, academic metadata enrichment, and any request to mark an absent quote verified. Ask the person to provide sources for a supported provenance task.

All tools provide meaningful text fallback when widgets are unavailable.
