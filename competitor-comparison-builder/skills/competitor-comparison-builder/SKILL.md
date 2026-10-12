---
name: competitor-comparison-builder
description: "Use when the user asks for a competitor comparison page, alternative page, alternatives page, vs page, product comparison, '[Product] vs [Product],' '[Product] alternative,' 'how do we compare to X,' or switch-from-competitor content. Do not use for general website copy, internal sales collateral, fetching URLs, editing or publishing a live site, traffic analysis, or guaranteed outcomes."
version: 1.0.0
author: ASTUDIO
license: MIT
---

# Comparison Page Builder

Create useful, accurate pages that answer competitive search intent and help a buyer decide. Acknowledge every product's real strengths and limitations. Never misrepresent a competitor, invent a claim, or imply that one option fits everyone. Explain why differences matter with use cases and paragraph comparisons, not only a checklist.

## Establish the brief and facts

Understand the user's product, value proposition, differentiators, ideal customer, pricing model, honest weaknesses, competitors, audience, and page goal. Use one centralized fact set for every competitor so claims remain consistent across pages. Each fact must include the product, attribute, value, source URL, and date checked. Treat unsourced or stale details as unverified and ask the user to confirm them.

This plugin has these limits: it works only from text and facts the user supplies; it does not fetch URLs, access analytics, edit or publish websites, or guarantee traffic or business results. Its brief accepts at most five competitors and requires explicit approval before validation or export. These are plugin limits, not limits from the adapted methodology.

## Choose one of four formats

1. **[Competitor] alternative (singular):** For a buyer actively considering a switch. Explain why people seek an alternative, summarize the user's product, compare features, service, and pricing, say who should and should not switch, cover migration, add supplied switcher proof, and close with a relevant action.
2. **[Competitor] alternatives (plural):** For a buyer researching options. Explain common reasons to look elsewhere, define evaluation criteria, include real alternatives, provide a summary table and detailed breakdowns, then recommend options by use case. The source methodology recommends four to seven real alternatives; the plugin itself can accept at most five competitors.
3. **You vs [Competitor]:** For direct evaluation. Lead with the main differences, compare features, pricing, support, ease of use, and integrations, and state candidly who each product fits better. Include supplied customer evidence, migration help, and a relevant action.
4. **[Competitor A] vs [Competitor B]:** For a buyer comparing two other products. Give an even-handed overview, compare meaningful categories, say who each fits, then introduce the user's product as a third option without forcing the recommendation. Include an all-three table.

## Include the essential sections

Every page needs:

- A TL;DR that states the key differences in two or three sentences.
- Paragraph comparisons explaining how each option handles important needs, why the differences matter, and the relevant scenarios.
- A feature table whose verified cells trace exactly to the centralized facts.
- A pricing comparison covering tiers, inclusions, hidden costs, and total cost for a representative team when the supplied facts support it.
- A "who it is for" section for every option, including circumstances where a competitor is the better fit.
- A migration section for singular-alternative and you-vs-competitor pages, covering what transfers, what needs reconfiguration, available support, and supplied evidence from customers who switched.

Add only substantiated proof and calls to action that match the reader's decision stage. Never invent prices, features, testimonials, review themes, customer outcomes, urgency, or migration promises.

## Use the plugin flow

1. Call `open_comparison_brief` to collect the page format, product, category, competitors, audience, differentiators, centralized facts, and prohibited claims.
2. Call `review_comparison_brief` to normalize the supplied material and show missing source or date information. Let the user inspect the visible brief.
3. Use `approve_comparison_brief` only after the user explicitly approves in the app. Do not infer approval.
4. Prepare the page in the selected format, then call `draft_comparison_page` with the approved brief and signed receipt. Resolve every unsupported, untraced, disparaging, or missing-section issue.
5. Use `request_page_revision` only for a visible request to revise a named section, preserving the approved facts and balanced recommendations.
6. Call `export_comparison_page` only when the approved page has no issues. Export Markdown or HTML; do not publish it.

Before export, confirm that every factual comparison can be traced to its source and date checked, the prose matches the table, pricing is current as of the recorded date, and the page openly says when another product may suit the buyer better.

Methodology adapted from Corey Haines' competitor-alternatives skill in Marketing Skills for AI Agents, licensed under the MIT License. No endorsement is implied.
