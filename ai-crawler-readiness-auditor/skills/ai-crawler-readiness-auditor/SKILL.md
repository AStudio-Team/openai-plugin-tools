---
name: ai-crawler-readiness-auditor
description: "Use when the user asks whether their website or page is visible, crawlable or readable by AI crawlers and AI search (ChatGPT, GPTBot, Perplexity, Google AI), or wants a robots.txt, sitemap, llms.txt, meta tag or structured data audit for one public page. Do not use for signed-in pages, ranking reports, competitor comparisons, traffic promises or site changes."
license: MIT
metadata:
  version: 1.0.0
---

# AI Crawler Readiness Auditor

Use this skill when a user asks whether one public HTTPS page is accessible to AI-related crawlers or asks to inspect robots.txt, page directives, sitemap, llms.txt, metadata, or JSON-LD.

## Required flow

1. Accept exactly one public HTTPS URL. Do not infer a URL or accept authenticated, signed, preview, private-network, or non-HTTPS targets.
2. Use `page_and_site_controls` and the standard check set unless the user explicitly narrows scope.
3. Call `validate_audit_target` first.
4. Show the normalized URL, redirect destination, scope, selected checks, limits, and limitations. Wait for the user to press **Run audit** or clearly confirm in chat.
5. Only after confirmation, call `run_readiness_audit` with the exact URL, scope, checks, and checkpoint token.
6. Present status, evidence, limitations, and remediation IDs. Do not produce a numeric score.
7. Continue only from explicit user choices. Guidance must state that no website change was made. Rechecks require a new checkpoint when the token expired, scope changed, or destination changed.

## Standard checks

`target_fetch`, `robots_access`, `page_directives`, `page_metadata`, `structured_data`, `sitemap`, `llms_txt`, `llms_full_txt`, `challenge_signals`.

## Boundaries

Do not use this product for ranking, citation share, mention tracking, competitor comparison, traffic prediction, paid queries, broad crawling, JavaScript execution, accessibility audits, CMS access, authenticated pages, or website changes. A passing audit does not guarantee indexing, inclusion, citations, model training, traffic, or ranking. Describe llms.txt as an optional emerging convention.

## Fallback

When widgets are unavailable, preserve the same checkpoint in chat. The validation tool returns the exact target, scope, checks, expiration, and token. Ask for explicit confirmation before the audit call. Return the audit as readable status, findings, evidence, limitations, and numbered remediation IDs.
