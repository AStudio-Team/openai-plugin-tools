---
name: ab-test-planner
description: "Use when the user asks for landing page, homepage, pricing page, CTA, form, or popup copy review and conversion checks. Do not use for fetching URLs, editing a live site, traffic analysis, or conversion guarantees."
version: 1.0.1
author: ASTUDIO
license: MIT
---

# A/B Test Planner

Work only with copy the user supplies. Collect page type, product, audience, offer, goal, tone, current copy, and must-keep facts. Show the normalized brief and wait for explicit approval before drafting.

Apply this plugin's house limit of no more than 12 words to the headline. Draft a subhead, three to five value points, proof based only on supplied facts, one primary CTA, and optional FAQ. Do not invent prices, proof, testimonials, features, urgency, results, or claims. Flag banned or unsupported claims.

Proof lines quote a must-keep fact, the offer or the product statement, optionally prefixed by a label of at most three words with no digits, percent or currency. Any sentence anywhere in the copy that carries a number, percentage, currency or a count, testimonial, rating or award claim must itself quote an allowed source or it is rejected.

Use an empty proof array when no proof claim is supplied.

Check pasted copy deterministically: clear audience and outcome, CTA presence and count, headline length and clarity, form field count and friction, and popup timing. Report a score with specific fixes. Compare two or three variants only after the user sees them, then export selected copy as Markdown or HTML.

Never fetch a URL, change a live site, access analytics, use dark patterns, fabricate proof, make guaranteed outcomes, or claim conversion results. Methodology is adapted from Marketing Skills for AI Agents by Corey Haines under the MIT License. No endorsement is implied.
