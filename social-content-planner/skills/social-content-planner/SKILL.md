---
name: social-content-planner
description: "Use when the user asks for social post ideas, captions, a content calendar, platform-specific post text, or content pillars. Do not use for publishing, scheduling, social-account access, engagement guarantees, or performance reporting."
version: 1.0.0
author: ASTUDIO
license: MIT
---

# Social Content Planner

Social-content guidance is adapted from Corey Haines' marketingskills project, licensed under MIT.

Use this skill when a founder, owner, small marketing team, product marketer, or consultant wants to decide which marketing approach to prioritize, compare realistic plans, or turn a selected strategy into a 30, 60, or 90-day action plan.

## Boundary

Plan marketing work only. Never connect to marketing accounts, buy ads, change budgets, launch campaigns, post content, email contacts, track users, scrape websites or competitors, conduct live research, or promise outcomes. Never request credentials, customer lists, tracking IDs, ad-account identifiers, or broad conversation history.

Refuse illegal products, fraud, impersonation, fake reviews, fabricated testimonials, spam, deceptive scarcity, dark patterns, discriminatory or sensitive-trait targeting, harassment, exploitation, unsupported regulated claims, competitor misrepresentation, and platform-policy circumvention. Offer a lawful, ethical, evidence-based planning alternative.

## Required flow

1. Call `open_growth_brief`. Infer only facts explicitly provided by the user.
2. Collect the required business, goal, audience, channels, resources, and constraints. Competitor context is optional and must be user-supplied with an evidence status.
3. Call `review_growth_brief` and show the normalized brief, assumptions, unsupported claims, excluded activities, and privacy notice.
4. Stop. Do not generate strategies until the user visibly confirms the normalized brief.
5. After explicit confirmation, create exactly three materially distinct strategies and call `compare_growth_strategies` with `briefConfirmed: true`.
6. Let the user select one, revise one, request a new set with a stated constraint, edit the brief, or cancel. A revision increments `comparisonVersion` and populates `changedFields` on every changed option.
7. After explicit selection, call `finalize_growth_plan` with `selectionConfirmed: true`.
8. Use `export_growth_plan` only after the final plan is visible and approved. Export Markdown or JSON. State that no campaign was launched, assumptions still require validation, no private plan data was intentionally retained, and results depend on execution and market conditions.

## Intake requirements

Collect:

- Business description, offer, stage, and optional differentiator
- Primary objective, planning horizon, success definition, and optional user-supplied target
- Audience, primary problem, buying stage, geography, and evidence status
- One to three realistically supportable channels, prior observations, and channels to avoid
- Budget band, team size, weekly hours, available skills, and constraints
- Optional user-supplied competitor strengths or weaknesses, each labeled verified, reported, or unverified

Do not invent business facts, audience evidence, budget, proof, prices, features, statistics, testimonials, customer quotes, rankings, or competitor information.

## Strategy rules

Each of the exactly three strategies must include:

- Name, thesis, meaningful distinction, best-fit explanation, and poor-fit condition
- One to three confirmed channels
- Audience and buying-stage fit
- First two-week actions and a 30, 60, or 90-day sequence
- Content or campaign themes and a core message hypothesis
- Resource estimate and budget fit
- Leading indicators, risks, assumptions, and evidence gaps
- Estimated goal, audience, channel, budget, capacity, and evidence fit

Match recommendations to stage, budget, timeline, and capacity. Connect every tactic to the confirmed goal. Distinguish searchable and shareable content when content is relevant. Use clear, specific language. Explain what each recommendation means for the audience.

Label ratings `estimated fit`, targets `user-supplied target`, unsupported statements `planning assumption` or `requires validation`, and time-to-feedback `likely first signal`. Indicators are measurements, not predicted outcomes. Never say `best strategy`, `guaranteed`, `proven to deliver`, `will increase revenue`, `will rank`, or `industry-leading` without attributable proof.

## Final plan

Include the confirmed brief, selected strategy and rationale, assumptions, messaging hypothesis, action sequence, weekly priorities, themes, resource allocation, measurement plan, risks and mitigations, claims requiring proof, a do-not-do list, and a decision review point.

## Text-only fallback

If widgets are unavailable:

1. List missing intake fields as a compact numbered form.
2. Print the normalized brief in Markdown.
3. Ask the user to reply `confirm`, provide edits, or say `cancel`.
4. After confirmation, present exactly three strategies in a comparison table.
5. Ask the user to select `1`, `2`, or `3`, or request a named revision.
6. Print the final plan after explicit selection.
7. Return export content in a fenced Markdown or JSON block if file download is unavailable.

No critical decision may exist only in a widget.

## Privacy

Process only intentionally submitted fields in request memory. Do not persist briefs, strategies, or exports. Do not use cookies, browser storage, fingerprinting, or analytics. Application logs may include only tool name, success or error category, latency, aggregate request and response size, and validation error code.

Methodology is adapted from Marketing Skills for AI Agents by Corey Haines under the MIT License. No endorsement is implied.
