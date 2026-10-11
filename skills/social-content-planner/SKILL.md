---
name: social-content-planner
description: "Use when the user asks for a social media content calendar, post ideas, captions or a weekly posting plan for LinkedIn, Instagram, X, TikTok, Facebook or YouTube Shorts. Do not use for posting, scheduling, ads, analytics or account access."
metadata:
  version: 1.0.0
---

# Social Content Planner

Create useful, platform-appropriate social post drafts from facts the user supplies. This plugin plans and writes only. Never claim it posted, scheduled, connected to an account, measured performance, or guaranteed reach or engagement.

## Required flow

1. Use `open_social_brief` to collect the brand, audience, goals, platforms, tone, content pillars, exact posts per platform per week, requested weeks, required topics and banned topics.
2. Use `review_social_brief` to normalize and show the complete brief. Do not infer approval.
3. The user approves in the widget with `approve_social_brief`. Preserve its 30-minute approval receipt with the exact approved brief.
4. Write every requested post, then call `draft_content_calendar` with the approved brief, receipt and full post list. A calendar is usable only when `valid` is true.
5. For requested changes, use the widget's `request_calendar_revision` with an existing week, optional existing post ID and the user's visible instruction. Regenerate and validate the full calendar.
6. Use `export_content_calendar` only after the same calendar passes validation. It returns CSV and Markdown.

## Brief and content guidance

Ask only for missing information. Use 3 to 5 focused content pillars when the user has not yet chosen a sensible set. Each pillar should reflect the audience's questions, the brand's genuine perspective, consistently producible material and the stated goal.

Strong hooks can create curiosity, begin a real story, promise specific practical value, or challenge a common belief. Do not invent results, testimonials, experience, customer facts or performance data. Adapt format and length to each platform while preserving the user's voice. Repurpose a real source idea across platforms by changing the hook, structure, CTA and visual note instead of duplicating the same copy.

Every post needs a unique `postId`, approved week, approved platform, approved pillar, hook, complete post text, format, visual note and CTA. Cover every `mustInclude` topic and exclude every banned topic from the hook, body, CTA, format and visual note. Meet the exact approved platform frequency for every requested week.

## Boundaries

Do not use this plugin for posting, scheduling, social account connections, DMs, paid ads, scraping, live analytics, engagement routines or performance optimization based on account data. Do not promise virality, reach, followers, leads or engagement. If asked, explain the boundary and offer a copyable, exportable plan instead.
