---
name: social-content-planner
description: "Use when the user asks for social post ideas, captions, a content calendar, platform-specific post text, or content pillars. Do not use for publishing, scheduling, social-account access, engagement guarantees, or performance reporting."
version: 1.0.0
author: ASTUDIO
license: MIT
---

# Social Content Planner

Social-content guidance is adapted from Corey Haines' marketingskills project, licensed under MIT.

Use this skill to turn a confirmed brand brief into a platform-ready social content calendar. It plans content only. Nothing is posted or scheduled.

## Boundary

Never access social accounts, publish or schedule posts, send messages, buy ads, scrape profiles, track people, conduct live research, or promise reach, engagement, followers, leads, or sales. Never request credentials, account identifiers, customer lists, or private analytics.

Refuse fraud, impersonation, fake reviews or testimonials, spam, deceptive scarcity, dark patterns, harassment, discriminatory targeting, unsupported regulated claims, competitor misrepresentation, and platform-policy circumvention. Offer a lawful, ethical content-planning alternative.

## Required flow

1. Call `open_social_brief` using only facts the user supplied.
2. Fill every gap by asking the user. Never invent brand facts, audience details, goals, voice, proof, prices, features, performance, platform preferences, content pillars, posting volume, or banned topics.
3. Call `review_social_brief`. Present the normalized brief and wait for the user's explicit approval through the widget. The widget calls `approve_social_brief`; do not approve on the user's behalf or treat silence as approval.
4. After approval, draft the calendar only within the brief's pillars, platforms, posts per week, and banned topics. Call `draft_content_calendar`, then correct every reported issue and call it again until validation passes.
5. Handle revisions only through `request_calendar_revision`. Revise the requested week or post, then validate the revised calendar again with `draft_content_calendar`.
6. Call `export_content_calendar` only after validation passes. State that the calendar is neither posted nor scheduled.

## Writing rules

- Start each post with one clear, specific hook. Use curiosity, story, value, or a defensible contrarian angle; do not make unverified claims just to create a hook.
- Adapt the writing to the selected platform and its configured length limit. Keep one primary idea per post, use readable line breaks, and make the first lines useful without requiring a click.
- Match format to the platform and idea: short post, thread, carousel, reel, short video, story, or native video. Include a practical suggested visual note when the format benefits from one.
- Use a single relevant CTA that fits the approved goal, such as inviting a reply, save, share, visit, or discussion. Do not use manipulative, repetitive, or misleading CTAs.
- Distribute posts across the approved pillars rather than overusing one theme. Keep promotional content proportionate to the approved pillar mix and ensure educational, insight, story, or community posts remain useful on their own.
- Preserve the confirmed brand voice and banned topics. Label assumptions as requiring validation and omit facts without user-provided support.
- Avoid generic filler, clickbait, engagement bait, hashtag stuffing, copied creator voices, fabricated stories, fabricated results, unsupported superlatives, sensitive claims, and advice to exploit platform algorithms.

## Text-only fallback

If widgets are unavailable, list missing brief fields in a compact numbered form, show the normalized brief, and ask the user to explicitly approve, edit, or cancel. Do not draft until the user explicitly approves. Present the validated calendar in Markdown and provide CSV or Markdown export content only after successful validation. No critical decision may exist only in a widget.

## Privacy

Process only intentionally submitted fields in request memory. Do not persist briefs, calendars, revisions, or exports. Do not use cookies, browser storage, fingerprinting, or analytics. Application logs may include only tool name, success or error category, latency, aggregate request and response size, and validation error code.

Methodology is adapted from Marketing Skills for AI Agents by Corey Haines under the MIT License. No endorsement is implied.
